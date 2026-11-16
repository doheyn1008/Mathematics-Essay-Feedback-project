import { notificationWrites, pointLedger, usageRewardPolicy } from "./product-account";
import { env } from "cloudflare:workers";
import type { ClassRoom, Exam, ExamAssignment, ExamFile, ExamFileRole, ExamItem, ExamMessage, ExamSubmission, FeedbackVersion, ProductState, ReleaseMode, SubmissionDetail } from "../product-types";
import type { Question, Submission } from "../types";
import { HttpError, finiteNumber, optionalText, requireText, sourceUrl } from "./validation";
import { checkProductOrigin, classMembership, getEntitlement, getExam, getProfile, productDatabase, productIdentity, productJson, readProductJson, requireClassTeacher, requireEntitlement, requireProductUser, requireProfile, type ProductUser } from "./product-auth";
import { prepareAnalysisInput, validateExamResult } from "./product-analysis";
import { contributionPolicy, getProductContributions } from "./product-contributions";

type DataRow = { data: string; revision?: number };
const decode = <T>(row: DataRow): T => JSON.parse(row.data) as T;
const now = () => new Date().toISOString();
const makeId = () => crypto.randomUUID();
const maximumFile = 15 * 1024 * 1024;
const maximumTotal = 60 * 1024 * 1024;
const maximumFiles = 12;
const roles = ["problem", "answer", "mixed", "solution", "rubric"] as const;
function releaseMode(value: unknown, fallback: ReleaseMode = "teacher_review"): ReleaseMode {
  if (value === undefined) return fallback;
  if (value !== "teacher_review" && value !== "ai_immediate") throw new HttpError(400, "첨삭 공개 방식을 확인하세요.");
  return value;
}
function revision(value: unknown, expected: number): void {
  if (value !== expected) throw new HttpError(409, "다른 창에서 내용이 변경되었습니다. 최신 기록을 불러온 뒤 다시 저장하세요.", "REVISION_CONFLICT");
}
function noLegacy(id: string): void {
  if (id.startsWith("legacy:")) throw new HttpError(409, "기존 개별 문항 기록은 보존용으로 열람합니다. 새 시험을 만들어 계속 이용하세요.", "LEGACY_READ_ONLY");
}
async function getClass(db: D1Database, id: string): Promise<ClassRoom> {
  const row = await db.prepare("SELECT data FROM product_classes WHERE id = ?").bind(id).first<DataRow>();
  if (!row) throw new HttpError(404, "반을 찾을 수 없습니다.");
  return decode<ClassRoom>(row);
}
function studentExam(exam: Exam): Exam {
  return { ...exam, items: exam.items.map(item => ({ ...item, criteria: "" })), files: exam.files.filter(file => file.role === "problem" || file.role === "mixed") };
}
function validateItems(value: unknown): ExamItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new HttpError(400, "시험 문항은 100개까지 등록할 수 있습니다.");
  const items = value.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new HttpError(400, "문항 구조를 확인하세요.");
    const item = entry as Record<string, unknown>;
    return { id: optionalText(item.id, "문항 ID", 100) || makeId(), label: requireText(item.label, "문항 이름", 150), maxScore: finiteNumber(item.maxScore, "배점", 0.01, 1000), criteria: optionalText(item.criteria, "평가 기준", 10000) };
  });
  if (new Set(items.map(item => item.id)).size !== items.length) throw new HttpError(400, "문항 ID가 중복됩니다.");
  return items;
}

type IncomingFile = { file: File; role: ExamFileRole; order: number; itemId?: string };
async function readUpload(request: Request): Promise<{ body: Record<string, unknown>; files: IncomingFile[] }> {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) return { body: await readProductJson(request), files: [] };
  if (Number(request.headers.get("content-length")) > maximumTotal + 500000) throw new HttpError(413, "한 번에 60MB까지 제출할 수 있습니다.");
  let form: FormData;
  try { form = await request.formData(); } catch { throw new HttpError(400, "파일을 읽을 수 없습니다."); }
  let body: Record<string, unknown>;
  try { body = JSON.parse(String(form.get("payload"))); } catch { throw new HttpError(400, "제출 정보를 확인하세요."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "제출 정보를 확인하세요.");
  const raw = form.getAll("files");
  const meta = body.fileMeta;
  if (!Array.isArray(meta) || meta.length !== raw.length || raw.length > maximumFiles) throw new HttpError(400, "파일 분류와 순서를 확인하세요. 최대 12개까지 첨부할 수 있습니다.");
  let total = 0;
  const files: IncomingFile[] = [];
  for (let i = 0; i < raw.length; i++) {
    const file = raw[i];
    const item = meta[i] as Record<string, unknown>;
    if (!(file instanceof File) || !file.size || file.size > maximumFile) throw new HttpError(413, "빈 파일은 제출할 수 없으며 파일 하나당 15MB까지 가능합니다.");
    total += file.size;
    if (total > maximumTotal) throw new HttpError(413, "한 번에 60MB까지 제출할 수 있습니다.");
    if (!item || typeof item !== "object" || Array.isArray(item) || !roles.includes(item.role as ExamFileRole)) throw new HttpError(400, "파일 분류를 확인하세요.");
    const order = finiteNumber(item.order, "파일 순서", 0, maximumFiles - 1);
    if (!Number.isInteger(order)) throw new HttpError(400, "파일 순서는 정수로 입력하세요.");
    await validateProductFile(file);
    files.push({ file, role: item.role as ExamFileRole, order, ...(item.itemId ? { itemId: requireText(item.itemId, "연결 문항", 100) } : {}) });
  }
  if (new Set(files.map(file => file.order)).size !== files.length) throw new HttpError(400, "파일 순서가 중복됩니다.");
  return { body, files: files.sort((a, b) => a.order - b.order) };
}
export async function validateProductFile(file: File): Promise<void> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = new TextDecoder().decode(head);
  const types: Record<string, boolean> = {
    "image/jpeg": head[0] === 255 && head[1] === 216 && head[2] === 255,
    "image/png": head[0] === 137 && head[1] === 80 && head[2] === 78 && head[3] === 71 && head[4] === 13 && head[5] === 10 && head[6] === 26 && head[7] === 10,
    "image/webp": ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP",
    "application/pdf": ascii.startsWith("%PDF-"),
  };
  if (!Object.hasOwn(types, file.type) || types[file.type] !== true) throw new HttpError(400, "유효한 JPG, PNG, WEBP 또는 PDF만 제출할 수 있습니다.");
  if (!file.name || file.name.length > 250) throw new HttpError(400, "파일 이름은 250자 이내로 지정하세요.");
}
async function storeFiles(files: IncomingFile[], userId: string, examId: string | null, submissionId: string | null): Promise<{ files: ExamFile[]; statements: D1PreparedStatement[]; keys: string[] }> {
  if (files.length && !env.BUCKET) throw new HttpError(503, "파일 저장소를 준비 중입니다.", "STORAGE_NOT_CONFIGURED");
  const db = productDatabase();
  const result: { files: ExamFile[]; statements: D1PreparedStatement[]; keys: string[] } = { files: [], statements: [], keys: [] };
  try {
    for (const input of files) {
      const id = makeId();
      const key = `product/${userId}/${id}`;
      const item: ExamFile = { id, name: input.file.name, type: input.file.type, size: input.file.size, role: input.role, order: input.order, url: `/api/product/files/${id}`, ...(input.itemId ? { itemId: input.itemId } : {}) };
      await env.BUCKET!.put(key, await input.file.arrayBuffer(), { httpMetadata: { contentType: item.type } });
      result.keys.push(key);
      result.files.push(item);
      result.statements.push(db.prepare("INSERT INTO product_files (id, owner_id, exam_id, submission_id, object_key, role, data) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, userId, examId, submissionId, key, item.role, JSON.stringify(item)));
    }
    return result;
  } catch (error) { await cleanupFiles(result.keys); throw error; }
}
async function cleanupFiles(keys: string[]) {
  await Promise.all(keys.map(key => env.BUCKET?.delete(key).catch(() => undefined)));
}
function checkFileItems(files: IncomingFile[], items: ExamItem[]): void {
  if (files.some(file => file.itemId && !items.some(item => item.id === file.itemId))) throw new HttpError(400, "파일에 연결한 문항을 시험에서 찾을 수 없습니다.");
}
async function registerAccount(body: Record<string, unknown>, user: ProductUser): Promise<Response> {
  const db = productDatabase();
  if (typeof body.accountType !== "string" || !["teacher", "academy_student", "personal"].includes(body.accountType)) throw new HttpError(400, "계정 유형을 선택하세요.");
  const displayName = requireText(body.displayName, "이름", 80);
  const existing = await getProfile(db, user.id);
  if (existing) {
    if (existing.accountType !== body.accountType) throw new HttpError(409, "가입한 계정 유형은 작업공간에서 변경할 수 없습니다.", "ACCOUNT_TYPE_LOCKED");
    return productJson({ profile: existing });
  }
  // INSERT OR IGNORE makes concurrent registration unable to overwrite the first type.
  await db.prepare("INSERT OR IGNORE INTO product_profiles (user_id, account_type, display_name, created_at) VALUES (?, ?, ?, ?)").bind(user.id, body.accountType, displayName, now()).run();
  const profile = await getProfile(db, user.id);
  if (profile?.accountType !== body.accountType) throw new HttpError(409, "이미 등록된 계정 유형이 있습니다.", "ACCOUNT_TYPE_LOCKED");
  return productJson({ profile }, 201);
}
async function createClass(body: Record<string, unknown>, user: ProductUser): Promise<Response> {
  const db = productDatabase();
  const profile = await requireProfile(db, user.id, ["teacher"]);
  await requireEntitlement(db, user.id, ["teacher"]);
  if (body.billingTeacherId !== user.id) throw new HttpError(400, "새 반의 이용권 담당자는 생성한 선생님으로 명시적으로 선택하세요.", "BILLING_TEACHER_REQUIRED");
  const classroom: ClassRoom = { id: makeId(), name: requireText(body.name, "반 이름", 100), createdBy: user.id, billingTeacherId: user.id, releaseMode: releaseMode(body.releaseMode), studentCode: `S${makeId().replaceAll("-", "").slice(0, 16).toUpperCase()}`, teacherCode: `T${makeId().replaceAll("-", "").slice(0, 16).toUpperCase()}`, createdAt: now() };
  await db.batch([
    db.prepare("INSERT INTO product_classes (id, student_code, teacher_code, data, created_at) VALUES (?, ?, ?, ?, ?)").bind(classroom.id, classroom.studentCode, classroom.teacherCode, JSON.stringify(classroom), classroom.createdAt),
    db.prepare("INSERT INTO product_members (class_id, user_id, role, display_name, joined_at) VALUES (?, ?, 'teacher', ?, ?)").bind(classroom.id, user.id, profile.displayName, classroom.createdAt),
  ]);
  return productJson({ classroom }, 201);
}
async function joinClass(body: Record<string, unknown>, user: ProductUser): Promise<Response> {
  const db = productDatabase();
  const profile = await requireProfile(db, user.id, ["teacher", "academy_student"]);
  const teacher = profile.accountType === "teacher";
  if (teacher) await requireEntitlement(db, user.id, ["teacher"]);
  const code = requireText(body.code, "참여 코드", 40).toUpperCase();
  const row = await db.prepare(teacher ? "SELECT data FROM product_classes WHERE teacher_code = ?" : "SELECT data FROM product_classes WHERE student_code = ?").bind(code).first<DataRow>();
  if (!row) throw new HttpError(404, "계정 유형에 맞는 반 참여 코드를 확인하세요.");
  const classroom = decode<ClassRoom>(row);
  await db.prepare("INSERT OR IGNORE INTO product_members (class_id, user_id, role, display_name, joined_at) VALUES (?, ?, ?, ?, ?)").bind(classroom.id, user.id, teacher ? "teacher" : "student", profile.displayName, now()).run();
  return productJson({ classroom: teacher ? classroom : { ...classroom, teacherCode: undefined, studentCode: undefined } });
}
async function settingsClass(id: string, body: Record<string, unknown>, user: ProductUser): Promise<Response> {
  const db = productDatabase();
  await requireClassTeacher(db, id, user.id, true);
  const classroom = await getClass(db, id);
  const payer = requireText(body.billingTeacherId, "이용권 담당 선생님", 100);
  // Only the selected payer may accept billing responsibility, never another teacher's credits.
  if (payer !== classroom.billingTeacherId && payer !== user.id) throw new HttpError(403, "이용권 담당 변경은 비용을 부담할 선생님 본인이 수락해야 합니다.", "BILLING_CONSENT_REQUIRED");
  await requireClassTeacher(db, id, payer, true);
  const updated = { ...classroom, billingTeacherId: payer, releaseMode: releaseMode(body.releaseMode, classroom.releaseMode) };
  await db.prepare("UPDATE product_classes SET data = ? WHERE id = ?").bind(JSON.stringify(updated), id).run();
  return productJson({ classroom: updated });
}
async function saveExam(request: Request, user: ProductUser): Promise<Response> {
  const db = productDatabase();
  const profile = await requireProfile(db, user.id, ["teacher", "personal"]);
  await requireEntitlement(db, user.id, profile.accountType === "teacher" ? ["teacher"] : ["personal_basic", "personal_premium"]);
  const { body, files } = await readUpload(request);
  const createRequestId = optionalText(body.createRequestId, "시험 등록 요청 ID", 100);
  if (createRequestId && !body.id) {
    const prior = await db.prepare("SELECT e.data,e.revision FROM product_exam_requests r JOIN product_exams e ON e.id=r.exam_id WHERE r.user_id = ? AND r.request_id = ? AND e.owner_id = ?").bind(user.id,createRequestId,user.id).first<DataRow>();
    if (prior) return productJson({exam:{...decode<Exam>(prior),revision:prior.revision}},200);
  }
  const id = optionalText(body.id, "시험 ID", 100) || makeId();
  noLegacy(id);
  const classId = optionalText(body.classId, "반 ID", 100) || null;
  if (classId) await requireClassTeacher(db, classId, user.id, true);
  const row = await db.prepare("SELECT data, revision FROM product_exams WHERE id = ?").bind(id).first<DataRow>();
  const previous = row ? { ...decode<Exam>(row), revision: row.revision! } : null;
  if (previous && previous.ownerId !== user.id) throw new HttpError(403, "직접 등록한 시험만 변경할 수 있습니다.");
  if (previous) revision(body.revision, previous.revision);
  const items = validateItems(body.items);
  checkFileItems(files, items);
  if (files.some(file => file.role === "answer")) throw new HttpError(400, "학생 답안은 시험 자료가 아닌 제출 메뉴에 올리세요.");
  const retainedIds = body.retainedFileIds ?? previous?.files.map(file => file.id) ?? [];
  if (!Array.isArray(retainedIds) || new Set(retainedIds).size !== retainedIds.length || retainedIds.some(id => typeof id !== "string" || !previous?.files.some(file => file.id === id))) throw new HttpError(400, "기존 파일 목록과 중복 여부를 확인하세요.");
  const retained = retainedIds.map(id => { const file = previous!.files.find(file => file.id === id)!; return file.itemId && !items.some(item => item.id === file.itemId) ? {...file,itemId:undefined} : file; });
  if (![...retained, ...files].some(file => file.role === "problem" || file.role === "mixed")) throw new HttpError(400, "문제지 파일을 한 개 이상 등록하세요.");
  if (retained.length + files.length > maximumFiles) throw new HttpError(400, "시험 자료는 최대 12개까지 등록할 수 있습니다.");
  if (retained.reduce((sum, file) => sum + file.size, 0) + files.reduce((sum, entry) => sum + entry.file.size, 0) > maximumTotal) throw new HttpError(413, "시험 자료의 전체 용량은 60MB 이하여야 합니다.");
  const classroom = classId ? await getClass(db, classId) : null;
  const exam: Exam = { id, ownerId: user.id, classId, title: requireText(body.title, "시험 이름", 200), sourceLabel: body.sourceLabel === undefined ? previous?.sourceLabel ?? "" : optionalText(body.sourceLabel, "문제 출처", 500), sourceUrl: body.sourceUrl === undefined ? previous?.sourceUrl ?? "" : sourceUrl(body.sourceUrl), items, files: [], releaseMode: releaseMode(body.releaseMode, classroom?.releaseMode ?? (profile.accountType === "personal" ? "ai_immediate" : "teacher_review")), revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? now(), ...(previous?.originContributionId ? { originContributionId: previous.originContributionId } : {}) };
  const stored = await storeFiles(files, user.id, id, null);
  exam.files = [...retained, ...stored.files].map((file, order) => ({ ...file, order }));
  try {
    const write = previous ? db.prepare("UPDATE product_exams SET class_id = ?, data = ?, revision = ? WHERE id = ? AND owner_id = ? AND revision = ?").bind(classId, JSON.stringify(exam), exam.revision, id, user.id, previous.revision) : db.prepare("INSERT INTO product_exams (id, owner_id, class_id, data, revision, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, user.id, classId, JSON.stringify(exam), exam.revision, exam.createdAt);
    const fileWrites = stored.files.map((file, index) => db.prepare("INSERT INTO product_files (id, owner_id, exam_id, submission_id, object_key, role, data) SELECT ?, ?, ?, NULL, ?, ?, ? FROM product_exams WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM json_each(product_exams.data, '$.files') f WHERE json_extract(f.value, '$.id') = ?)").bind(file.id, user.id, id, stored.keys[index], file.role, JSON.stringify(file), id, exam.revision, file.id));
    const requests = !previous && createRequestId ? [db.prepare("INSERT INTO product_exam_requests (user_id,request_id,exam_id) VALUES (?,?,?)").bind(user.id,createRequestId,id)] : [];
    const writes = await db.batch([write, ...fileWrites, ...requests]);
    if (!writes[0].meta.changes) {
      throw new HttpError(409, "시험이 변경되었습니다. 새로고침 후 다시 저장하세요.", "REVISION_CONFLICT");
    }
  } catch (error) {
    await cleanupFiles(stored.keys);
    if (!previous && createRequestId) {
      const prior = await db.prepare("SELECT e.data,e.revision FROM product_exam_requests r JOIN product_exams e ON e.id=r.exam_id WHERE r.user_id = ? AND r.request_id = ? AND e.owner_id = ?").bind(user.id,createRequestId,user.id).first<DataRow>();
      if (prior) return productJson({exam:{...decode<Exam>(prior),revision:prior.revision}},200);
    }
    throw error;
  }
  return productJson({ exam }, previous ? 200 : 201);
}
async function createAssignment(body: Record<string, unknown>, user: ProductUser): Promise<Response> {
  const db = productDatabase();
  const classId = requireText(body.classId, "반 ID", 100);
  await requireClassTeacher(db, classId, user.id, true);
  const exam = await getExam(db, requireText(body.examId, "시험 ID", 100));
  if (exam.ownerId !== user.id && exam.classId !== classId) throw new HttpError(403, "본인 또는 담당 반의 시험만 배정할 수 있습니다.");
  if (exam.classId && exam.classId !== classId) throw new HttpError(403, "다른 반에 등록된 시험을 바로 배정할 수 없습니다.");
  if (!exam.files.some(file => file.role === "problem" || file.role === "mixed")) throw new HttpError(400, "문제 자료를 등록한 후 배정하세요.");
  const due = optionalText(body.dueAt, "마감일", 100);
  if (due && !Number.isFinite(Date.parse(due))) throw new HttpError(400, "마감일을 확인하세요.");
  const assignment: ExamAssignment = { id: makeId(), classId, exam, title: requireText(body.title, "과제 이름", 200), dueAt: due ? new Date(due).toISOString() : null, createdAt: now() };
  await db.prepare("INSERT INTO product_assignments (id, class_id, exam_id, data, created_at) VALUES (?, ?, ?, ?, ?)").bind(assignment.id, classId, exam.id, JSON.stringify(assignment), assignment.createdAt).run();
  return productJson({ assignment }, 201);
}
async function fetchSubmission(db: D1Database, id: string): Promise<ExamSubmission> {
  const row = await db.prepare("SELECT data, revision FROM product_submissions WHERE id = ?").bind(id).first<DataRow>();
  if (!row) throw new HttpError(404, "시험 첨삭 기록을 찾을 수 없습니다.");
  return { ...decode<ExamSubmission>(row), revision: row.revision! };
}
async function submissionAccess(db: D1Database, item: ExamSubmission, userId: string): Promise<"teacher" | "student"> {
  if (item.classId) {
    const member = await classMembership(db, item.classId, userId);
    const profile = await getProfile(db, userId);
    if (member?.role === "teacher" && profile?.accountType === "teacher") return "teacher";
  }
  if (item.studentId === userId) return "student";
  throw new HttpError(403, "이 학생의 시험 기록에 접근할 수 없습니다.", "SUBMISSION_ACCESS_DENIED");
}
async function visibleSubmission(db: D1Database, item: ExamSubmission, teacher: boolean): Promise<ExamSubmission> {
  if (teacher) return item;
  const published = await db.prepare("SELECT data FROM product_versions WHERE submission_id = ? AND published = 1 ORDER BY version DESC LIMIT 1").bind(item.id).first<DataRow>();
  const latestVersion = published ? decode<FeedbackVersion>(published) : null;
  return { ...item, exam: studentExam(item.exam), latestVersion, visibility: latestVersion ? "visible" : "private", reviewStatus: latestVersion?.teacherReviewed ? "reviewed" : "unreviewed" };
}
async function getDetail(db: D1Database, id: string, user: ProductUser): Promise<SubmissionDetail> {
  if (id.startsWith("legacy:")) return legacyDetail(db, id.slice(7), user);
  const item = await fetchSubmission(db, id);
  const access = await submissionAccess(db, item, user.id);
  const teacher = access === "teacher";
  const [versions, messages] = await db.batch([
    db.prepare(teacher ? "SELECT data FROM product_versions WHERE submission_id = ? ORDER BY version DESC" : "SELECT data FROM product_versions WHERE submission_id = ? AND published = 1 ORDER BY version DESC").bind(id),
    db.prepare("SELECT data FROM product_messages WHERE submission_id = ? ORDER BY created_at, id").bind(id),
  ]);
  return { submission: await visibleSubmission(db, item, teacher), versions: (versions.results as unknown as DataRow[]).map(decode<FeedbackVersion>), messages: (messages.results as unknown as DataRow[]).map(decode<ExamMessage>) };
}
async function classPayer(db: D1Database, classId: string): Promise<string> {
  const classroom = await getClass(db, classId);
  if (!classroom.billingTeacherId) throw new HttpError(409, "반의 이용권 담당 선생님을 먼저 지정해야 합니다.", "BILLING_TEACHER_REQUIRED");
  try { await requireClassTeacher(db, classId, classroom.billingTeacherId, true); }
  catch { throw new HttpError(402, "이 반에 지정된 선생님의 이용권을 확인해야 합니다. 학원 학생에게는 별도 요금을 부과하지 않습니다.", "CLASS_ENTITLEMENT_REQUIRED"); }
  return classroom.billingTeacherId;
}
async function createSubmission(request: Request, user: ProductUser): Promise<Response> {
  const db = productDatabase();
  const profile = await requireProfile(db, user.id);
  const { body, files } = await readUpload(request);
  const clientRequestId = requireText(body.clientRequestId, "제출 요청 ID", 100);
  const duplicate = await db.prepare("SELECT data, revision FROM product_submissions WHERE submitted_by = ? AND client_request_id = ?").bind(user.id, clientRequestId).first<DataRow>();
  if (duplicate) {
    const prior = { ...decode<ExamSubmission>(duplicate), revision: duplicate.revision! };
    const access = await submissionAccess(db, prior, user.id);
    return productJson({ submission: await visibleSubmission(db, prior, access === "teacher") });
  }
  if (!files.some(file => file.role === "answer" || file.role === "mixed")) throw new HttpError(400, "손글씨 풀이 사진 또는 답안 PDF를 첨부하세요.");
  if (files.some(file => file.role === "solution" || file.role === "rubric")) throw new HttpError(400, "답지와 채점기준은 선생님의 시험 자료 등록에서 추가하세요.");
  const assignmentId = optionalText(body.assignmentId, "과제 ID", 100) || null;
  const suppliedExamId = optionalText(body.examId, "시험 ID", 100) || null;
  if (assignmentId && suppliedExamId) throw new HttpError(400, "배정된 과제와 개인 시험 중 하나를 선택하세요.");
  let classId: string | null = null;
  let studentId = user.id;
  let studentName = profile.displayName;
  let billingUserId = user.id;
  let exam: Exam;
  let createDirectExam = false;
  const timestamp = now();
  if (assignmentId) {
    noLegacy(assignmentId);
    if (profile.accountType === "personal") throw new HttpError(403, "개인 계정에서는 학원 과제를 제출할 수 없습니다.");
    const assignmentRow = await db.prepare("SELECT data FROM product_assignments WHERE id = ?").bind(assignmentId).first<DataRow>();
    if (!assignmentRow) throw new HttpError(404, "배정된 시험을 찾을 수 없습니다.");
    const assignment = decode<ExamAssignment>(assignmentRow);
    classId = assignment.classId;
    if (body.classId && body.classId !== classId) throw new HttpError(400, "선택한 반과 과제가 일치하지 않습니다.");
    const member = await classMembership(db, classId, user.id);
    if (!member) throw new HttpError(403, "참여한 반의 시험만 제출할 수 있습니다.");
    if (profile.accountType === "teacher") {
      await requireClassTeacher(db, classId, user.id, true);
      studentId = requireText(body.studentId, "대리 제출할 학생", 100);
      const target = await classMembership(db, classId, studentId);
      const targetProfile = await getProfile(db, studentId);
      if (target?.role !== "student" || targetProfile?.accountType !== "academy_student") throw new HttpError(403, "이 반에 소속된 학원 학생을 선택하세요.");
      studentName = target.displayName;
    } else {
      if (member.role !== "student" || (body.studentId && body.studentId !== user.id)) throw new HttpError(403, "본인 답안만 제출할 수 있습니다.");
    }
    billingUserId = await classPayer(db, classId);
    exam = assignment.exam;
    if (files.some(file => file.role === "problem")) throw new HttpError(400, "과제의 문제지는 이미 등록되어 있습니다. 답안 또는 문제·답안 혼합 파일로 제출하세요.");
  } else {
    if (profile.accountType !== "personal") throw new HttpError(403, "학원 제출은 반에 배정된 시험을 선택하세요.", "ASSIGNMENT_REQUIRED");
    await requireEntitlement(db, user.id, ["personal_basic", "personal_premium"]);
    if (body.classId || (body.studentId && body.studentId !== user.id)) throw new HttpError(403, "개인 계정은 본인 시험만 제출할 수 있습니다.");
    if (suppliedExamId) {
      noLegacy(suppliedExamId);
      exam = await getExam(db, suppliedExamId);
      if (exam.ownerId !== user.id || exam.classId) throw new HttpError(403, "본인 개인 학습공간의 시험만 선택할 수 있습니다.");
      if (exam.originContributionId) await requireEntitlement(db, user.id, ["personal_premium"]);
    } else {
      if (!files.some(file => file.role === "problem" || file.role === "mixed")) throw new HttpError(400, "문제 파일과 답안 파일을 함께 첨부하세요. 한 파일이면 문제·답안 혼합으로 선택하세요.");
      exam = { id: makeId(), ownerId: user.id, classId: null, title: requireText(body.title, "시험 이름", 200), sourceLabel: requireText(body.sourceLabel, "문제 출처", 500), sourceUrl: sourceUrl(body.sourceUrl), items: [], files: [], releaseMode: "ai_immediate", revision: 1, createdAt: timestamp };
      createDirectExam = true;
    }
  }
  checkFileItems(files, exam.items);
  const item: ExamSubmission = { id: makeId(), studentId, studentName, submittedBy: user.id, classId, assignmentId, billingUserId, exam, files: [], question: optionalText(body.question, "궁금한 점", 10000), processing: "not_configured", visibility: "private", reviewStatus: "unreviewed", releaseMode: exam.releaseMode, latestVersion: null, revision: 1, createdAt: timestamp, updatedAt: timestamp };
  // Direct problems are tied to their saved exam as well as the submission, so future use retains the original.
  const stored = await storeFiles(files, user.id, createDirectExam ? exam.id : null, item.id);
  item.files = stored.files;
  if (createDirectExam) item.exam.files = stored.files.filter(file => file.role === "problem" || file.role === "mixed");
  const writes: D1PreparedStatement[] = [];
  if (createDirectExam) writes.push(db.prepare("INSERT INTO product_exams (id, owner_id, class_id, data, revision, created_at) VALUES (?, ?, NULL, ?, 1, ?)").bind(exam.id, user.id, JSON.stringify(item.exam), timestamp));
  writes.push(db.prepare("INSERT INTO product_submissions (id, student_id, submitted_by, class_id, assignment_id, billing_user_id, data, revision, client_request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)").bind(item.id, studentId, user.id, classId, assignmentId, billingUserId, JSON.stringify(item), clientRequestId, timestamp), ...stored.statements);
  try {
    if (profile.accountType === "academy_student") writes.push(...await notificationWrites(db,item,"submission",`submission:${item.id}`));
    await db.batch(writes);
  }
  catch (error) {
    await cleanupFiles(stored.keys);
    const prior = await db.prepare("SELECT data, revision FROM product_submissions WHERE submitted_by = ? AND client_request_id = ?").bind(user.id, clientRequestId).first<DataRow>();
    if (prior) {
      const previous = { ...decode<ExamSubmission>(prior), revision: prior.revision! };
      const access = await submissionAccess(db, previous, user.id);
      return productJson({ submission: await visibleSubmission(db, previous, access === "teacher") });
    }
    throw error;
  }
  return productJson({ submission: await visibleSubmission(db, item, profile.accountType === "teacher") }, 201);
}
async function saveReview(id: string, body: Record<string, unknown>, user: ProductUser): Promise<Response> {
  noLegacy(id);
  const db = productDatabase();
  const item = await fetchSubmission(db, id);
  if (!item.classId) throw new HttpError(403, "담당 반의 시험만 선생님 첨삭을 추가할 수 있습니다.");
  await requireClassTeacher(db, item.classId, user.id, true);
  revision(body.revision, item.revision);
  if (typeof body.publish !== "boolean") throw new HttpError(400, "임시 저장 또는 확정 공개를 선택하세요.");
  const result = validateExamResult(body.result, item, body.publish);
  const profile = await requireProfile(db, user.id, ["teacher"]);
  const timestamp = now();
  const version: FeedbackVersion = { id: makeId(), submissionId: id, version: (item.latestVersion?.version ?? 0) + 1, authorId: user.id, authorName: profile.displayName, authorType: "teacher", createdAt: timestamp, result, teacherReviewed: body.publish, published: body.publish };
  const updated: ExamSubmission = { ...item, latestVersion: version, revision: item.revision + 1, updatedAt: timestamp, visibility: body.publish ? "visible" : item.visibility, reviewStatus: body.publish ? "reviewed" : item.reviewStatus };
  const notices = body.publish ? await notificationWrites(db,updated,"feedback",`feedback:${version.id}`) : [];
  const writes = await db.batch([
    db.prepare("UPDATE product_submissions SET data = ?, revision = ? WHERE id = ? AND revision = ?").bind(JSON.stringify(updated), updated.revision, id, item.revision),
    db.prepare("INSERT INTO product_versions (id, submission_id, version, published, data, created_at) SELECT ?, ?, ?, ?, ?, ? FROM product_submissions WHERE id = ? AND revision = ? AND json_extract(data, '$.latestVersion.id') = ?").bind(version.id, id, version.version, body.publish ? 1 : 0, JSON.stringify(version), timestamp, id, updated.revision, version.id),
    ...notices,
  ]);
  if (!writes[0].meta.changes) throw new HttpError(409, "첨삭 기록이 변경되었습니다. 최신 기록을 불러와 주세요.", "REVISION_CONFLICT");
  return productJson({ submission: updated, version });
}
/** Internal provider completion hook. Never exposed as an HTTP endpoint or callable by a browser. */
export async function ingestAnalysisResult(db: D1Database, id: string, expectedRevision: number, rawResult: unknown): Promise<ExamSubmission> {
  const item = await fetchSubmission(db, id);
  revision(expectedRevision, item.revision);
  const previousUsage = await db.prepare("SELECT id FROM product_usage WHERE submission_id = ?").bind(id).first();
  if (previousUsage) throw new HttpError(409, "이미 완료된 AI 요청입니다.", "ANALYSIS_ALREADY_COMPLETED");
  const payer = item.classId ? await classPayer(db, item.classId) : item.studentId;
  if (payer !== item.billingUserId) throw new HttpError(409, "제출 후 이용권 담당이 변경되었습니다. 새 요청으로 확인해야 합니다.", "BILLING_CHANGED");
  const entitlement = await requireEntitlement(db, payer, item.classId ? ["teacher"] : ["personal_basic", "personal_premium"]);
  if (entitlement.analysisLimit === null) throw new HttpError(503, "첨삭 제공 횟수 정책이 아직 설정되지 않았습니다.", "USAGE_POLICY_NOT_CONFIGURED");
  if (entitlement.used >= entitlement.analysisLimit) throw new HttpError(429, "이용권의 첨삭 횟수를 모두 사용했습니다.", "USAGE_LIMIT_REACHED");
  const result = validateExamResult(rawResult, item, true);
  const timestamp = now();
  const published = item.releaseMode === "ai_immediate";
  const version: FeedbackVersion = { id: makeId(), submissionId: id, version: (item.latestVersion?.version ?? 0) + 1, authorId: "ai", authorName: "AI 첨삭", authorType: "ai", createdAt: timestamp, result, teacherReviewed: false, published };
  const updated: ExamSubmission = { ...item, latestVersion: version, processing: "completed", visibility: published ? "visible" : item.visibility, reviewStatus: "unreviewed", revision: item.revision + 1, updatedAt: timestamp };
  const usageId = makeId();
  const notices = published ? await notificationWrites(db,updated,"feedback",`feedback:${version.id}`) : [];
  const reward = usageRewardPolicy();
  const rewardWrites: D1PreparedStatement[] = [];
  if (item.exam.originContributionId && reward.amount !== null && entitlement.plan === "personal_premium") rewardWrites.push(db.prepare("INSERT OR IGNORE INTO product_point_events (id,user_id,contribution_id,learner_id,kind,amount,policy_version,created_at) SELECT ?,c.contributor_id,c.id,?,'usage_reward',?,?,? FROM product_contributions c WHERE c.id = ? AND c.status = 'published' AND c.contributor_id != ? AND EXISTS (SELECT 1 FROM product_usage WHERE id = ?)").bind(makeId(),item.studentId,reward.amount,reward.version,timestamp,item.exam.originContributionId,item.studentId,usageId));
  const writes = await db.batch([
    db.prepare("UPDATE product_submissions SET data = ?, revision = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM product_entitlements WHERE user_id = ? AND status = 'active' AND analysis_limit IS NOT NULL AND used < analysis_limit AND (expires_at IS NULL OR expires_at > ?)) AND (? IS NULL OR EXISTS (SELECT 1 FROM product_classes WHERE id = ? AND json_extract(data, '$.billingTeacherId') = ?))").bind(JSON.stringify(updated), updated.revision, id, item.revision, payer, timestamp, item.classId, item.classId, payer),
    db.prepare("INSERT INTO product_versions (id, submission_id, version, published, data, created_at) SELECT ?, ?, ?, ?, ?, ? FROM product_submissions WHERE id = ? AND revision = ? AND json_extract(data, '$.latestVersion.id') = ?").bind(version.id, id, version.version, published ? 1 : 0, JSON.stringify(version), timestamp, id, updated.revision, version.id),
    db.prepare("INSERT INTO product_usage (id, user_id, submission_id, created_at) SELECT ?, ?, ?, ? FROM product_versions WHERE id = ?").bind(usageId, payer, id, timestamp, version.id),
    db.prepare("UPDATE product_entitlements SET used = used + 1 WHERE user_id = ? AND EXISTS (SELECT 1 FROM product_usage WHERE id = ?)").bind(payer, usageId),
    ...notices, ...rewardWrites,
  ]);
  if (!writes[0].meta.changes) throw new HttpError(409, "기록 또는 이용권이 변경되었습니다.", "REVISION_CONFLICT");
  return updated;
}
async function analyze(id: string, body: Record<string, unknown>, user: ProductUser): Promise<Response> {
  noLegacy(id);
  const db = productDatabase();
  const item = await fetchSubmission(db, id);
  await submissionAccess(db, item, user.id);
  revision(body.revision, item.revision);
  if (item.classId) await classPayer(db, item.classId);
  else { await requireProfile(db, user.id, ["personal"]); await requireEntitlement(db, user.id, ["personal_basic", "personal_premium"]); }
  // All originals and the optional question are ready in one bundle. No fabricated provider success.
  prepareAnalysisInput(item);
  throw new HttpError(503, "AI 연결을 준비 중입니다. 문제·답안·질문은 함께 저장되었고 첨삭 횟수는 차감되지 않았습니다.", "AI_NOT_CONFIGURED");
}
async function addMessage(id: string, body: Record<string, unknown>, user: ProductUser): Promise<Response> {
  noLegacy(id);
  const db = productDatabase();
  const item = await fetchSubmission(db, id);
  const role = await submissionAccess(db, item, user.id);
  if (!item.classId) throw new HttpError(409, "선생님과의 대화는 소속 반의 시험 기록에서 이용할 수 있습니다.", "CLASS_CHAT_REQUIRED");
  const profile = await requireProfile(db, user.id);
  const itemId = optionalText(body.itemId, "관련 문항", 100) || null;
  if (itemId && !item.exam.items.some(part => part.id === itemId) && !item.latestVersion?.result.items.some(part => part.itemId === itemId)) throw new HttpError(400, "관련 문항을 확인하세요.");
  const message: ExamMessage = { id: makeId(), submissionId: id, authorId: user.id, authorName: profile.displayName, authorRole: role, itemId, text: requireText(body.text, "대화 내용", 5000), createdAt: now() };
  await db.prepare("INSERT INTO product_messages (id, submission_id, author_id, data, created_at) VALUES (?, ?, ?, ?, ?)").bind(message.id, id, user.id, JSON.stringify(message), message.createdAt).run();
  return productJson({ message }, 201);
}
async function fileResponse(db: D1Database, id: string, user: ProductUser): Promise<Response> {
  const row = await db.prepare("SELECT owner_id, exam_id, submission_id, object_key, role, data FROM product_files WHERE id = ?").bind(id).first<{ owner_id: string; exam_id: string | null; submission_id: string | null; object_key: string; role: ExamFileRole; data: string }>();
  if (!row) throw new HttpError(404, "파일을 찾을 수 없습니다.");
  // A proxy uploader does not retain student-file access after leaving the class.
  let allowed = !row.submission_id && row.owner_id === user.id;
  if (row.submission_id) {
    const submission = await fetchSubmission(db, row.submission_id);
    try { await submissionAccess(db, submission, user.id); allowed = true; } catch { /* Continue to assignment reference access. */ }
  }
  if (!allowed && row.exam_id) {
    const exam = await getExam(db, row.exam_id);
    if (exam.classId) {
      const member = await classMembership(db, exam.classId, user.id);
      if (member?.role === "teacher") {
        const profile = await getProfile(db, user.id);
        allowed = profile?.accountType === "teacher";
      }
    }
    if (!allowed) {
      const assignments = await db.prepare("SELECT a.data, m.role FROM product_assignments a JOIN product_members m ON m.class_id = a.class_id WHERE a.exam_id = ? AND m.user_id = ?").bind(row.exam_id, user.id).all<DataRow & { role: string }>();
      allowed = assignments.results.some(assignmentRow => {
        const assignment = decode<ExamAssignment>(assignmentRow);
        return assignment.exam.files.some(file => file.id === id) && (assignmentRow.role === "teacher" || row.role === "problem" || row.role === "mixed");
      });
    }
  }
  if (!allowed) throw new HttpError(403, "이 파일에 접근할 수 없습니다.");
  const object = await env.BUCKET?.get(row.object_key);
  if (!object) throw new HttpError(404, "원본 파일을 찾을 수 없습니다.");
  const file = decode<ExamFile>(row);
  return new Response(object.body, { headers: { "Content-Type": file.type, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
}
function legacyExam(question: Question): Exam {
  return {
    id: `legacy:${question.id}`, ownerId: question.ownerId, classId: null, title: question.title,
    sourceLabel: question.sourceLabel, sourceUrl: question.sourceUrl,
    items: question.criteria.map(criterion => ({ id: criterion.id, label: criterion.title, maxScore: criterion.max, criteria: criterion.description })),
    files: (question.references ?? []).map((file, order) => ({ ...file, role: file.kind === "rubric" ? "rubric" : "problem", order })),
    releaseMode: "teacher_review", revision: question.revision, createdAt: question.createdAt, legacyId: question.id, legacyPrompt: question.prompt,
  };
}
function legacySubmission(item: Submission, teacher: boolean): ExamSubmission {
  const exam = legacyExam(item.question);
  const review = teacher ? item.draft ?? item.final : item.status === "approved" ? item.final : null;
  const approved = item.status === "approved" && review === item.final;
  const reviewItems = review ? item.question.criteria.map((criterion, index) => ({ itemId: criterion.id, label: criterion.title, score: review.scores[index] ?? 0, maxScore: criterion.max, evidence: review.evidence[index] ?? "", feedback: "", solution: "", uncertainty: "" })) : [];
  const latestVersion: FeedbackVersion | null = review ? { id: `legacy:${item.id}:${item.revision}`, submissionId: `legacy:${item.id}`, version: item.revision, authorId: review.reviewerId, authorName: "기존 선생님 첨삭", authorType: "teacher", createdAt: review.reviewedAt, teacherReviewed: approved, published: approved,
    result: { items: reviewItems, total: reviewItems.reduce((sum, entry) => sum + entry.score, 0), maximum: reviewItems.reduce((sum, entry) => sum + entry.maxScore, 0), summary: review.feedback, questionResponse: review.questionResponse ?? "", basis: "provided", uncertainties: [] } } : null;
  const files: ExamFile[] = [];
  if (item.problemAttachment) files.push({ ...item.problemAttachment, role: "problem", order: 0 });
  if (item.attachment) files.push({ ...item.attachment, role: "answer", order: files.length });
  return { id: `legacy:${item.id}`, studentId: item.studentId, studentName: item.studentCode, submittedBy: item.studentId, classId: item.academyId ? `legacy:${item.academyId}` : null, assignmentId: item.assignmentId ? `legacy:${item.assignmentId}` : null, billingUserId: "", exam: teacher ? exam : studentExam(exam), files, question: item.studentQuestion ?? "", processing: "not_configured", visibility: approved ? "visible" : "private", reviewStatus: approved ? "reviewed" : "unreviewed", releaseMode: "teacher_review", latestVersion, revision: item.revision, createdAt: item.createdAt, updatedAt: item.updatedAt, legacyId: item.id, legacyAnswer: item.answer };
}
async function legacyDetail(db: D1Database, id: string, user: ProductUser): Promise<SubmissionDetail> {
  const row = await db.prepare("SELECT data, revision FROM submissions WHERE id = ?").bind(id).first<DataRow>();
  if (!row) throw new HttpError(404, "기존 기록을 찾을 수 없습니다.");
  const old = { ...decode<Submission>(row), revision: row.revision! };
  const owner = old.academyId ? await db.prepare("SELECT id FROM academies WHERE id = ? AND owner_id = ?").bind(old.academyId, user.id).first() : null;
  if (old.studentId !== user.id && !owner) throw new HttpError(403, "기존 기록에 접근할 수 없습니다.");
  const submission = legacySubmission(old, Boolean(owner));
  return { submission, versions: submission.latestVersion ? [submission.latestVersion] : [], messages: [] };
}
async function workspaceState(request: Request): Promise<Response> {
  const user = await productIdentity(request);
  const state: ProductState = { user, profile: null, entitlement: null, classes: [], members: [], exams: [], assignments: [], submissions: [], contributions: [], points: [], capabilities: { storageReady: Boolean(env.DB && env.BUCKET), aiConfigured: false, billingConfigured: false }, policy: { pricesConfigured: false, ...contributionPolicy() } };
  if (!user || !env.DB) return productJson(state);
  const db = productDatabase();
  [state.profile, state.entitlement] = await Promise.all([getProfile(db, user.id), getEntitlement(db, user.id)]);
  const values = await db.batch([
    db.prepare("SELECT c.data, m.role FROM product_classes c JOIN product_members m ON c.id = m.class_id WHERE m.user_id = ? ORDER BY c.created_at DESC").bind(user.id),
    db.prepare("SELECT m.class_id AS classId, m.user_id AS userId, m.role, m.display_name AS displayName, m.joined_at AS joinedAt FROM product_members m WHERE m.user_id = ? OR EXISTS (SELECT 1 FROM product_members own WHERE own.class_id = m.class_id AND own.user_id = ? AND own.role = 'teacher')").bind(user.id, user.id),
    db.prepare("SELECT e.data, e.revision FROM product_exams e WHERE e.owner_id = ? OR EXISTS (SELECT 1 FROM product_members m WHERE m.class_id = e.class_id AND m.user_id = ? AND m.role = 'teacher') ORDER BY e.created_at DESC").bind(user.id, user.id),
    db.prepare("SELECT a.data, m.role FROM product_assignments a JOIN product_members m ON m.class_id = a.class_id WHERE m.user_id = ? ORDER BY a.created_at DESC").bind(user.id),
    db.prepare("SELECT s.data, s.revision FROM product_submissions s WHERE s.student_id = ? OR EXISTS (SELECT 1 FROM product_members m WHERE m.class_id = s.class_id AND m.user_id = ? AND m.role = 'teacher') ORDER BY s.created_at DESC").bind(user.id, user.id),
    db.prepare("SELECT s.data, s.revision, a.owner_id FROM submissions s LEFT JOIN academies a ON a.id = s.academy_id WHERE s.student_id = ? OR a.owner_id = ? ORDER BY s.created_at DESC").bind(user.id, user.id),
    db.prepare("SELECT data, revision FROM questions WHERE owner_id = ? ORDER BY created_at DESC").bind(user.id),
  ]);
  state.classes = (values[0].results as unknown as (DataRow & { role: string })[]).map(row => {
    const classroom = decode<ClassRoom>(row);
    return row.role === "teacher" ? classroom : { ...classroom, studentCode: undefined, teacherCode: undefined };
  });
  state.members = values[1].results as unknown as ProductState["members"];
  state.exams = (values[2].results as unknown as DataRow[]).map(row => ({ ...decode<Exam>(row), revision: row.revision! }));
  state.assignments = (values[3].results as unknown as (DataRow & { role: string })[]).map(row => {
    const item = decode<ExamAssignment>(row);
    return row.role === "teacher" ? item : { ...item, exam: studentExam(item.exam) };
  });
  const teacherClasses = new Set(state.members.filter(member => member.userId === user.id && member.role === "teacher").map(member => member.classId));
  state.submissions = await Promise.all((values[4].results as unknown as DataRow[]).map(row => {
    const item = { ...decode<ExamSubmission>(row), revision: row.revision! };
    return visibleSubmission(db, item, Boolean(item.classId && teacherClasses.has(item.classId)));
  }));
  state.submissions.push(...(values[5].results as unknown as (DataRow & { owner_id: string | null })[]).map(row => legacySubmission({ ...decode<Submission>(row), revision: row.revision! }, row.owner_id === user.id)));
  state.exams.push(...(values[6].results as unknown as DataRow[]).map(row => legacyExam({ ...decode<Question>(row), revision: row.revision! })));
  Object.assign(state, await getProductContributions(db, user));
  state.points = await pointLedger(db,user.id);
  return productJson(state);
}
export async function handleProductApi(request: Request, path = new URL(request.url).pathname.replace(/^\/api\/product\/?/, "")): Promise<Response> {
  try {
    if (request.method === "GET" && path === "state") return await workspaceState(request);
    const user = await requireProductUser(request);
    const db = productDatabase();
    if (request.method === "GET") {
      if (/^files\/[^/]+$/.test(path)) return await fileResponse(db, decodeURIComponent(path.split("/")[1]), user);
      if (/^submissions\/[^/]+(?:\/report)?$/.test(path)) {
        const detail = await getDetail(db, decodeURIComponent(path.split("/")[1]), user);
        if (path.endsWith("/report") && !detail.submission.latestVersion) throw new HttpError(409, "아직 출력할 첨삭 결과가 없습니다.", "RESULT_NOT_READY");
        return productJson(detail);
      }
    }
    if (request.method === "POST") {
      checkProductOrigin(request);
      if (path === "exams") return await saveExam(request, user);
      if (path === "submissions") return await createSubmission(request, user);
      const body = await readProductJson(request);
      if (path === "account") return await registerAccount(body, user);
      if (path === "classes") return await createClass(body, user);
      if (path === "classes/join") return await joinClass(body, user);
      if (/^classes\/[^/]+\/settings$/.test(path)) return await settingsClass(path.split("/")[1], body, user);
      if (path === "assignments") return await createAssignment(body, user);
      if (/^submissions\/[^/]+\/review$/.test(path)) return await saveReview(decodeURIComponent(path.split("/")[1]), body, user);
      if (/^submissions\/[^/]+\/analyze$/.test(path)) return await analyze(decodeURIComponent(path.split("/")[1]), body, user);
      if (/^submissions\/[^/]+\/messages$/.test(path)) return await addMessage(decodeURIComponent(path.split("/")[1]), body, user);
    }
    throw new HttpError(404, "요청한 기능을 찾을 수 없습니다.");
  } catch (error) {
    if (error instanceof HttpError) return productJson({ error: error.message, code: error.code }, error.status);
    console.error("Product operation failed", error instanceof Error ? error.message : "Unknown error");
    return productJson({ error: "저장 중 문제가 발생했습니다. 입력 내용은 유지하고 다시 시도해 주세요.", code: "OPERATION_FAILED" }, 500);
  }
}

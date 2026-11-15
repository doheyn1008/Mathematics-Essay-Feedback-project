import { env } from "cloudflare:workers";
import type { Academy, AdmissionRecord, Assignment, Attachment, Question, Submission, WorkspaceState } from "../types";
import { finiteNumber, HttpError, optionalText, requireText, seoulDay, sourceUrl, validateCriteria, validateReview } from "./validation";

type Row = { data: string; revision: number };
type User = NonNullable<WorkspaceState["user"]>;
const maximumUpload = 15 * 1024 * 1024;

function database(): D1Database {
  if (!env.DB) throw new HttpError(503, "저장소 연결을 준비 중입니다.", "STORAGE_NOT_CONFIGURED");
  return env.DB;
}

function identity(request: Request): User | null {
  const id = request.headers.get("oai-authenticated-user-id");
  if (!id) return null;
  const email = request.headers.get("oai-authenticated-user-email") ?? "";
  let name = request.headers.get("oai-authenticated-user-full-name") ?? "";
  if (request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { name = decodeURIComponent(name); } catch { name = ""; }
  }
  return { id, email, name: name || email || "사용자" };
}

function requireUser(request: Request): User {
  const user = identity(request);
  if (!user) throw new HttpError(401, "로그인 후 이용하세요.", "AUTH_REQUIRED");
  return user;
}

function checkOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, "요청 출처를 확인할 수 없습니다.");
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function bodyJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > maximumUpload + 100000) throw new HttpError(413, "요청 용량이 너무 큽니다.");
  try {
    const body = await request.json();
    if (!body || Array.isArray(body) || typeof body !== "object") throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new HttpError(400, "입력 내용을 확인하세요."); }
}

async function ownedAcademy(id: string, userId: string): Promise<Academy> {
  const row = await database().prepare("SELECT id, owner_id AS ownerId, name, join_code AS joinCode, created_at AS createdAt FROM academies WHERE id = ? AND owner_id = ?").bind(id, userId).first<Academy>();
  if (!row) throw new HttpError(403, "담당 학원의 선생님만 변경할 수 있습니다.");
  return row;
}

async function canViewSubmission(item: Submission, userId: string): Promise<boolean> {
  if (item.studentId === userId) return true;
  if (!item.academyId) return false;
  return Boolean(await database().prepare("SELECT id FROM academies WHERE id = ? AND owner_id = ?").bind(item.academyId, userId).first());
}

function decode<T>(row: { data: string }): T { return JSON.parse(row.data) as T; }

async function fetchSubmission(id: string): Promise<Submission> {
  const row = await database().prepare("SELECT data, revision FROM submissions WHERE id = ?").bind(id).first<Row>();
  if (!row) throw new HttpError(404, "답안을 찾을 수 없습니다.");
  return { ...decode<Submission>(row), revision: row.revision };
}

async function visibleSubmission(item: Submission, userId: string): Promise<Submission> {
  const teacher = item.academyId && await database().prepare("SELECT id FROM academies WHERE id = ? AND owner_id = ?").bind(item.academyId, userId).first();
  if (teacher) return item;
  return { ...item, draft: null, final: item.status === "approved" ? item.final : null };
}

async function workspaceState(request: Request): Promise<Response> {
  const user = identity(request);
  const day = seoulDay();
  const result: WorkspaceState = {
    user, academies: [], memberships: [], questions: [], assignments: [], submissions: [], admissions: [],
    usage: { limit: 3, used: 0, remaining: 3, day }, ai: { configured: false }, storageReady: Boolean(env.DB && env.BUCKET),
  };
  if (!user || !env.DB) return json(result);
  const db = database();
  const values = await db.batch([
    db.prepare("SELECT DISTINCT a.id, a.owner_id AS ownerId, a.name, a.join_code AS joinCode, a.created_at AS createdAt FROM academies a LEFT JOIN memberships m ON a.id = m.academy_id WHERE a.owner_id = ? OR m.user_id = ? ORDER BY a.created_at DESC").bind(user.id, user.id),
    db.prepare("SELECT academy_id AS academyId, user_id AS userId FROM memberships WHERE user_id = ?").bind(user.id),
    db.prepare("SELECT data, revision FROM questions WHERE owner_id = ? ORDER BY created_at DESC").bind(user.id),
    db.prepare("SELECT a.data FROM assignments a JOIN academies ac ON a.academy_id = ac.id WHERE ac.owner_id = ? OR EXISTS (SELECT 1 FROM memberships m WHERE m.academy_id = a.academy_id AND m.user_id = ?) ORDER BY a.created_at DESC").bind(user.id, user.id),
    db.prepare("SELECT s.data, s.revision FROM submissions s LEFT JOIN academies a ON s.academy_id = a.id WHERE s.student_id = ? OR a.owner_id = ? ORDER BY s.created_at DESC").bind(user.id, user.id),
    db.prepare("SELECT data FROM admission_records WHERE owner_id = ? ORDER BY created_at DESC").bind(user.id),
    db.prepare("SELECT COUNT(*) AS used FROM usage_events WHERE user_id = ? AND day = ?").bind(user.id, day),
  ]);
  result.academies = (values[0].results as unknown as Academy[]).map((item) => item.ownerId === user.id ? item : { ...item, joinCode: undefined });
  result.memberships = values[1].results as unknown as WorkspaceState["memberships"];
  result.questions = (values[2].results as unknown as Row[]).map((row) => ({ ...decode<Question>(row), revision: row.revision }));
  result.assignments = (values[3].results as unknown as Row[]).map(decode<Assignment>);
  const owned = new Set(result.academies.filter((item) => item.ownerId === user.id).map((item) => item.id));
  result.submissions = (values[4].results as unknown as Row[]).map((row) => {
    const item = { ...decode<Submission>(row), revision: row.revision };
    return item.academyId && owned.has(item.academyId) ? item : { ...item, draft: null, final: item.status === "approved" ? item.final : null };
  });
  result.admissions = (values[5].results as unknown as Row[]).map(decode<AdmissionRecord>);
  result.usage.used = Number((values[6].results[0] as { used: number })?.used ?? 0);
  result.usage.remaining = Math.max(0, result.usage.limit - result.usage.used);
  return json(result);
}

async function createAcademy(body: Record<string, unknown>, user: User): Promise<Response> {
  const academy: Academy = { id: crypto.randomUUID(), name: requireText(body.name, "학원 이름", 100), ownerId: user.id, joinCode: crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(), createdAt: new Date().toISOString() };
  const db = database();
  await db.batch([
    db.prepare("INSERT INTO academies (id, owner_id, name, join_code, created_at) VALUES (?, ?, ?, ?, ?)").bind(academy.id, user.id, academy.name, academy.joinCode, academy.createdAt),
    db.prepare("INSERT INTO memberships (academy_id, user_id, created_at) VALUES (?, ?, ?)").bind(academy.id, user.id, academy.createdAt),
  ]);
  return json({ academy }, 201);
}

async function joinAcademy(body: Record<string, unknown>, user: User): Promise<Response> {
  const code = requireText(body.code, "참여 코드", 30).toUpperCase();
  const row = await database().prepare("SELECT id, name, owner_id AS ownerId, created_at AS createdAt FROM academies WHERE join_code = ?").bind(code).first<Academy>();
  if (!row) throw new HttpError(404, "참여 코드를 확인하세요.");
  await database().prepare("INSERT OR IGNORE INTO memberships (academy_id, user_id, created_at) VALUES (?, ?, ?)").bind(row.id, user.id, new Date().toISOString()).run();
  return json({ academy: row });
}

async function saveQuestion(body: Record<string, unknown>, user: User): Promise<Response> {
  const id = optionalText(body.id, "문항 ID", 100) || crypto.randomUUID();
  const academyId = optionalText(body.academyId, "학원 ID", 100) || null;
  if (academyId) await ownedAcademy(academyId, user.id);
  const existing = await database().prepare("SELECT owner_id, data, revision FROM questions WHERE id = ?").bind(id).first<Row & { owner_id: string }>();
  if (existing && existing.owner_id !== user.id) throw new HttpError(403, "본인이 등록한 문항만 수정할 수 있습니다.");
  if (existing && body.revision !== existing.revision) throw new HttpError(409, "문항이 변경되었습니다. 새로고침 후 다시 저장하세요.", "REVISION_CONFLICT");
  const question: Question = {
    id, ownerId: user.id, academyId, revision: (existing?.revision ?? 0) + 1,
    title: requireText(body.title, "문항 제목", 200), prompt: requireText(body.prompt, "문제 본문", 20000),
    university: optionalText(body.university, "대학 이름", 100), department: optionalText(body.department, "모집단위", 150),
    examKey: optionalText(body.examKey, "시험 비교 기준", 150),
    academicYear: body.academicYear == null || body.academicYear === "" ? null : finiteNumber(body.academicYear, "학년도", 2000, 2100),
    sourceUrl: sourceUrl(body.sourceUrl), sourceLabel: requireText(body.sourceLabel, "문항 출처", 500),
    notes: optionalText(body.notes, "채점 유의사항", 15000), criteria: validateCriteria(body.criteria),
    createdAt: existing ? decode<Question>(existing).createdAt : new Date().toISOString(),
    references: existing ? decode<Question>(existing).references ?? [] : [],
  };
  if (question.academicYear !== null && !Number.isInteger(question.academicYear)) throw new HttpError(400, "학년도를 정수로 입력하세요.");
  if (existing) {
    const update = await database().prepare("UPDATE questions SET academy_id = ?, data = ?, revision = ? WHERE id = ? AND owner_id = ? AND revision = ?").bind(academyId, JSON.stringify(question), question.revision, id, user.id, existing.revision).run();
    if (!update.meta.changes) throw new HttpError(409, "다른 창에서 문항이 변경되었습니다.", "REVISION_CONFLICT");
  } else {
    await database().prepare("INSERT INTO questions (id, owner_id, academy_id, data, revision, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, user.id, academyId, JSON.stringify(question), question.revision, question.createdAt).run();
  }
  return json({ question }, existing ? 200 : 201);
}

async function createAssignment(body: Record<string, unknown>, user: User): Promise<Response> {
  const academyId = requireText(body.academyId, "학원 ID", 100);
  await ownedAcademy(academyId, user.id);
  const questionId = requireText(body.questionId, "문항 ID", 100);
  const row = await database().prepare("SELECT data FROM questions WHERE id = ? AND owner_id = ?").bind(questionId, user.id).first<Row>();
  if (!row) throw new HttpError(404, "등록된 문항을 선택하세요.");
  const due = optionalText(body.dueAt, "제출 기한", 100);
  if (due && !Number.isFinite(Date.parse(due))) throw new HttpError(400, "제출 기한을 확인하세요.");
  const assignment: Assignment = { id: crypto.randomUUID(), academyId, title: requireText(body.title, "과제 이름", 200), question: decode<Question>(row), dueAt: due ? new Date(due).toISOString() : null, createdAt: new Date().toISOString() };
  await database().prepare("INSERT INTO assignments (id, academy_id, data, created_at) VALUES (?, ?, ?, ?)").bind(assignment.id, academyId, JSON.stringify(assignment), assignment.createdAt).run();
  return json({ assignment }, 201);
}

async function submissionPayload(request: Request): Promise<{ body: Record<string, unknown>; file: File | null }> {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) return { body: await bodyJson(request), file: null };
  if (Number(request.headers.get("content-length")) > maximumUpload + 100000) throw new HttpError(413, "파일은 15MB까지 첨부할 수 있습니다.");
  let form: FormData;
  try { form = await request.formData(); } catch { throw new HttpError(400, "첨부 파일을 읽을 수 없습니다."); }
  let body;
  try { body = JSON.parse(String(form.get("payload"))); } catch { throw new HttpError(400, "답안 정보를 확인하세요."); }
  if (!body || Array.isArray(body) || typeof body !== "object") throw new HttpError(400, "답안 정보를 확인하세요.");
  const value = form.get("file");
  const file = value instanceof File && value.size ? value : null;
  if (file && file.size > maximumUpload) throw new HttpError(413, "파일은 15MB까지 첨부할 수 있습니다.");
  return { body, file };
}

async function validateFile(file: File): Promise<void> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = new TextDecoder().decode(head);
  const types: Record<string, boolean> = {
    "image/jpeg": head[0] === 255 && head[1] === 216 && head[2] === 255,
    "image/png": head[0] === 137 && ascii.slice(1, 4) === "PNG",
    "image/webp": ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP",
    "application/pdf": ascii.startsWith("%PDF-"),
  };
  if (!types[file.type]) throw new HttpError(400, "유효한 JPG, PNG, WEBP 또는 PDF 파일을 첨부하세요.");
}

async function createSubmission(request: Request, user: User): Promise<Response> {
  const { body, file } = await submissionPayload(request);
  const mode = body.mode;
  if (mode !== "academy" && mode !== "personal") throw new HttpError(400, "제출 유형을 선택하세요.");
  const clientRequestId = optionalText(body.clientRequestId, "요청 ID", 100) || crypto.randomUUID();
  const duplicate = await database().prepare("SELECT data FROM submissions WHERE student_id = ? AND client_request_id = ?").bind(user.id, clientRequestId).first<Row>();
  if (duplicate) return json({ submission: await visibleSubmission(decode<Submission>(duplicate), user.id) });
  const answer = optionalText(body.answer, "학생 풀이", 50000);
  const studentCode = optionalText(body.studentCode, "학생 코드", 80) || user.name;
  if (!answer && !file) throw new HttpError(400, "학생 풀이를 입력하거나 원본 파일을 첨부하세요.");
  let academyId: string | null = null;
  let assignmentId: string | null = null;
  let question: Question;
  if (mode === "academy") {
    assignmentId = requireText(body.assignmentId, "과제 ID", 100);
    const row = await database().prepare("SELECT a.data FROM assignments a JOIN memberships m ON m.academy_id = a.academy_id WHERE a.id = ? AND m.user_id = ?").bind(assignmentId, user.id).first<Row>();
    if (!row) throw new HttpError(403, "참여한 학원의 과제만 제출할 수 있습니다.");
    const assignment = decode<Assignment>(row);
    academyId = assignment.academyId;
    question = assignment.question;
  } else {
    const questionId = requireText(body.questionId, "문항 ID", 100);
    const row = await database().prepare("SELECT data FROM questions WHERE id = ? AND owner_id = ?").bind(questionId, user.id).first<Row>();
    if (!row) throw new HttpError(404, "첨삭할 문항을 등록하고 선택하세요.");
    question = decode<Question>(row);
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let attachment: Attachment | null = null;
  let objectKey = "";
  if (file) {
    if (!env.BUCKET) throw new HttpError(503, "원본 파일 저장소 연결을 준비 중입니다.");
    await validateFile(file);
    const attachmentId = crypto.randomUUID();
    objectKey = `answers/${id}/${attachmentId}`;
    attachment = { id: attachmentId, name: file.name.slice(0, 200), type: file.type, size: file.size, url: `/api/attachments/${attachmentId}` };
    await env.BUCKET.put(objectKey, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  }
  const item: Submission = { id, studentId: user.id, studentCode, academyId, assignmentId, mode, question, answer, attachment, status: "pending", draft: null, final: null, revision: 1, createdAt: now, updatedAt: now };
  const db = database();
  try {
    const writes = [db.prepare("INSERT INTO submissions (id, student_id, academy_id, assignment_id, mode, data, revision, client_request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, user.id, academyId, assignmentId, mode, JSON.stringify(item), 1, clientRequestId, now)];
    if (attachment) writes.push(db.prepare("INSERT INTO attachments (id, submission_id, object_key, name, content_type, size) VALUES (?, ?, ?, ?, ?, ?)").bind(attachment.id, id, objectKey, attachment.name, attachment.type, attachment.size));
    await db.batch(writes);
  } catch (error) {
    if (objectKey) await env.BUCKET?.delete(objectKey);
    const existing = await db.prepare("SELECT data FROM submissions WHERE student_id = ? AND client_request_id = ?").bind(user.id, clientRequestId).first<Row>();
    if (existing) return json({ submission: await visibleSubmission(decode<Submission>(existing), user.id) });
    throw error;
  }
  return json({ submission: item }, 201);
}

async function reviewSubmission(id: string, body: Record<string, unknown>, user: User): Promise<Response> {
  const item = await fetchSubmission(id);
  if (!item.academyId) throw new HttpError(403, "학원 선생님은 담당 학원 답안만 확정할 수 있습니다.");
  await ownedAcademy(item.academyId, user.id);
  if (body.revision !== item.revision) throw new HttpError(409, "다른 창에서 첨삭이 수정되었습니다. 최신 답안을 다시 열어주세요.", "REVISION_CONFLICT");
  if (!["draft", "approve", "reopen"].includes(String(body.action))) throw new HttpError(400, "채점 작업을 확인하세요.");
  if (body.action === "reopen") {
    if (item.status !== "approved") throw new HttpError(409, "확정된 답안만 다시 열 수 있습니다.");
    item.status = "draft";
    item.draft = item.final;
  } else {
    if (item.status === "approved") throw new HttpError(409, "채점을 다시 연 뒤 수정하세요.");
    item.draft = validateReview(body, item.question.criteria, user.id);
    item.status = body.action === "approve" ? "approved" : "draft";
    if (body.action === "approve") item.final = item.draft;
  }
  const previousRevision = item.revision;
  item.revision += 1;
  item.updatedAt = new Date().toISOString();
  const write = await database().prepare("UPDATE submissions SET data = ?, revision = ? WHERE id = ? AND revision = ?").bind(JSON.stringify(item), item.revision, id, previousRevision).run();
  if (!write.meta.changes) throw new HttpError(409, "다른 창에서 첨삭이 수정되었습니다.", "REVISION_CONFLICT");
  return json({ submission: item });
}

async function attachmentResponse(id: string, user: User): Promise<Response> {
  const attachment = await database().prepare("SELECT submission_id, object_key, name, content_type FROM attachments WHERE id = ?").bind(id).first<{ submission_id: string; object_key: string; name: string; content_type: string }>();
  if (!attachment) throw new HttpError(404, "원본 파일을 찾을 수 없습니다.");
  const item = await fetchSubmission(attachment.submission_id);
  if (!await canViewSubmission(item, user.id)) throw new HttpError(403, "이 답안을 볼 권한이 없습니다.");
  const object = await env.BUCKET?.get(attachment.object_key);
  if (!object) throw new HttpError(404, "원본 파일을 찾을 수 없습니다.");
  return new Response(object.body, { headers: { "Content-Type": attachment.content_type, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" } });
}

async function addQuestionReference(id: string, request: Request, user: User): Promise<Response> {
  if (!env.BUCKET) throw new HttpError(503, "원본 파일 저장소 연결을 준비 중입니다.");
  const row = await database().prepare("SELECT data, revision FROM questions WHERE id = ? AND owner_id = ?").bind(id, user.id).first<Row>();
  if (!row) throw new HttpError(403, "본인이 등록한 문항에만 자료를 첨부할 수 있습니다.");
  if (Number(request.headers.get("content-length")) > maximumUpload + 100000) throw new HttpError(413, "파일은 15MB까지 첨부할 수 있습니다.");
  let form: FormData;
  try { form = await request.formData(); } catch { throw new HttpError(400, "첨부 파일을 읽을 수 없습니다."); }
  const file = form.get("file");
  const kind = form.get("kind");
  if (!(file instanceof File) || !file.size || file.size > maximumUpload) throw new HttpError(400, "15MB 이하의 파일을 선택하세요.");
  if (kind !== "problem" && kind !== "rubric") throw new HttpError(400, "문제 또는 채점기준 자료를 선택하세요.");
  if (Number(form.get("revision")) !== row.revision) throw new HttpError(409, "문항이 변경되었습니다. 최신 문항에서 다시 첨부하세요.", "REVISION_CONFLICT");
  await validateFile(file);
  const attachmentId = crypto.randomUUID();
  const key = `references/${id}/${attachmentId}`;
  const question = decode<Question>(row);
  if ((question.references?.length ?? 0) >= 10) throw new HttpError(400, "문항별 참고자료는 10개까지 등록할 수 있습니다.");
  const reference: Attachment & { kind: "problem" | "rubric" } = { id: attachmentId, name: file.name.slice(0, 200), type: file.type, size: file.size, kind, url: `/api/references/${attachmentId}` };
  question.references = [...(question.references ?? []), reference];
  question.revision = row.revision + 1;
  await env.BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const db = database();
  try {
    const writes = await db.batch([
      db.prepare("UPDATE questions SET data = ?, revision = ? WHERE id = ? AND owner_id = ? AND revision = ?").bind(JSON.stringify(question), question.revision, id, user.id, row.revision),
      db.prepare("INSERT INTO question_attachments (id, owner_id, question_id, object_key, name, content_type, size, kind, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? FROM questions WHERE id = ? AND revision = ? AND json_extract(data, '$.references[#-1].id') = ?").bind(attachmentId, user.id, id, key, reference.name, file.type, file.size, kind, new Date().toISOString(), id, question.revision, attachmentId),
    ]);
    if (!writes[0].meta.changes) throw new HttpError(409, "다른 창에서 문항이 변경되었습니다.", "REVISION_CONFLICT");
  } catch (error) {
    await env.BUCKET.delete(key);
    throw error;
  }
  return json({ question }, 201);
}

async function questionReferenceResponse(id: string, user: User): Promise<Response> {
  const reference = await database().prepare("SELECT object_key, name, content_type FROM question_attachments WHERE id = ? AND owner_id = ?").bind(id, user.id).first<{ object_key: string; name: string; content_type: string }>();
  if (!reference) throw new HttpError(404, "등록한 참고자료를 찾을 수 없습니다.");
  const object = await env.BUCKET?.get(reference.object_key);
  if (!object) throw new HttpError(404, "원본 파일을 찾을 수 없습니다.");
  return new Response(object.body, { headers: { "Content-Type": reference.content_type, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(reference.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" } });
}

export async function getApprovedReports(request: Request, ids: string[]): Promise<Submission[]> {
  const user = requireUser(request);
  if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length) throw new HttpError(400, "확정 답안을 1~50개 선택하세요.");
  const results: Submission[] = [];
  for (const id of ids) {
    const item = await fetchSubmission(id);
    if (!await canViewSubmission(item, user.id)) throw new HttpError(403, "이 답안을 볼 권한이 없습니다.");
    if (item.status !== "approved" || !item.final) throw new HttpError(409, "선생님이 확정한 답안만 리포트로 출력할 수 있습니다.");
    results.push({ ...item, draft: null });
  }
  return results;
}

async function saveAdmission(body: Record<string, unknown>, user: User): Promise<Response> {
  const id = optionalText(body.id, "입시자료 ID", 100);
  const existing = id ? await database().prepare("SELECT data FROM admission_records WHERE id = ? AND owner_id = ?").bind(id, user.id).first<Row>() : null;
  if (id && !existing) throw new HttpError(404, "본인이 등록한 입시자료를 선택하세요.");
  const previous = existing ? decode<AdmissionRecord>(existing) : null;
  if (previous && body.revision !== (previous.revision ?? 1)) throw new HttpError(409, "입시자료가 변경되었습니다. 최신 자료에서 다시 수정하세요.", "REVISION_CONFLICT");
  const metric = body.metric ?? "minimum";
  const pointType = body.pointType ?? "essay";
  if (!["minimum", "average", "percentile70"].includes(String(metric))) throw new HttpError(400, "성적 지표를 확인하세요.");
  if (!["essay", "total", "school"].includes(String(pointType))) throw new HttpError(400, "점수 종류를 확인하세요.");
  const scale = finiteNumber(body.scale, "만점", 1, 10000);
  const record: AdmissionRecord = {
    id: id || crypto.randomUUID(), revision: (previous?.revision ?? (previous ? 1 : 0)) + 1, ownerId: user.id, university: requireText(body.university, "대학 이름", 100), department: requireText(body.department, "모집단위", 150),
    academicYear: finiteNumber(body.academicYear, "학년도", 2000, 2100), examKey: requireText(body.examKey, "시험 비교 기준", 150),
    score: finiteNumber(body.score, "입시결과 점수", 0, scale), scale, metric: metric as AdmissionRecord["metric"], pointType: pointType as AdmissionRecord["pointType"],
    sourceUrl: sourceUrl(body.sourceUrl, true), sourceLabel: requireText(body.sourceLabel, "자료 출처", 500), createdAt: previous?.createdAt ?? new Date().toISOString(),
  };
  if (!Number.isInteger(record.academicYear)) throw new HttpError(400, "학년도를 정수로 입력하세요.");
  if (existing) {
    const update = await database().prepare("UPDATE admission_records SET data = ? WHERE id = ? AND owner_id = ? AND data = ?").bind(JSON.stringify(record), record.id, user.id, existing.data).run();
    if (!update.meta.changes) throw new HttpError(409, "다른 창에서 입시자료가 변경되었습니다.", "REVISION_CONFLICT");
  } else {
    await database().prepare("INSERT INTO admission_records (id, owner_id, data, created_at) VALUES (?, ?, ?, ?)").bind(record.id, user.id, JSON.stringify(record), record.createdAt).run();
  }
  return json({ record }, existing ? 200 : 201);
}

export async function handleApi(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
    if (request.method === "GET" && path === "state") return await workspaceState(request);
    const user = requireUser(request);
    if (request.method === "GET") {
      if (path.startsWith("references/")) return await questionReferenceResponse(path.split("/")[1], user);
      if (path.startsWith("attachments/")) return await attachmentResponse(path.split("/")[1], user);
      if (path === "report-data") return json({ submissions: await getApprovedReports(request, (url.searchParams.get("ids") ?? "").split(",").filter(Boolean)) });
      if (/^submissions\/[^/]+$/.test(path)) {
        const item = await fetchSubmission(path.split("/")[1]);
        if (!await canViewSubmission(item, user.id)) throw new HttpError(403, "이 답안을 볼 권한이 없습니다.");
        return json({ submission: await visibleSubmission(item, user.id) });
      }
    }
    if (request.method === "POST") {
      checkOrigin(request);
      if (path === "submissions") return await createSubmission(request, user);
      if (/^questions\/[^/]+\/references$/.test(path)) return await addQuestionReference(path.split("/")[1], request, user);
      const body = await bodyJson(request);
      if (path === "academies") return await createAcademy(body, user);
      if (path === "join") return await joinAcademy(body, user);
      if (path === "questions") return await saveQuestion(body, user);
      if (path === "assignments") return await createAssignment(body, user);
      if (/^submissions\/[^/]+\/review$/.test(path)) return await reviewSubmission(path.split("/")[1], body, user);
      if (path === "admissions") return await saveAdmission(body, user);
      if (path === "analyze") {
        const item = await fetchSubmission(requireText(body.submissionId, "답안 ID", 100));
        if (!await canViewSubmission(item, user.id)) throw new HttpError(403, "이 답안을 첨삭할 권한이 없습니다.");
        throw new HttpError(503, "AI 연결을 준비 중입니다. 답안은 저장되었으며 첨삭 횟수는 차감되지 않았습니다.", "AI_NOT_CONFIGURED");
      }
    }
    throw new HttpError(404, "요청한 기능을 찾을 수 없습니다.");
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
    console.error("Workspace operation failed", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "처리 중 문제가 발생했습니다. 입력 내용을 유지하고 다시 시도해 주세요.", code: "OPERATION_FAILED" }, 500);
  }
}

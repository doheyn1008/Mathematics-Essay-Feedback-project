import { env } from "cloudflare:workers";
import type { Contribution, ContributionPoint, Exam, ExamFile } from "../product-types";
import { getExam, getProfile, requireProfile, requireEntitlement, readProductJson, productJson, checkProductOrigin, type ProductUser } from "./product-auth";
import { HttpError, requireText, optionalText, sourceUrl } from "./validation";

const CONSENT_VERSION = "premium-reuse-v1";
const CONSENT_SCOPE = "개인용 유료 프리미엄 회원에게 문제 자료를 제공하고 해당 회원이 학습·첨삭에 이용하는 것에 동의합니다. 학생 답안과 비공개 참고자료는 포함하지 않습니다.";
type DataRow = { data: string };
const decode = <T>(row: DataRow) => JSON.parse(row.data) as T;
export function contributionPolicy() {
  const config = env as unknown as Record<string, unknown>;
  const amount = Number(config.CONTRIBUTION_POINTS);
  const version = typeof config.CONTRIBUTION_POLICY_VERSION === "string" ? config.CONTRIBUTION_POLICY_VERSION.trim() : "";
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 100000 && version
    ? { contributionPoints: amount, contributionPolicyVersion: version }
    : { contributionPoints: null, contributionPolicyVersion: null };
}
export async function getProductContributions(db: D1Database, user: ProductUser) {
  const profile = await getProfile(db, user.id);
  if (profile?.accountType !== "teacher") return { contributions: [], points: [] };
  const [contributions, points] = await db.batch([
    db.prepare("SELECT data FROM product_contributions WHERE contributor_id = ? ORDER BY created_at DESC").bind(user.id),
    db.prepare("SELECT id, contribution_id AS contributionId, amount, policy_version AS policyVersion, created_at AS createdAt FROM product_points WHERE user_id = ? ORDER BY created_at DESC").bind(user.id),
  ]);
  return { contributions: (contributions.results as unknown as DataRow[]).map(decode<Contribution>), points: points.results as unknown as ContributionPoint[] };
}
async function premium(db: D1Database, user: ProductUser) {
  await requireProfile(db, user.id, ["personal"]);
  await requireEntitlement(db, user.id, ["personal_premium"]);
}
function hex(bytes: ArrayBuffer) { return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join(""); }
async function digest(bytes: Uint8Array) { return hex(await crypto.subtle.digest("SHA-256", bytes as BufferSource)); }
async function objectBytes(key: string) {
  const object = await env.BUCKET?.get(key);
  if (!object) throw new HttpError(404, "기여할 문제 원본을 찾을 수 없습니다.");
  return new Uint8Array(await object.arrayBuffer());
}
async function publish(db: D1Database, user: ProductUser, body: Record<string, unknown>) {
  await requireProfile(db, user.id, ["teacher"]);
  await requireEntitlement(db, user.id, ["teacher"]);
  if (body.rightsConfirmed !== true || body.premiumConfirmed !== true) throw new HttpError(400, "제공 권한과 개인용 유료 프리미엄 제공 동의를 각각 확인하세요.");
  if (body.rightsBasis !== "own" && body.rightsBasis !== "permission") throw new HttpError(400, "본인 창작 또는 제공 허락 근거를 선택하세요.");
  const exam = await getExam(db, requireText(body.examId, "시험 ID", 100));
  if (exam.ownerId !== user.id) throw new HttpError(403, "본인이 만든 시험만 기여할 수 있습니다.");
  if (exam.originContributionId || exam.legacyId) throw new HttpError(409, "가져온 자료나 이전 기록을 다시 기여할 수 없습니다.", "IMPORTED_EXAM");
  const existing = await db.prepare("SELECT data FROM product_contributions WHERE source_exam_id = ?").bind(exam.id).first<DataRow>();
  if (existing) return { contribution: decode<Contribution>(existing), pointsAwarded: 0 };
  if (body.revision !== exam.revision) throw new HttpError(409, "미리 본 시험이 변경되었습니다. 최신 자료를 다시 확인하세요.", "REVISION_CONFLICT");
  const contributorName = requireText(body.contributorName, "공개 작성자 이름", 80);
  const rightsNote = body.rightsBasis === "permission" ? requireText(body.rightsNote, "제공 허락 범위와 근거", 2000) : optionalText(body.rightsNote, "창작 설명", 2000);
  const sourceFiles = exam.files.filter(file => file.role === "problem").sort((a,b) => a.order-b.order);
  if (!sourceFiles.length) throw new HttpError(400, "문제로 분류한 원본 파일이 필요합니다. 답안·혼합 파일은 기여 자료에 포함하지 않습니다.");
  const hashes: string[] = [];
  for (const file of sourceFiles) {
    const row = await db.prepare("SELECT object_key FROM product_files WHERE id = ? AND owner_id = ? AND exam_id = ? AND role = 'problem'").bind(file.id, user.id, exam.id).first<{object_key: string}>();
    if (!row) throw new HttpError(403, "시험에 등록된 본인 문제 원본만 기여할 수 있습니다.");
    hashes.push(await digest(await objectBytes(row.object_key)));
  }
  // Exact file bytes identify the source; case-sensitive mathematical text stays intact.
  const hash = await digest(new TextEncoder().encode(JSON.stringify([...new Set(hashes)].sort())));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const policy = contributionPolicy();
  const files = sourceFiles.map((file,index): ExamFile => ({
    id: file.id, name: `문제자료 ${index+1}.${file.type === "application/pdf" ? "pdf" : file.type.split("/")[1]}`,
    type: file.type, size: file.size, role: "problem", order: index, itemId: file.itemId,
    url: `/api/product/premium/files/${id}/${file.id}`,
  }));
  const snapshot: Exam = {
    id: exam.id, ownerId: "", classId: null, title: exam.title, sourceLabel: requireText(body.sourceLabel ?? exam.sourceLabel, "기여 문제 출처", 500), sourceUrl: sourceUrl(body.sourceUrl ?? exam.sourceUrl),
    items: exam.items.map(item => ({id:item.id,label:item.label,maxScore:item.maxScore,criteria:"",...(item.parentId ? {parentId:item.parentId}: {})})), files, releaseMode: "ai_immediate", revision: exam.revision, createdAt: now,
  };
  const contribution: Contribution = {
    id, sourceExamId: exam.id, sourceRevision: exam.revision, contributorId: user.id, contributorName, exam: snapshot,
    rightsBasis: body.rightsBasis, rightsNote, consentVersion: CONSENT_VERSION, consentScope: CONSENT_SCOPE, consentAt: now,
    status: "published", rewardStatus: policy.contributionPoints === null ? "policy_pending" : "awarded", createdAt: now,
  };
  const writes = [db.prepare("INSERT INTO product_contributions (id, source_exam_id, source_revision, contributor_id, content_hash, data, status, created_at) SELECT ?, ?, ?, ?, ?, ?, 'published', ? FROM product_exams WHERE id = ? AND owner_id = ? AND revision = ?").bind(id, exam.id, exam.revision, user.id, hash, JSON.stringify(contribution), now, exam.id, user.id, exam.revision)];
  if (policy.contributionPoints !== null) writes.push(db.prepare("INSERT INTO product_points (id, user_id, contribution_id, amount, policy_version, created_at) SELECT ?, ?, ?, ?, ?, ? FROM product_contributions WHERE id = ?").bind(crypto.randomUUID(), user.id, id, policy.contributionPoints, policy.contributionPolicyVersion, now, id));
  try {
    const results = await db.batch(writes);
    if (!results[0].meta.changes) throw new HttpError(409, "미리 본 시험이 변경되었습니다. 최신 자료를 다시 확인하세요.", "REVISION_CONFLICT");
  } catch (error) {
    const prior = await db.prepare("SELECT data FROM product_contributions WHERE source_exam_id = ? OR content_hash = ?").bind(exam.id, hash).first<DataRow>();
    if (!prior) throw error;
    const found = decode<Contribution>(prior);
    if (found.contributorId === user.id && found.sourceExamId === exam.id) return { contribution: found, pointsAwarded: 0 };
    throw new HttpError(409, "같은 문제 원본이 이미 기여되었습니다. 중복 적립하지 않습니다.", "DUPLICATE_CONTRIBUTION");
  }
  return { contribution, pointsAwarded: policy.contributionPoints ?? 0 };
}
async function withdraw(db: D1Database, user: ProductUser, id: string) {
  // An expired subscription never prevents a contributor from withdrawing consent.
  const row = await db.prepare("SELECT data FROM product_contributions WHERE id = ? AND contributor_id = ?").bind(id,user.id).first<DataRow>();
  if (!row) throw new HttpError(404, "본인이 기여한 자료를 찾을 수 없습니다.");
  const contribution = {...decode<Contribution>(row), status: "withdrawn" as const};
  await db.prepare("UPDATE product_contributions SET status = 'withdrawn', data = ? WHERE id = ? AND contributor_id = ?").bind(JSON.stringify(contribution),id,user.id).run();
  return { contribution };
}
async function previousImport(db: D1Database, userId: string, id: string) {
  const row = await db.prepare("SELECT e.data FROM product_imports i JOIN product_exams e ON e.id = i.exam_id WHERE i.contribution_id = ? AND i.user_id = ? AND e.owner_id = ?").bind(id,userId,userId).first<DataRow>();
  return row ? decode<Exam>(row) : null;
}
async function importExam(db: D1Database, user: ProductUser, id: string) {
  await premium(db,user);
  const previous = await previousImport(db,user.id,id);
  if (previous) return { exam: previous };
  const row = await db.prepare("SELECT data FROM product_contributions WHERE id = ? AND status = 'published'").bind(id).first<DataRow>();
  if (!row) throw new HttpError(404, "제공 중인 문제를 찾을 수 없습니다.");
  const shared = decode<Contribution>(row);
  const exam: Exam = {...shared.exam, id: crypto.randomUUID(), ownerId: user.id, revision: 1, createdAt: new Date().toISOString(), originContributionId: shared.id};
  try {
    const writes = await db.batch([
      db.prepare("INSERT INTO product_exams (id,owner_id,class_id,data,revision,created_at) SELECT ?,?,NULL,?,1,? FROM product_contributions WHERE id = ? AND status = 'published'").bind(exam.id,user.id,JSON.stringify(exam),exam.createdAt,id),
      db.prepare("INSERT INTO product_imports (contribution_id,user_id,exam_id) SELECT ?,?,? FROM product_exams WHERE id = ?").bind(id,user.id,exam.id,exam.id),
    ]);
    if (!writes[0].meta.changes) throw new HttpError(404, "제공이 중단된 문제입니다.");
  } catch (error) {
    const prior = await previousImport(db,user.id,id);
    if (prior) return { exam: prior };
    throw error;
  }
  return { exam };
}
async function premiumFile(db: D1Database, user: ProductUser, contributionId: string, fileId: string) {
  await premium(db,user);
  const row = await db.prepare("SELECT data, status FROM product_contributions WHERE id = ?").bind(contributionId).first<DataRow & {status: string}>();
  if (!row) throw new HttpError(404, "문제 파일을 찾을 수 없습니다.");
  // Existing imports keep a private learning record after withdrawal; new access stops.
  if (row.status !== "published" && !await previousImport(db,user.id,contributionId)) throw new HttpError(404, "제공이 중단된 문제입니다.");
  const contribution = decode<Contribution>(row);
  const file = contribution.exam.files.find(item => item.id === fileId && item.role === "problem");
  if (!file) throw new HttpError(404, "제공 문제에 포함되지 않은 파일입니다.");
  const record = await db.prepare("SELECT object_key FROM product_files WHERE id = ? AND exam_id = ? AND owner_id = ? AND role = 'problem'").bind(fileId,contribution.sourceExamId,contribution.contributorId).first<{object_key:string}>();
  const object = record && await env.BUCKET?.get(record.object_key);
  if (!object) throw new HttpError(404, "문제 원본을 찾을 수 없습니다.");
  return new Response(object.body,{headers:{"Content-Type":file.type,"Content-Disposition":`inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox"}});
}
export async function handleProductContributionRoute(request: Request, path: string, user: ProductUser, db: D1Database): Promise<Response | null> {
  if (request.method === "GET" && path === "premium") {
    await premium(db,user);
    const result = await db.prepare("SELECT data FROM product_contributions WHERE status = 'published' ORDER BY created_at DESC LIMIT 200").all<DataRow>();
    return productJson({contributions: result.results.map(row => {
      const item = decode<Contribution>(row);
      // Rights evidence remains in the contributor's private audit record.
      return {...item, rightsNote: ""};
    })});
  }
  const file = path.match(/^premium\/files\/([^/]+)\/([^/]+)$/);
  if (request.method === "GET" && file) return premiumFile(db,user,file[1],file[2]);
  if (request.method !== "POST") return null;
  if (path !== "contributions" && !/^contributions\/[^/]+\/withdraw$/.test(path) && !/^premium\/[^/]+\/import$/.test(path)) return null;
  checkProductOrigin(request);
  if (path === "contributions") return productJson(await publish(db,user,await readProductJson(request)),201);
  const id = path.split("/")[1];
  if (path.startsWith("contributions/")) return productJson(await withdraw(db,user,id));
  return productJson(await importExam(db,user,id),201);
}

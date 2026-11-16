import type { PointEvent, Question, SharedQuestion } from "../types";
import { HttpError, optionalText, requireText, sourceUrl, validateCriteria } from "./validation";

type User = { id: string; name: string };
type DataRow = { data: string };
const contributionPoints = 10;

async function isTeacher(db: D1Database, user: User): Promise<boolean> {
  return Boolean(await db.prepare("SELECT id FROM academies WHERE owner_id = ? LIMIT 1").bind(user.id).first());
}
async function requireTeacher(db: D1Database, user: User): Promise<void> {
  if (!await isTeacher(db, user)) throw new HttpError(403, "학원 선생님만 공유 문항을 등록하거나 가져올 수 있습니다.");
}
const decode = <T>(row: DataRow): T => JSON.parse(row.data) as T;

export async function getSharingState(db: D1Database, user: User): Promise<{ sharedQuestions: SharedQuestion[]; points: { balance: number; events: PointEvent[] } }> {
  if (!await isTeacher(db, user)) return { sharedQuestions: [], points: { balance: 0, events: [] } };
  const [shared, events, balance] = await db.batch([
    db.prepare("SELECT data FROM shared_questions WHERE status = 'published' OR contributor_id = ? ORDER BY created_at DESC LIMIT 200").bind(user.id),
    db.prepare("SELECT id, amount, reason, shared_question_id AS sharedQuestionId, created_at AS createdAt FROM point_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").bind(user.id),
    db.prepare("SELECT COALESCE(SUM(amount), 0) AS balance FROM point_events WHERE user_id = ?").bind(user.id),
  ]);
  return {
    sharedQuestions: (shared.results as unknown as DataRow[]).map(decode<SharedQuestion>),
    points: { balance: Number((balance.results[0] as { balance: number }).balance), events: events.results as unknown as PointEvent[] },
  };
}

async function contentHash(prompt: string): Promise<string> {
  // Whitespace does not identify a new problem; case and mathematical glyphs do.
  const normalized = prompt.normalize("NFC").replace(/\s+/gu, "");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
}

export async function publishSharedQuestion(db: D1Database, user: User, body: Record<string, unknown>): Promise<{ sharedQuestion: SharedQuestion; pointsAwarded: number }> {
  await requireTeacher(db, user);
  if (body.rightsConfirmed !== true || body.shareConfirmed !== true) throw new HttpError(400, "공개 이용 권한과 공유 범위를 각각 확인해 주세요.");
  if (body.rightsBasis !== "own" && body.rightsBasis !== "permission") throw new HttpError(400, "본인 창작 또는 게시 허락 여부를 선택하세요.");
  const questionId = requireText(body.questionId, "문항 ID", 100);
  const row = await db.prepare("SELECT data, revision FROM questions WHERE id = ? AND owner_id = ?").bind(questionId, user.id).first<DataRow & { revision: number }>();
  if (!row) throw new HttpError(403, "본인이 등록한 문항만 공유할 수 있습니다.");
  const question = decode<Question>(row);
  if (question.originSharedId) throw new HttpError(409, "가져온 공유 문항은 다시 기여 등록할 수 없습니다.", "IMPORTED_QUESTION");
  const contributorName = requireText(body.contributorName, "공개 작성자 이름", 80);
  const rightsNote = body.rightsBasis === "permission" ? requireText(body.rightsNote, "게시 허락 범위와 근거", 2000) : optionalText(body.rightsNote, "창작 설명", 2000);
  const title = requireText(question.title, "문항 제목", 200);
  const prompt = requireText(question.prompt, "공개할 문제 본문", 20000);
  const criteria = validateCriteria(question.criteria);
  const label = requireText(question.sourceLabel, "문항 출처", 500);
  const url = sourceUrl(question.sourceUrl);
  const existing = await db.prepare("SELECT data FROM shared_questions WHERE source_question_id = ?").bind(questionId).first<DataRow>();
  if (existing) return { sharedQuestion: decode<SharedQuestion>(existing), pointsAwarded: 0 };
  if (body.revision !== row.revision) throw new HttpError(409, "미리 본 문항이 변경되었습니다. 최신 내용을 다시 확인해 주세요.", "REVISION_CONFLICT");
  const hash = await contentHash(prompt);
  const now = new Date().toISOString();
  const sharedQuestion: SharedQuestion = {
    id: crypto.randomUUID(), sourceQuestionId: question.id, contributorId: user.id, contributorName,
    title, prompt, criteria, university: optionalText(question.university, "대학 이름", 100), academicYear: question.academicYear,
    sourceLabel: label, sourceUrl: url, rightsBasis: body.rightsBasis, rightsNote,
    createdAt: now, status: "published",
  };
  try {
    const writes = await db.batch([
      db.prepare("INSERT INTO shared_questions (id, source_question_id, contributor_id, content_hash, data, status, created_at) SELECT ?, ?, ?, ?, ?, ?, ? FROM questions WHERE id = ? AND owner_id = ? AND revision = ?").bind(sharedQuestion.id, questionId, user.id, hash, JSON.stringify(sharedQuestion), "published", now, questionId, user.id, row.revision),
      db.prepare("INSERT INTO point_events (id, user_id, shared_question_id, amount, reason, created_at) SELECT ?, ?, ?, ?, ?, ? FROM shared_questions WHERE id = ?").bind(crypto.randomUUID(), user.id, sharedQuestion.id, contributionPoints, "공개 문항 기여", now, sharedQuestion.id),
    ]);
    if (!writes[0].meta.changes) throw new HttpError(409, "미리 본 문항이 변경되었습니다. 최신 내용을 다시 확인해 주세요.", "REVISION_CONFLICT");
  } catch (error) {
    const prior = await db.prepare("SELECT data FROM shared_questions WHERE source_question_id = ? OR content_hash = ?").bind(questionId, hash).first<DataRow>();
    if (!prior) throw error;
    const item = decode<SharedQuestion>(prior);
    if (item.sourceQuestionId === questionId && item.contributorId === user.id) return { sharedQuestion: item, pointsAwarded: 0 };
    throw new HttpError(409, "동일한 문제 본문이 이미 기여 등록되어 있습니다. 중복 문항에는 포인트가 지급되지 않습니다.", "DUPLICATE_CONTRIBUTION");
  }
  return { sharedQuestion, pointsAwarded: contributionPoints };
}

export async function withdrawSharedQuestion(db: D1Database, user: User, id: string): Promise<{ sharedQuestion: SharedQuestion }> {
  await requireTeacher(db, user);
  const row = await db.prepare("SELECT data FROM shared_questions WHERE id = ? AND contributor_id = ?").bind(id, user.id).first<DataRow>();
  if (!row) throw new HttpError(404, "본인이 공유한 문항을 찾을 수 없습니다.");
  const sharedQuestion = { ...decode<SharedQuestion>(row), status: "withdrawn" as const };
  await db.prepare("UPDATE shared_questions SET status = 'withdrawn', data = ? WHERE id = ? AND contributor_id = ?").bind(JSON.stringify(sharedQuestion), id, user.id).run();
  return { sharedQuestion };
}

async function previousImport(db: D1Database, user: User, id: string): Promise<Question | null> {
  const row = await db.prepare("SELECT q.data FROM shared_imports i JOIN questions q ON q.id = i.question_id WHERE i.shared_question_id = ? AND i.user_id = ? AND q.owner_id = ?").bind(id, user.id, user.id).first<DataRow>();
  return row ? decode<Question>(row) : null;
}

export async function importSharedQuestion(db: D1Database, user: User, id: string): Promise<{ question: Question }> {
  await requireTeacher(db, user);
  const previous = await previousImport(db, user, id);
  if (previous) return { question: previous };
  const row = await db.prepare("SELECT data FROM shared_questions WHERE id = ? AND status = 'published'").bind(id).first<DataRow>();
  if (!row) throw new HttpError(404, "공유 중인 문항을 찾을 수 없습니다.");
  const shared = decode<SharedQuestion>(row);
  const question: Question = {
    id: crypto.randomUUID(), ownerId: user.id, academyId: null, revision: 1,
    title: shared.title, prompt: shared.prompt, university: shared.university, academicYear: shared.academicYear,
    department: "", examKey: "", sourceUrl: shared.sourceUrl,
    sourceLabel: `${shared.sourceLabel} · 공유 작성자: ${shared.contributorName}`.slice(0, 500),
    notes: "", criteria: shared.criteria.map(criterion => ({ ...criterion })), references: [],
    createdAt: new Date().toISOString(), originSharedId: shared.id,
  };
  try {
    const writes = await db.batch([
      db.prepare("INSERT INTO questions (id, owner_id, academy_id, data, revision, created_at) SELECT ?, ?, ?, ?, ?, ? FROM shared_questions WHERE id = ? AND status = 'published'").bind(question.id, user.id, null, JSON.stringify(question), question.revision, question.createdAt, id),
      db.prepare("INSERT INTO shared_imports (shared_question_id, user_id, question_id) SELECT ?, ?, ? FROM questions WHERE id = ?").bind(id, user.id, question.id, question.id),
    ]);
    if (!writes[0].meta.changes) throw new HttpError(404, "공유가 중단된 문항입니다.");
  } catch (error) {
    const imported = await previousImport(db, user, id);
    if (imported) return { question: imported };
    throw error;
  }
  return { question };
}

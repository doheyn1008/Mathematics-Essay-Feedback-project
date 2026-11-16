import type { AdmissionLine } from "../product-admission-types";
import type { ExamSubmission, FeedbackScore } from "../product-types";
import type { AdmissionRecord } from "../types";
import { productJson } from "./product-auth";
import { finiteNumber, HttpError, optionalText, requireText, sourceUrl } from "./validation";

type StoredReference = AdmissionRecord & {
  revision: number;
  productExamId: string;
  productExamRevision: number;
};
type ReferenceScope = [ownerId: string, examId: string, examRevision: number, scale: number | null];

const scopeWhere = `r.owner_id = ? AND json_extract(r.data, '$.productExamId') = ?
  AND json_extract(r.data, '$.productExamRevision') = ?
  AND (? IS NULL OR json_extract(r.data, '$.scale') = ?)`;
const conflictWhere = `(${scopeWhere}) AND r.id <> ? AND (
  json_extract(r.data, '$.university') <> ? OR json_extract(r.data, '$.academicYear') <> ?
  OR json_extract(r.data, '$.examKey') <> ? OR json_extract(r.data, '$.department') = ?
)`;

// For queries using v = product_versions and s = product_submissions. Bind 1 for a teacher, 0 for personal.
export const eligibleAdmissionVersionSql = `v.published = 1
  AND coalesce(json_extract(v.data, '$.materialVersion'), 1) = coalesce(json_extract(s.data, '$.materialVersion'), 1)
  AND ((? = 0 AND json_extract(v.data, '$.authorType') = 'ai')
    OR (json_extract(v.data, '$.authorType') = 'teacher' AND json_extract(v.data, '$.teacherReviewed') = 1))`;

function scopeValues([ownerId, examId, examRevision, scale]: ReferenceScope) {
  return [ownerId, examId, examRevision, scale, scale] as const;
}

function publicReference(record: StoredReference): AdmissionRecord {
  const { productExamId: _examId, productExamRevision: _examRevision, ...reference } = record;
  return reference;
}

async function loadReferences(db: D1Database, scope: ReferenceScope): Promise<StoredReference[]> {
  const rows = await db.prepare(`SELECT r.data FROM admission_records r WHERE ${scopeWhere} ORDER BY r.created_at, r.id`)
    .bind(...scopeValues(scope)).all<{ data: string }>();
  return rows.results.map(row => JSON.parse(row.data) as StoredReference);
}

async function confirmedScore(db: D1Database, id: string, teacher: boolean): Promise<FeedbackScore | null> {
  const row = await db.prepare(`
    SELECT json_extract(v.data, '$.result.total') AS total, json_extract(v.data, '$.result.maximum') AS maximum
    FROM product_versions v JOIN product_submissions s ON s.id = v.submission_id
    WHERE v.submission_id = ? AND ${eligibleAdmissionVersionSql}
    ORDER BY v.version DESC LIMIT 1
  `).bind(id, Number(teacher)).first<FeedbackScore>();
  if (!row || !Number.isFinite(row.total) || !Number.isFinite(row.maximum) || row.maximum <= 0 || row.total < 0 || row.total > row.maximum) return null;
  return { total: row.total, maximum: row.maximum };
}

function sameReference(a: StoredReference, b: StoredReference): boolean {
  return a.university === b.university && a.department === b.department && a.academicYear === b.academicYear
    && a.examKey === b.examKey && a.score === b.score && a.scale === b.scale
    && a.sourceLabel === b.sourceLabel && a.sourceUrl === b.sourceUrl;
}

async function saveReference(db: D1Database, scope: ReferenceScope, scale: number, body: Record<string, unknown>): Promise<200 | 201> {
  if (body.comparableFullExam !== true) {
    throw new HttpError(400, "같은 시험의 전체 논술 점수와 배점 기준을 확인해 주세요.", "ADMISSION_SCOPE_REQUIRED");
  }
  const academicYear = finiteNumber(body.academicYear, "학년도", 2000, 2100);
  if (!Number.isInteger(academicYear)) throw new HttpError(400, "학년도를 정수로 입력하세요.");
  const id = optionalText(body.id, "입시자료 ID", 100);
  const [ownerId, productExamId, productExamRevision] = scope;
  const record: StoredReference = {
    id: id || crypto.randomUUID(), revision: 1, ownerId, productExamId, productExamRevision,
    university: requireText(body.university, "대학 이름", 100),
    department: requireText(body.department, "전형·모집단위", 150),
    academicYear, examKey: requireText(body.examKey, "시험·환산 기준", 150),
    score: finiteNumber(body.score, "공개 논술 최저점", 0, scale), scale,
    metric: "minimum", pointType: "essay", sourceUrl: sourceUrl(body.sourceUrl, true),
    sourceLabel: requireText(body.sourceLabel, "자료 출처", 500), createdAt: new Date().toISOString(),
  };
  const conflictValues = [...scopeValues(scope), record.id, record.university, record.academicYear, record.examKey, record.department];
  if (id) {
    const previous = await db.prepare(`SELECT r.data FROM admission_records r WHERE ${scopeWhere} AND r.id = ?`)
      .bind(...scopeValues(scope), id).first<{ data: string }>();
    if (!previous) throw new HttpError(404, "이 시험에 본인이 등록한 기준 자료를 선택하세요.");
    const saved = JSON.parse(previous.data) as StoredReference;
    if (sameReference(saved, record)) return 200;
    if (body.revision !== saved.revision) throw new HttpError(409, "기준 자료가 변경되었습니다. 최신 자료를 확인해 주세요.", "REVISION_CONFLICT");
    record.revision = saved.revision + 1;
    record.createdAt = saved.createdAt;
    const update = await db.prepare(`UPDATE admission_records SET data = ? WHERE id = ? AND owner_id = ? AND data = ?
      AND NOT EXISTS (SELECT 1 FROM admission_records r WHERE ${conflictWhere})`)
      .bind(JSON.stringify(record), id, ownerId, previous.data, ...conflictValues).run();
    if (update.meta.changes) return 200;
  } else {
    const insert = await db.prepare(`INSERT INTO admission_records (id, owner_id, data, created_at)
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM admission_records r WHERE ${conflictWhere})`)
      .bind(record.id, ownerId, JSON.stringify(record), record.createdAt, ...conflictValues).run();
    if (insert.meta.changes) return 201;
  }
  const current = await loadReferences(db, scope);
  if (current.some(reference => (!id || reference.id === id) && sameReference(reference, record))) return 200;
  if (id && current.find(reference => reference.id === id)?.revision !== body.revision) {
    throw new HttpError(409, "기준 자료가 변경되었습니다. 최신 자료를 확인해 주세요.", "REVISION_CONFLICT");
  }
  throw new HttpError(409, "같은 대학·학년도·시험 기준의 다른 모집단위를 추가하거나 기존 기준을 수정해 주세요.", "ADMISSION_REFERENCE_CONFLICT");
}

/** The caller has already authorized the submission and verified the account type. */
export async function admissionLine(db: D1Database, item: ExamSubmission, userId: string, teacher: boolean, body?: Record<string, unknown>): Promise<Response> {
  const score = await confirmedScore(db, item.id, teacher);
  const scope: ReferenceScope = [userId, item.exam.id, item.exam.revision, score?.maximum ?? null];
  let status: 200 | 201 = 200;
  if (body) {
    if (!score) throw new HttpError(409, "첨삭 결과가 확정되면 합격컷 기준을 등록할 수 있습니다.", "ADMISSION_SCORE_NOT_READY");
    status = await saveReference(db, scope, score.maximum, body);
  }
  const value: AdmissionLine = { score, references: (await loadReferences(db, scope)).map(publicReference) };
  return productJson(value, status);
}

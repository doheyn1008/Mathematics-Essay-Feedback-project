import type { AdmissionHistory, AdmissionHistoryPaper } from "../product-admission-types";
import { eligibleAdmissionVersionSql } from "./product-admission-line";
import { productJson } from "./product-auth";

type HistoryRow = Omit<AdmissionHistoryPaper, "difficulty"> & {
  difficulty: AdmissionHistoryPaper["difficulty"] | null;
};

/** Aggregate inputs only. The caller authorizes the selected submission first. */
export async function admissionHistory(db: D1Database, studentId: string, viewerId: string, teacher: boolean): Promise<Response> {
  const access = teacher
    ? `EXISTS (SELECT 1 FROM product_members m JOIN product_profiles p ON p.user_id = m.user_id
          WHERE m.class_id = s.class_id AND m.user_id = ? AND m.role = 'teacher' AND p.account_type = 'teacher')`
    : `s.class_id IS NULL AND EXISTS (SELECT 1 FROM product_profiles p
          WHERE p.user_id = ? AND p.user_id = s.student_id AND p.account_type = 'personal')`;
  const rows = await db.prepare(`
    SELECT s.id AS submissionId, json_extract(s.data, '$.exam.title') AS examTitle,
      CASE WHEN json_extract(s.data, '$.exam.difficulty') IN ('foundation', 'standard', 'advanced')
        THEN json_extract(s.data, '$.exam.difficulty') END AS difficulty,
      v.created_at AS reviewedAt, json_extract(v.data, '$.result.total') AS total,
      json_extract(v.data, '$.result.maximum') AS maximum,
      json_extract(r.data, '$.university') AS university, json_extract(r.data, '$.department') AS department,
      json_extract(r.data, '$.academicYear') AS academicYear, json_extract(r.data, '$.examKey') AS examKey,
      json_extract(r.data, '$.score') AS cutoff, json_extract(r.data, '$.sourceUrl') AS sourceUrl,
      json_extract(r.data, '$.sourceLabel') AS sourceLabel
    FROM product_submissions s
    JOIN product_versions v ON v.id = (
      SELECT v.id FROM product_versions v
      WHERE v.submission_id = s.id AND ${eligibleAdmissionVersionSql}
      ORDER BY v.version DESC LIMIT 1
    )
    JOIN admission_records r ON r.owner_id = ?
      AND json_extract(r.data, '$.productExamId') = json_extract(s.data, '$.exam.id')
      AND json_extract(r.data, '$.productExamRevision') = json_extract(s.data, '$.exam.revision')
      AND json_extract(r.data, '$.scale') = json_extract(v.data, '$.result.maximum')
      AND json_extract(r.data, '$.metric') = 'minimum' AND json_extract(r.data, '$.pointType') = 'essay'
    WHERE s.student_id = ? AND ${access}
    ORDER BY v.created_at DESC, s.id, r.id
  `).bind(Number(teacher), viewerId, studentId, viewerId).all<HistoryRow>();
  const papers = rows.results.flatMap(({ difficulty, ...paper }) => {
    if (!Number.isFinite(paper.total) || !Number.isFinite(paper.maximum) || !Number.isFinite(paper.cutoff)
      || paper.maximum <= 0 || paper.total < 0 || paper.total > paper.maximum || paper.cutoff < 0 || paper.cutoff > paper.maximum) return [];
    return [difficulty ? { ...paper, difficulty } : paper];
  });
  const value: AdmissionHistory = { papers };
  return productJson(value);
}

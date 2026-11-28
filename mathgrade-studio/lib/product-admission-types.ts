import type { ExamDifficulty } from "./exam-difficulty";
import type { FeedbackScore } from "./product-types";
import type { AdmissionRecord } from "./types";

export type AdmissionLine = {
  score: FeedbackScore | null;
  references: AdmissionRecord[];
};

export type AdmissionLineInput = Pick<AdmissionRecord, "university" | "department" | "academicYear" | "examKey" | "score" | "sourceLabel" | "sourceUrl"> & {
  comparableFullExam: true;
  id?: string;
  revision?: number;
};

export type AdmissionHistoryPaper = FeedbackScore & Pick<AdmissionRecord, "university" | "department" | "academicYear" | "examKey" | "sourceLabel" | "sourceUrl"> & {
  submissionId: string;
  examTitle: string;
  difficulty?: ExamDifficulty;
  reviewedAt: string;
  cutoff: number;
};

export type AdmissionHistory = { papers: AdmissionHistoryPaper[] };

import type { AdmissionHistoryPaper } from "./product-admission-types";

export const minimumStabilityPapers = 3;
export const minimumStabilityYears = 2;

type StabilityStatus = "stable" | "below" | "insufficient";
type PaperComparison = AdmissionHistoryPaper & { gap: number };

export type AdmissionLineSummary = {
  university: string;
  department: string;
  status: StabilityStatus;
  papers: PaperComparison[];
  yearCount: number;
  difficultyCount: number;
  advancedAbove: number;
  conflicts: number;
};

function eligiblePaper(paper: AdmissionHistoryPaper): boolean {
  if (!paper.university.trim() || !paper.department.trim() || !paper.examKey.trim()) return false;
  if (!Number.isInteger(paper.academicYear) || paper.academicYear < 2000 || paper.academicYear > 2100) return false;
  if (!Number.isFinite(paper.maximum) || paper.maximum <= 0) return false;
  if (![paper.total, paper.cutoff].every(score => Number.isFinite(score) && score >= 0 && score <= paper.maximum)) return false;
  if (!Number.isFinite(Date.parse(paper.reviewedAt))) return false;
  try {
    const url = new URL(paper.sourceUrl);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function summaryFor(papers: AdmissionHistoryPaper[]): AdmissionLineSummary {
  const officialPapers = new Map<string, PaperComparison>();
  const conflicts = new Set<string>();
  for (const paper of papers) {
    const key = JSON.stringify([paper.academicYear, paper.examKey.trim().normalize("NFKC").toLowerCase()]);
    const previous = officialPapers.get(key);
    if (previous && (previous.cutoff !== paper.cutoff || previous.maximum !== paper.maximum)) {
      conflicts.add(key);
      continue;
    }
    if (!previous || Date.parse(paper.reviewedAt) >= Date.parse(previous.reviewedAt)) {
      const gap = Number((paper.total - paper.cutoff).toFixed(2));
      officialPapers.set(key, { ...paper, gap });
    }
  }
  const comparisons = [...officialPapers].filter(([key]) => !conflicts.has(key)).map(([, value]) => value);
  comparisons.sort((first, second) => second.academicYear - first.academicYear || first.examKey.localeCompare(second.examKey, "ko"));
  const rated = comparisons.filter(paper => paper.difficulty === "foundation" || paper.difficulty === "standard" || paper.difficulty === "advanced");
  const yearCount = new Set(rated.map(paper => paper.academicYear)).size;
  const advancedAbove = rated.filter(paper => paper.difficulty === "advanced" && paper.total > paper.cutoff).length;
  const enough = rated.length >= minimumStabilityPapers && yearCount >= minimumStabilityYears && !conflicts.size;
  let status: StabilityStatus = "insufficient";
  if (enough) status = advancedAbove > 0 && comparisons.every(paper => paper.total > paper.cutoff) ? "stable" : "below";
  return {
    university: papers[0].university,
    department: papers[0].department,
    status,
    papers: comparisons,
    yearCount,
    difficultyCount: rated.length,
    advancedAbove,
    conflicts: conflicts.size,
  };
}

export function evaluateAdmissionStability(papers: readonly AdmissionHistoryPaper[]): AdmissionLineSummary[] {
  const groups = new Map<string, AdmissionHistoryPaper[]>();
  for (const paper of papers.filter(eligiblePaper)) {
    const key = JSON.stringify([paper.university.trim().normalize("NFKC").toLowerCase(), paper.department.trim().normalize("NFKC").toLowerCase()]);
    const group = groups.get(key);
    if (group) group.push(paper);
    else groups.set(key, [paper]);
  }
  return [...groups.values()].map(summaryFor);
}

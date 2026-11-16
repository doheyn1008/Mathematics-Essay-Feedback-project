export type CutoffMetric = "minimum" | "average" | "percentile70";

export interface CutoffReference {
  id?: string;
  university: string;
  department: string;
  academicYear: number;
  examKey: string;
  scale: number;
  score: number;
  metric: CutoffMetric;
  pointType: "essay" | "total" | "school";
  sourceUrl: string;
  sourceLabel?: string;
}

export interface StudentEssayScore {
  id?: string;
  university: string;
  academicYear: number;
  examKey: string;
  scale: number;
  score: number;
}

export interface PastCutoffComparison {
  label: "과거 기준 비교";
  submissionId?: string;
  university: string;
  department: string;
  academicYear: number;
  examKey: string;
  studentScore: number;
  referenceScore: number;
  scale: number;
  gap: number;
  position: "above" | "equal" | "below";
  description: string;
  sourceUrl: string;
  sourceLabel: string;
}

export interface ComparisonResult {
  status: "ready" | "insufficient";
  comparisons: PastCutoffComparison[];
  reason: string;
}

export type CutoffForecast = {
  status: "insufficient";
  reason: string;
} | {
  status: "ready";
  label: "과거 자료 기반 참고 예측";
  university: string;
  department: string;
  examKey: string;
  academicYear: number;
  scale: number;
  estimate: number;
  lower: number;
  upper: number;
  annualTrend: number;
  backtestMeanAbsoluteError: number;
  backtestCount: number;
  years: number[];
  sourceUrls: string[];
  method: string;
  limitation: string;
};

function validScore(value: StudentEssayScore): boolean {
  return Boolean(value && typeof value.university === "string" && value.university.trim()
    && typeof value.examKey === "string" && value.examKey.trim()
    && Number.isInteger(value.academicYear) && value.academicYear >= 1900 && value.academicYear <= 2200
    && Number.isFinite(value.scale) && value.scale > 0
    && Number.isFinite(value.score) && value.score >= 0 && value.score <= value.scale);
}

function validReference(row: CutoffReference): boolean {
  if (!validScore(row) || typeof row.department !== "string" || !row.department.trim()
    || row.metric !== "minimum" || row.pointType !== "essay") return false;
  try {
    const url = new URL(row.sourceUrl);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function comparableGroup(row: CutoffReference): string {
  return JSON.stringify([row.university.trim(), row.department.trim(), row.examKey.trim(), row.scale]);
}

function yearKey(row: CutoffReference): string {
  return JSON.stringify([comparableGroup(row), row.academicYear]);
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** The caller supplies completed, eligible essay scores. A source URL records provenance, not verification. */
export function comparePastCutoffs(
  studentScores: readonly StudentEssayScore[],
  references: readonly CutoffReference[],
): ComparisonResult {
  const eligible = references.filter(validReference);
  const conflicts = new Set<string>();
  const unique = new Map<string, CutoffReference>();
  for (const row of eligible) {
    const key = yearKey(row);
    const existing = unique.get(key);
    if (existing && existing.score !== row.score) conflicts.add(key);
    unique.set(key, row);
  }
  const comparisons: PastCutoffComparison[] = [];
  for (const student of studentScores.filter(validScore)) {
    for (const [key, reference] of unique) {
      if (conflicts.has(key) || student.university.trim() !== reference.university.trim()
        || student.examKey.trim() !== reference.examKey.trim()
        || student.academicYear !== reference.academicYear || student.scale !== reference.scale) continue;
      const gap = round(student.score - reference.score);
      const position = gap > 0 ? "above" : gap < 0 ? "below" : "equal";
      const description = position === "equal"
        ? "해당 학년도에 입력된 논술 최저점과 같습니다."
        : `해당 학년도에 입력된 논술 최저점보다 ${Math.abs(gap)}점 ${position === "above" ? "높습니다" : "낮습니다"}.`;
      comparisons.push({
        label: "과거 기준 비교",
        submissionId: student.id,
        university: reference.university,
        department: reference.department,
        academicYear: reference.academicYear,
        examKey: reference.examKey,
        studentScore: student.score,
        referenceScore: reference.score,
        scale: reference.scale,
        gap,
        position,
        description,
        sourceUrl: reference.sourceUrl,
        sourceLabel: reference.sourceLabel || "등록된 입시자료",
      });
    }
  }
  comparisons.sort((a, b) => b.academicYear - a.academicYear || b.gap - a.gap);
  return {
    status: comparisons.length ? "ready" : "insufficient",
    comparisons,
    reason: comparisons.length
      ? "동일 대학·시험 기준·학년도·만점의 논술 최저점과 비교했습니다. 수능 최저 충족, 전형 총점과 올해 난도는 별도 확인이 필요합니다."
      : conflicts.size
        ? "같은 시험·학년도에 서로 다른 최저점이 등록되어 있습니다. 출처와 점수를 확인해 주세요."
        : "동일 대학·시험 기준·학년도·만점의 완료된 첨삭 점수와 논술 최저점 자료가 필요합니다.",
  };
}

function fitTrend(rows: readonly CutoffReference[], targetYear: number) {
  const meanYear = rows.reduce((sum, row) => sum + row.academicYear, 0) / rows.length;
  const meanScore = rows.reduce((sum, row) => sum + row.score, 0) / rows.length;
  let covariance = 0;
  let variance = 0;
  for (const row of rows) {
    const distance = row.academicYear - meanYear;
    covariance += distance * (row.score - meanScore);
    variance += distance * distance;
  }
  const slope = covariance / variance;
  return { estimate: meanScore + slope * (targetYear - meanYear), slope };
}

/** Uses only prior years. The interval is a descriptive range, never a probability or confidence interval. */
export function forecastCutoff(references: readonly CutoffReference[], targetYear: number): CutoffForecast {
  if (!Number.isInteger(targetYear) || targetYear < 1900 || targetYear > 2200) {
    return { status: "insufficient", reason: "예측할 학년도를 확인해 주세요." };
  }
  const eligible = references.filter((row) => validReference(row) && row.academicYear < targetYear);
  if (eligible.length < 3) {
    return { status: "insufficient", reason: "예측 학년도 이전의 비교 가능한 논술 최저점 자료가 3개 학년도 이상 필요합니다." };
  }
  const group = comparableGroup(eligible[0]);
  if (eligible.some((row) => comparableGroup(row) !== group)) {
    return { status: "insufficient", reason: "같은 대학·모집단위·시험 기준·만점의 자료를 선택해 주세요." };
  }
  const unique = new Map<number, CutoffReference>();
  for (const row of eligible) {
    const existing = unique.get(row.academicYear);
    if (existing && existing.score !== row.score) {
      return { status: "insufficient", reason: "같은 학년도의 최저점이 출처마다 다릅니다. 기준을 확인한 뒤 예측해 주세요." };
    }
    unique.set(row.academicYear, row);
  }
  const ordered = [...unique.values()].sort((a, b) => a.academicYear - b.academicYear);
  if (ordered.length < 3 || ordered[ordered.length - 1].academicYear !== targetYear - 1) {
    return { status: "insufficient", reason: "직전 학년도까지 이어지는 최소 3개 학년도의 자료가 필요합니다." };
  }
  // Keep the latest continuous series. Older gaps must not be treated as adjacent years.
  let start = ordered.length - 1;
  while (start > 0 && ordered[start].academicYear - ordered[start - 1].academicYear === 1) start -= 1;
  const rows = ordered.slice(start);
  if (rows.length < 3) {
    return { status: "insufficient", reason: "최근 자료 사이에 빠진 학년도가 있습니다. 연속 3개 학년도를 확보해 주세요." };
  }
  const model = fitTrend(rows, targetYear);
  const clamp = (score: number) => Math.min(rows[0].scale, Math.max(0, score));
  const estimate = clamp(model.estimate);
  const errors: number[] = [];
  for (let index = 2; index < rows.length; index += 1) {
    const past = fitTrend(rows.slice(0, index), rows[index].academicYear);
    errors.push(Math.abs(clamp(past.estimate) - rows[index].score));
  }
  const meanError = errors.reduce((sum, error) => sum + error, 0) / errors.length;
  const historicScores = rows.map((row) => row.score);
  const lower = clamp(Math.min(...historicScores, estimate - meanError));
  const upper = clamp(Math.max(...historicScores, estimate + meanError));
  return {
    status: "ready",
    label: "과거 자료 기반 참고 예측",
    university: rows[0].university,
    department: rows[0].department,
    examKey: rows[0].examKey,
    academicYear: targetYear,
    scale: rows[0].scale,
    estimate: round(estimate),
    lower: round(lower),
    upper: round(upper),
    annualTrend: round(model.slope),
    backtestMeanAbsoluteError: round(meanError),
    backtestCount: errors.length,
    years: rows.map((row) => row.academicYear),
    sourceUrls: [...new Set(rows.map((row) => row.sourceUrl))],
    method: "최근 연속 학년도의 논술 최저점에 선형 추세를 적용했습니다. 참고 범위는 과거 관측 최저·최고점과 예측값 ± 순차 검증 평균오차를 모두 포함합니다.",
    limitation: "등록한 자료의 비교 가능성을 전제로 한 참고치입니다. 표본 수, 올해 출제 난도, 지원자 구성과 전형 변경을 반영하는 추가 검증이 필요합니다.",
  };
}

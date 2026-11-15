import type { Criterion, Review } from "../types";

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "INVALID_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function requireText(value: unknown, label: string, max = 200, allowEmpty = false): string {
  if (typeof value !== "string" || value.trim().length > max || (!allowEmpty && !value.trim())) {
    throw new HttpError(400, `${label}을(를) 확인하세요.`);
  }
  return value.trim();
}

export function optionalText(value: unknown, label: string, max = 200): string {
  if (value === undefined || value === null) return "";
  return requireText(value, label, max, true);
}

export function finiteNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(400, `${label} 범위를 확인하세요.`);
  }
  return value;
}

export function sourceUrl(value: unknown, required = false): string {
  const text = optionalText(value, "출처 주소", 2000);
  if (!text && !required) return "";
  try {
    const url = new URL(text);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch {
    throw new HttpError(400, "유효한 출처 웹 주소를 입력하세요.");
  }
  return text;
}

export function validateCriteria(value: unknown): Criterion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) {
    throw new HttpError(400, "채점 항목은 1~30개까지 등록할 수 있습니다.");
  }
  if (value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new HttpError(400, "채점 항목 형식을 확인하세요.");
  }
  const rows = value.map((item) => ({
    id: optionalText(item.id, "항목 ID", 100) || crypto.randomUUID(),
    title: requireText(item.title, "항목 이름", 150),
    max: finiteNumber(item.max, "항목 배점", 0.01, 1000),
    description: optionalText(item.description, "부분점수 기준", 3000),
  }));
  if (new Set(rows.map(({id}) => id)).size !== rows.length) throw new HttpError(400, "채점 항목 ID가 중복됩니다.");
  return rows;
}

export function validateReview(body: Record<string, unknown>, criteria: Criterion[], reviewerId: string): Review {
  if (!Array.isArray(body.scores) || body.scores.length !== criteria.length) {
    throw new HttpError(400, "모든 채점 항목의 점수를 입력하세요.");
  }
  const scores = body.scores.map((score, index) => finiteNumber(score, criteria[index].title, 0, criteria[index].max));
  const evidence = body.evidence ?? criteria.map(() => "");
  if (!Array.isArray(evidence) || evidence.length !== criteria.length) throw new HttpError(400, "채점 근거 항목 수를 확인하세요.");
  return {
    scores,
    evidence: evidence.map((item) => optionalText(item, "채점 근거", 3000)),
    feedback: optionalText(body.feedback, "첨삭 내용", 15000),
    questionResponse: optionalText(body.questionResponse, "학생 질문에 대한 답변", 15000),
    reviewedAt: new Date().toISOString(),
    reviewerId,
  };
}

export function seoulDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

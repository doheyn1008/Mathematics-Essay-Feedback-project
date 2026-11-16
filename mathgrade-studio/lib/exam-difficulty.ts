export const examDifficultyLevels = ["foundation", "standard", "advanced"] as const;

export type ExamDifficulty = (typeof examDifficultyLevels)[number];

export const examDifficultyGuidance: Record<ExamDifficulty, { label: string; guidance: string }> = {
  foundation: {
    label: "기본",
    guidance: "핵심 개념의 선택, 조건 해석, 필수 계산과 결론의 연결을 확인합니다.",
  },
  standard: {
    label: "표준",
    guidance: "풀이 전략을 선택한 이유, 여러 조건을 연결하는 중간 근거, 결론의 타당성을 확인합니다.",
  },
  advanced: {
    label: "심화",
    guidance: "여러 조건의 결합, 경우 분류의 누락, 경계·예외의 검토와 논증의 완결성을 문제에 맞게 확인합니다.",
  },
};

export function isExamDifficulty(value: unknown): value is ExamDifficulty {
  return examDifficultyLevels.some(level => level === value);
}

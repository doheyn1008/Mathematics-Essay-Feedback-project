// All problems and reports are original, illustrative product-demo content.
// They are not past examination questions or official university marking schemes.
export const problems = [
  {
    id: 'cubic',
    title: '삼차함수의 극값과 실근',
    topic: '미분 · 함수의 그래프',
    difficulty: '기본',
    label: '자체 제작 예제 01',
    prompt: '함수 f(x) = x³ − 3x의 증가·감소 구간과 극값을 구하시오. 이를 이용하여 방정식 f(x) = k가 갖는 서로 다른 실근의 개수를 실수 k의 값에 따라 설명하시오.',
    rubric: [
      { label: '도함수와 증감 분석', max: 30, description: '도함수를 구하고 부호에 따라 증가·감소 구간을 설명한다.' },
      { label: '극값 계산', max: 25, description: '극댓값 2와 극솟값 −2를 정확히 계산한다.' },
      { label: '실근의 개수 분류', max: 25, description: '−2 < k < 2, k = ±2, 그 밖의 경우를 구분한다.' },
      { label: '논리와 서술', max: 20, description: '그래프와 수평선의 교점을 근거로 결론을 연결한다.' },
    ],
    sampleAnswer: 'f′(x) = 3x² − 3 = 3(x − 1)(x + 1)이다. 따라서 x < −1 또는 x > 1에서 증가하고 −1 < x < 1에서 감소한다. f(−1) = 2, f(1) = −2이므로 극댓값은 2, 극솟값은 −2이다. 수평선 y = k와 그래프의 교점을 생각하면 −2 < k < 2일 때 실근이 세 개이고, 그 밖에는 한 개이다.',
  },
  {
    id: 'integral',
    title: '로그함수의 정적분',
    topic: '적분 · 부분적분',
    difficulty: '기본',
    label: '자체 제작 예제 02',
    prompt: '부분적분법을 이용하여 정적분 ∫₁ᵉ ln x dx의 값을 구하시오. 부분적분에서 선택한 두 함수를 밝히고, 위끝과 아래끝을 대입하는 과정을 서술하시오.',
    rubric: [
      { label: '부분적분의 설정', max: 25, description: 'u = ln x, dv = dx를 정하고 du와 v를 구한다.' },
      { label: '적분 과정', max: 30, description: '∫ ln x dx = x ln x − x + C를 유도한다.' },
      { label: '끝값 대입과 계산', max: 30, description: '위끝과 아래끝의 값을 각각 구하여 정적분이 1임을 보인다.' },
      { label: '논리와 서술', max: 15, description: '계산 과정과 기호를 명확하게 연결한다.' },
    ],
    sampleAnswer: '부분적분법을 쓰면 ∫ ln x dx = x ln x − x + C이다. 따라서 ∫₁ᵉ ln x dx = [x ln x − x]₁ᵉ = 1이다.',
  },
  {
    id: 'sequence',
    title: '점화식으로 정의된 수열의 극한',
    topic: '수열 · 극한',
    difficulty: '심화',
    label: '자체 제작 예제 03',
    prompt: '수열 {aₙ}이 a₁ = 1, aₙ₊₁ = (aₙ + 2)/2를 만족한다. 모든 자연수 n에 대하여 1 ≤ aₙ < 2임을 보이고, 수열의 단조성을 이용하여 극한값을 구하시오.',
    rubric: [
      { label: '수열의 범위 증명', max: 30, description: '수학적 귀납법 등으로 1 ≤ aₙ < 2를 보인다.' },
      { label: '단조성 확인', max: 25, description: 'aₙ₊₁ − aₙ = (2 − aₙ)/2 > 0을 이용한다.' },
      { label: '수렴과 극한값', max: 25, description: '상계와 단조성을 근거로 수렴을 밝힌 뒤 극한값 2를 구한다.' },
      { label: '논리와 서술', max: 20, description: '수렴을 확인한 후 점화식의 양변에 극한을 취한다.' },
    ],
    sampleAnswer: 'a₁ = 1이고 aₙ < 2이면 aₙ₊₁ = (aₙ + 2)/2 < 2이므로 모든 항은 2보다 작다. aₙ₊₁ − aₙ = (2 − aₙ)/2 > 0이므로 증가수열이다. 극한을 L이라 하면 L = (L + 2)/2이고, 따라서 L = 2이다.',
  },
];

const fixedReports = [
  {
    id: 'sample-cubic',
    problemId: 'cubic',
    title: '삼차함수의 극값과 실근',
    score: 78,
    maxScore: 100,
    isDemo: true,
    source: 'fixed-example',
    demoNotice: '자체 제작 예시 답안에 대한 고정 리포트입니다. 제출한 답안이나 파일을 분석한 결과가 아닙니다.',
    summary: '미분과 극값 계산의 흐름은 정확해요. 실근의 개수를 나눌 때 경계값 k = ±2를 따로 살펴보면 풀이가 완성됩니다.',
    criteria: [
      { label: '도함수와 증감 분석', max: 30, score: 28, comment: '도함수와 증감 구간이 정확해요. 도함수의 부호표를 덧붙이면 근거가 더 잘 드러나요.' },
      { label: '극값 계산', max: 25, score: 25, comment: '극댓값 2와 극솟값 −2를 정확히 구했어요.' },
      { label: '실근의 개수 분류', max: 25, score: 13, comment: 'k = 2 또는 k = −2일 때 서로 다른 실근은 두 개예요. 이 경우가 빠졌어요.' },
      { label: '논리와 서술', max: 20, score: 12, comment: '각 단조 구간에서 수평선과 만나는 횟수를 설명하고 경계값의 결론을 보완해 보세요.' },
    ],
    strengths: ['도함수의 인수분해를 이용해 증감 구간을 정확히 나눴어요.', '극값을 방정식의 실근 개수와 연결하는 접근이 적절해요.'],
    improvements: ['“그 밖에는 한 개”라는 결론에서 k = ±2를 분리해야 해요.', '실근의 개수는 중복도를 세지 않는 “서로 다른 실근”의 개수임을 확인하세요.'],
    nextSteps: ['k = 2에서 x³ − 3x − 2 = (x − 2)(x + 1)²임을 확인해 보세요.', 'k의 범위를 다섯 경우로 나눈 뒤, 같은 결론을 갖는 경우를 묶어 보세요.'],
    improvedAnswer: 'f′(x) = 3(x − 1)(x + 1)이므로 f는 (−∞, −1), (1, ∞)에서 증가하고 (−1, 1)에서 감소한다. 극댓값은 f(−1) = 2, 극솟값은 f(1) = −2이다. 각 단조 구간에서 그래프와 수평선 y = k의 교점을 세면, −2 < k < 2일 때 서로 다른 실근은 세 개이다. k = 2 또는 k = −2에서는 극점에서 한 번 접하고 다른 점에서 한 번 만나므로 두 개이다. k < −2 또는 k > 2에서는 한 개이다.',
  },
  {
    id: 'sample-integral',
    problemId: 'integral',
    title: '로그함수의 정적분',
    score: 84,
    maxScore: 100,
    isDemo: true,
    source: 'fixed-example',
    demoNotice: '자체 제작 예시 답안에 대한 고정 리포트입니다. 제출한 답안이나 파일을 분석한 결과가 아닙니다.',
    summary: '정적분의 값은 정확해요. 부분적분에서 선택한 함수와 두 끝값의 계산을 보여주면 풀이의 근거가 선명해집니다.',
    criteria: [
      { label: '부분적분의 설정', max: 25, score: 17, comment: 'u = ln x, dv = dx를 선택한 과정을 명시해 보세요.' },
      { label: '적분 과정', max: 30, score: 27, comment: '원시함수는 정확해요. x ln x − ∫1 dx로 이어지는 한 줄을 더해 보세요.' },
      { label: '끝값 대입과 계산', max: 30, score: 27, comment: '최종값 1은 맞아요. 위끝은 0, 아래끝은 −1임을 각각 적으면 좋아요.' },
      { label: '논리와 서술', max: 15, score: 13, comment: '기호 사용은 적절해요. 문제에서 요구한 선택 과정과 끝값 계산을 보완하세요.' },
    ],
    strengths: ['부분적분에 필요한 원시함수를 올바르게 구했어요.', '정적분의 최종값 1이 정확해요.'],
    improvements: ['어떤 두 함수를 선택했는지 설명하는 과정이 생략됐어요.', '정적분은 위끝의 값에서 아래끝의 값을 빼는 과정까지 보여 주세요.'],
    nextSteps: ['u, dv, du, v를 네 칸에 나누어 먼저 써 보세요.', 'F(e)와 F(1)을 각각 계산하고 F(e) − F(1)을 적어 보세요.'],
    improvedAnswer: 'u = ln x, dv = dx로 두면 du = (1/x)dx, v = x이다. 부분적분법에 의해 ∫ ln x dx = x ln x − ∫x·(1/x)dx = x ln x − x + C이다. 따라서 ∫₁ᵉ ln x dx = [x ln x − x]₁ᵉ = (e·1 − e) − (1·0 − 1) = 0 − (−1) = 1이다.',
  },
  {
    id: 'sample-sequence',
    problemId: 'sequence',
    title: '점화식으로 정의된 수열의 극한',
    score: 78,
    maxScore: 100,
    isDemo: true,
    source: 'fixed-example',
    demoNotice: '자체 제작 예시 답안에 대한 고정 리포트입니다. 제출한 답안이나 파일을 분석한 결과가 아닙니다.',
    summary: '단조성과 극한값 계산은 정확해요. 수열의 아래쪽 범위와 수렴의 근거를 명시하면 논증이 더 탄탄해집니다.',
    criteria: [
      { label: '수열의 범위 증명', max: 30, score: 20, comment: 'aₙ < 2의 귀납 과정은 좋아요. 1 ≤ aₙ도 귀납적으로 확인해 보세요.' },
      { label: '단조성 확인', max: 25, score: 25, comment: '앞서 구한 상계를 이용하여 증가수열임을 정확히 보였어요.' },
      { label: '수렴과 극한값', max: 25, score: 20, comment: '극한값 2는 맞아요. 증가하고 위로 유계이므로 수렴한다는 근거를 먼저 적으세요.' },
      { label: '논리와 서술', max: 20, score: 13, comment: '수렴을 확인하기 전에 극한이 존재한다고 가정하지 않도록 순서를 정리하세요.' },
    ],
    strengths: ['항의 차이를 이용하여 단조성을 간결하게 확인했어요.', '점화식에서 구한 극한값이 정확해요.'],
    improvements: ['문제에서 요구한 1 ≤ aₙ의 증명도 포함하세요.', '상계와 단조성을 이용하여 수렴함을 밝힌 뒤 극한을 계산하세요.'],
    nextSteps: ['1 ≤ aₙ < 2를 가정했을 때 1 ≤ aₙ₊₁ < 2가 되는지 확인하세요.', '“증가하고 위로 유계이므로 수렴한다”를 극한 계산 앞에 적어 보세요.'],
    improvedAnswer: 'a₁ = 1이므로 1 ≤ a₁ < 2이다. 1 ≤ aₙ < 2라 가정하면 3/2 ≤ (aₙ + 2)/2 < 2이므로 1 ≤ aₙ₊₁ < 2이다. 귀납법에 의해 모든 n에서 1 ≤ aₙ < 2이다. 또한 aₙ₊₁ − aₙ = (2 − aₙ)/2 > 0이므로 증가하고 위로 유계여서 수렴한다. 극한을 L이라 하면 L = (L + 2)/2이므로 L = 2이다.',
  },
];

export const sampleReports = fixedReports.slice(0, 2).map((report) => ({
  ...report,
  sampleAnswer: problems.find((problem) => problem.id === report.problemId).sampleAnswer,
}));

export function getFixedReport(problemId) {
  const report = fixedReports.find((item) => item.problemId === problemId);
  if (!report) return null;
  return {
    ...report,
    sampleAnswer: problems.find((problem) => problem.id === problemId).sampleAnswer,
  };
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateAdmissionStability } from '../lib/admission-stability.ts';

const paper = (academicYear, overrides = {}) => ({
  submissionId: `submission-${academicYear}`,
  examTitle: '수리논술',
  difficulty: 'standard',
  total: 80,
  maximum: 100,
  reviewedAt: '2026-11-15T08:00:00.000Z',
  university: '검증용 대학',
  department: '논술전형 · 자연계열',
  academicYear,
  examKey: '수리논술 전체',
  cutoff: 75,
  sourceUrl: 'https://example.test/admissions',
  sourceLabel: '공개 자료',
  ...overrides,
});

test('stable status requires enough distinct rated papers across years and an advanced paper above its cutoff', () => {
  const standard = paper(2024);
  const advanced = paper(2025, { difficulty: 'advanced' });
  assert.equal(evaluateAdmissionStability([standard, advanced, advanced])[0].status, 'insufficient');
  assert.equal(evaluateAdmissionStability([standard, advanced, paper(2026, { difficulty: undefined })])[0].status, 'insufficient');
  assert.equal(evaluateAdmissionStability([standard, advanced, paper(2026)])[0].status, 'stable');
  assert.equal(evaluateAdmissionStability([standard, paper(2025), paper(2026)])[0].status, 'below');
  assert.equal(evaluateAdmissionStability([standard, advanced, paper(2026, { total: 75 })])[0].status, 'below');
});

test('retakes use the latest graded attempt and conflict in an official reference prevents a stability label', () => {
  const final = paper(2025, { difficulty: 'advanced', reviewedAt: '2026-11-16T08:00:00.000Z', total: 0 });
  const first = paper(2025, { difficulty: 'advanced' });
  const papers = [paper(2024), final, first, paper(2026)];
  const [summary] = evaluateAdmissionStability(papers);
  assert.equal(summary.papers.length, 3);
  assert.equal(summary.papers.find(item => item.academicYear === 2025).gap, -75);
  assert.equal(summary.status, 'below');
  const [conflicting] = evaluateAdmissionStability([...papers, { ...first, cutoff: 76 }]);
  assert.equal(conflicting.status, 'insufficient');
  assert.equal(conflicting.conflicts, 1);
});

test('universities and admissions tracks retain separate histories', () => {
  const summaries = evaluateAdmissionStability([
    paper(2026), paper(2025, { department: '다른 전형' }),
    paper(2024, { university: '다른 대학' }), paper(2024, { sourceUrl: 'javascript:void(0)' }),
  ]);
  assert.equal(summaries.length, 3);
  assert.ok(summaries.every(summary => summary.papers.length === 1 && summary.status === 'insufficient'));
});

test('strict cutoff eligibility keeps differences smaller than display precision', () => {
  const standard = paper(2024);
  const advanced = paper(2025, { difficulty: 'advanced', total: 75, cutoff: 74.999 });
  const [above] = evaluateAdmissionStability([standard, advanced, paper(2026)]);
  assert.equal(above.status, 'stable');
  assert.equal(above.advancedAbove, 1);
  assert.equal(above.papers.find(item => item.academicYear === 2025).gap, 0);

  const [below] = evaluateAdmissionStability([standard, advanced, paper(2026, { total: 75, cutoff: 75.001 })]);
  assert.equal(below.status, 'below');
  const [equal] = evaluateAdmissionStability([standard, advanced, paper(2026, { total: 75, cutoff: 75 })]);
  assert.equal(equal.status, 'below');
});

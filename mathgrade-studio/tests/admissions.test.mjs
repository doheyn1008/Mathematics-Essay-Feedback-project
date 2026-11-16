import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePastCutoffs, forecastCutoff } from '../lib/admissions.ts';

const reference = (year, score, changes = {}) => ({
  university: '검증용 대학', department: '수학과', academicYear: year,
  examKey: '수리논술-기준1', scale: 100, score, metric: 'minimum', pointType: 'essay',
  sourceUrl: 'https://university.example/admission/results', ...changes,
});
const student = (changes = {}) => ({
  id: 'answer-1', university: '검증용 대학', academicYear: 2025,
  examKey: '수리논술-기준1', scale: 100, score: 73, ...changes,
});

test('compares only the same university, exam, year, and scale', () => {
  const rows = [reference(2025, 70), reference(2024, 68), reference(2025, 50, { university: '다른 대학' }),
    reference(2025, 55, { examKey: '다른 시험' }), reference(2025, 140, { scale: 200 })];
  const result = comparePastCutoffs([student()], rows);
  assert.equal(result.comparisons.length, 1);
  assert.equal(result.comparisons[0].gap, 3);
  assert.equal(result.comparisons[0].position, 'above');
});

test('average, percentile and school grade do not become essay minima', () => {
  const rows = [reference(2025, 70, { metric: 'average' }), reference(2025, 70, { metric: 'percentile70' }),
    reference(2025, 70, { pointType: 'school' }), reference(2025, 70, { pointType: 'total' })];
  assert.equal(comparePastCutoffs([student()], rows).status, 'insufficient');
  assert.equal(forecastCutoff([2023, 2024, 2025].map(y => reference(y, 70, { metric: 'average' })), 2026).status, 'insufficient');
});

test('rejects invalid numbers, out of range scores, and invalid source links', () => {
  const rows = [reference(2025, NaN), reference(2025, 101), reference(2025, 70, { scale: 0 }),
    reference(2025, 70, { sourceUrl: 'javascript:alert(1)' })];
  assert.equal(comparePastCutoffs([student()], rows).status, 'insufficient');
  assert.equal(comparePastCutoffs([student({ score: NaN })], [reference(2025, 70)]).status, 'insufficient');
});

test('conflicting same-year references are excluded instead of arbitrarily selected', () => {
  const rows = [reference(2025, 70), reference(2025, 75)];
  assert.equal(comparePastCutoffs([student()], rows).status, 'insufficient');
  assert.equal(forecastCutoff([reference(2023, 65), reference(2024, 68), ...rows], 2026).status, 'insufficient');
});

test('requires three distinct continuous prior years and next-year target', () => {
  assert.equal(forecastCutoff([reference(2024, 65), reference(2025, 68)], 2026).status, 'insufficient');
  assert.equal(forecastCutoff([reference(2024, 65), reference(2025, 68), reference(2025, 68)], 2026).status, 'insufficient');
  assert.equal(forecastCutoff([reference(2022, 65), reference(2024, 68), reference(2025, 70)], 2026).status, 'insufficient');
  assert.equal(forecastCutoff([reference(2023, 65), reference(2024, 68), reference(2025, 70)], 2027).status, 'insufficient');
});

test('forecast ignores present/future target data and reports time-ordered backtesting', () => {
  const rows = [reference(2023, 65), reference(2024, 68), reference(2025, 71)];
  const result = forecastCutoff(rows, 2026);
  assert.equal(result.status, 'ready');
  assert.equal(result.estimate, 74);
  assert.equal(result.backtestMeanAbsoluteError, 0);
  assert.equal(result.backtestCount, 1);
  assert.deepEqual(forecastCutoff([...rows, reference(2026, 5), reference(2027, 10)], 2026), result);
});

test('mixed scales or department series are never regressed together', () => {
  assert.equal(forecastCutoff([reference(2023, 65), reference(2024, 136, { scale: 200 }), reference(2025, 71)], 2026).status, 'insufficient');
  assert.equal(forecastCutoff([reference(2023, 65), reference(2024, 68, { department: '다른 학과' }), reference(2025, 71)], 2026).status, 'insufficient');
});

test('retains latest complete series after an old gap and keeps scores in range', () => {
  const result = forecastCutoff([reference(2020, 20), reference(2023, 90), reference(2024, 95), reference(2025, 100)], 2026);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.years, [2023, 2024, 2025]);
  assert.equal(result.estimate, 100);
  assert.ok(result.lower >= 0 && result.upper <= 100);
});

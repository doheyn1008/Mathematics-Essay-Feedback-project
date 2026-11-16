import test from 'node:test';
import assert from 'node:assert/strict';
import { problems, sampleReports } from '../src/data.js';
import { createDemoReport, validateFile, validateSubmission, MAX_FILE_SIZE } from '../src/services.js';
import { STORAGE_KEY, createInitialState, loadState, saveState, resetState, createSubmission, getSubmission, updateSubmission } from '../src/store.js';

function memoryStorage(initial = null) {
  const values = new Map(initial ? [[STORAGE_KEY, initial]] : []);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('sample rubrics total 100 and sample report scores match their criteria', () => {
  assert.equal(problems.length, 3);
  for (const problem of problems) assert.equal(problem.rubric.reduce((sum, item) => sum + item.max, 0), 100);
  for (const report of sampleReports) {
    assert.equal(report.criteria.reduce((sum, item) => sum + item.score, 0), report.score);
    assert.equal(report.isDemo, true);
    assert.equal(report.source, 'fixed-example');
  }
});

test('file validation rejects oversized, empty and disguised files', () => {
  assert.equal(validateFile({ name: 'answer.pdf', type: 'application/pdf', size: MAX_FILE_SIZE }).valid, true);
  assert.equal(validateFile({ name: 'answer.JPG', type: 'image/jpeg', size: 100 }).valid, true);
  assert.equal(validateFile({ name: 'answer.png', type: '', size: 100 }).valid, true);
  for (const file of [
    { name: 'answer.pdf', type: 'application/pdf', size: MAX_FILE_SIZE + 1 },
    { name: 'answer.png', type: 'image/png', size: 0 },
    { name: 'answer.svg', type: 'image/svg+xml', size: 100 },
    { name: 'answer.jpg', type: 'application/pdf', size: 100 },
    { name: 'answer.exe', type: 'image/png', size: 100 },
    { name: 'answer.pdf', type: 'application/pdf', size: NaN },
  ]) assert.equal(validateFile(file).valid, false);
});

test('submission requires a known problem and sufficient text or a valid file', () => {
  assert.equal(validateSubmission({ problemId: 'cubic', answer: 'x'.repeat(30) }).valid, true);
  assert.equal(validateSubmission({ problemId: 'cubic', answer: ' '.repeat(30) }).valid, false);
  assert.equal(validateSubmission({ problemId: 'missing', answer: 'x'.repeat(30) }).valid, false);
  assert.equal(validateSubmission({ problemId: 'cubic', file: { name: 'answer.pdf', type: 'application/pdf', size: 100 } }).valid, true);
  assert.equal(validateSubmission({ problemId: 'cubic', answer: 'x'.repeat(20001) }).valid, false);
});

test('demo reports are fixed examples and never grade the submitted text', () => {
  const first = createDemoReport({ problemId: 'cubic', answer: '정확한 풀이', fileName: 'one.pdf' });
  const second = createDemoReport({ problemId: 'cubic', answer: '틀린 풀이', fileName: 'two.png' });
  assert.equal(first.score, second.score);
  assert.deepEqual(first.criteria, second.criteria);
  assert.equal(first.sampleAnswer, problems[0].sampleAnswer);
  assert.equal(first.submittedAnswer, '정확한 풀이');
  assert.equal(first.submittedFileName, 'one.pdf');
  assert.match(first.demoNotice, /분석한 결과가 아닙니다/);
  first.criteria[0].score = 0;
  assert.notEqual(createDemoReport({ problemId: 'cubic' }).criteria[0].score, 0);
  assert.throws(() => createDemoReport({ problemId: 'missing' }));
});

test('malformed and unknown-version storage starts safely', () => {
  for (const value of ['{broken', 'null', '[]', '{"version":99}', '{"version":1,"submissions":[null,{}],"account":{}}']) {
    assert.deepEqual(loadState(memoryStorage(value)), createInitialState());
  }
  assert.deepEqual(loadState({ getItem() { throw new Error('denied'); } }), createInitialState());
});

test('state survives serialization without storing file content or unknown properties', () => {
  const storage = memoryStorage();
  const submission = createSubmission({ problemId: 'cubic', answer: '풀이 내용', fileName: 'answer.pdf', file: { secretBytes: 'private' }, report: createDemoReport({ problemId: 'cubic' }) });
  const state = { ...createInitialState(), account: { name: '체험 학생', password: 'must-not-save' }, submissions: [submission], apiKey: 'must-not-save', activePlan: 'demo' };
  assert.equal(saveState(state, storage).ok, true);
  const restored = loadState(storage);
  assert.equal(restored.account.name, '체험 학생');
  assert.equal(restored.submissions[0].fileName, 'answer.pdf');
  assert.equal(restored.submissions[0].status, 'completed');
  assert.equal(restored.submissions[0].report.isDemo, true);
  const raw = storage.getItem(STORAGE_KEY);
  assert.equal(raw.includes('must-not-save'), false);
  assert.equal(raw.includes('secretBytes'), false);
  assert.equal(raw.includes('apiKey'), false);
});

test('storage write failure is reported while preserving usable in-memory data', () => {
  const result = saveState({ ...createInitialState(), account: { name: '학생' } }, { setItem() { throw new Error('QuotaExceededError'); } });
  assert.equal(result.ok, false);
  assert.equal(result.state.account.name, '학생');
  assert.match(result.error, /현재 화면/);
});

test('updates preserve submission identity and do not mutate previous state', () => {
  const submission = createSubmission({ problemId: 'cubic', answer: '처음 풀이' });
  const state = { ...createInitialState(), submissions: [submission] };
  const next = updateSubmission(state, submission.id, { answer: '고친 풀이', id: 'changed', report: createDemoReport({ problemId: 'cubic' }), status: 'completed' });
  assert.equal(getSubmission(next, submission.id).answer, '고친 풀이');
  assert.equal(getSubmission(next, submission.id).status, 'completed');
  assert.equal(getSubmission(state, submission.id).answer, '처음 풀이');
  assert.equal(getSubmission(next, 'changed'), null);
});

test('a saved draft can switch problems without retaining the previous example report', () => {
  const submission = createSubmission({ problemId: 'cubic', answer: '처음 풀이', report: createDemoReport({ problemId: 'cubic' }) });
  const state = { ...createInitialState(), submissions: [submission] };
  const next = updateSubmission(state, submission.id, { problemId: 'integral', answer: '새 문제 풀이' });
  assert.equal(getSubmission(next, submission.id).problemId, 'integral');
  assert.equal(getSubmission(next, submission.id).answer, '새 문제 풀이');
  assert.equal(getSubmission(next, submission.id).report, null);
  assert.equal(getSubmission(next, submission.id).status, 'draft');
  assert.equal(getSubmission(state, submission.id).problemId, 'cubic');
  assert.equal(getSubmission(updateSubmission(next, submission.id, { problemId: '' }), submission.id).problemId, 'integral');
});

test('malformed persisted dates remain safe for history date formatting', () => {
  const report = { ...createDemoReport({ problemId: 'cubic' }), createdAt: 'not-a-date' };
  const storedSubmission = { ...createSubmission({ problemId: 'cubic', report }), createdAt: 'broken', updatedAt: 'also-broken', report };
  const stored = JSON.stringify({ ...createInitialState(), submissions: [storedSubmission] });
  const restored = loadState(memoryStorage(stored)).submissions[0];
  const formatter = new Intl.DateTimeFormat('ko-KR');
  for (const value of [restored.createdAt, restored.updatedAt, restored.report.createdAt]) {
    assert.ok(Number.isFinite(Date.parse(value)));
    assert.doesNotThrow(() => formatter.format(new Date(value)));
  }
  assert.equal(restored.updatedAt, restored.createdAt);
  const originalDate = '2026-10-01T03:00:00.000Z';
  const valid = { ...storedSubmission, createdAt: originalDate, updatedAt: null };
  const validRestored = loadState(memoryStorage(JSON.stringify({ ...createInitialState(), submissions: [valid] }))).submissions[0];
  assert.equal(validRestored.createdAt, originalDate);
  assert.equal(validRestored.updatedAt, originalDate);
});

test('reset removes only the demo storage key', () => {
  const storage = memoryStorage('{"version":1}');
  storage.setItem('unrelated', 'keep');
  assert.deepEqual(resetState(storage), createInitialState());
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(storage.getItem('unrelated'), 'keep');
});


test('unknown restored problem IDs are discarded before the submission form opens', () => {
  const valid = createSubmission({ problemId: 'cubic', answer: 'known problem' });
  const unknown = { ...valid, id: 'unknown', problemId: 'missing' };
  const restored = loadState(memoryStorage(JSON.stringify({ ...createInitialState(), submissions: [unknown, valid] })));
  assert.deepEqual(restored.submissions.map(item => item.problemId), ['cubic']);
  assert.equal(createSubmission({ problemId: 'missing' }), null);
  assert.equal(updateSubmission({ ...createInitialState(), submissions: [valid] }, valid.id, { problemId: 'missing' }).submissions[0].problemId, 'cubic');
});

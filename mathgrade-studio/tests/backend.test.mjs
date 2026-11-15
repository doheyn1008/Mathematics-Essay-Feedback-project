import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Exercise the actual handler against SQLite with D1 transaction behavior.
const scratch = await mkdtemp(join(tmpdir(), 'mathgrade-api-'));
const sqlite = new DatabaseSync(':memory:');
for (const name of (await readdir('drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
  sqlite.exec(await readFile(join('drizzle', name), 'utf8'));
}
function statement(sql, values = []) {
  return {
    bind(...args) { return statement(sql, args); },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    sql,
    values,
  };
}
const files = new Map();
const fakeEnv = {
  DB: {
    prepare: statement,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const entry of statements) {
          if (/^SELECT/i.test(entry.sql)) results.push(await entry.all());
          else results.push(await entry.run());
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  },
  BUCKET: {
    async put(key, bytes) { files.set(key, bytes); },
    async delete(key) { files.delete(key); },
    async get(key) { const body = files.get(key); return body ? { body } : null; },
  },
};
globalThis.__mathgradeTestEnv = fakeEnv;
for (const name of ['validation', 'sharing', 'service']) {
  let input = await readFile(`lib/server/${name}.ts`, 'utf8');
  input = input.replace('import { env } from "cloudflare:workers";', 'const env = globalThis.__mathgradeTestEnv;');
  input = input.replace('from "./validation"', 'from "./validation.mjs"').replace('from "./sharing"', 'from "./sharing.mjs"');
  const compiled = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  await writeFile(join(scratch, `${name}.mjs`), compiled);
}
const { handleApi } = await import(pathToFileURL(join(scratch, 'service.mjs')));
async function call(path, user, data, method = data === undefined ? 'GET' : 'POST') {
  const headers = new Headers({ origin: 'https://test.example' });
  if (user) headers.set('oai-authenticated-user-id', user);
  if (data && !(data instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await handleApi(new Request(`https://test.example/api/${path}`, { method, headers, body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data) }));
  const result = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.arrayBuffer();
  return { status: response.status, result };
}
try {
  assert.equal((await call('academies', null, { name: 'A' })).status, 401);
  const academy = (await call('academies', 'teacher', { name: '학원' })).result.academy;
  const questionBody = { title: '미분 문항', prompt: '최댓값을 구하시오.', sourceLabel: '직접 작성', university: '예시대학', academicYear: 2026, criteria: [{ id: 'a', title: '근거', max: 4, description: '계산' }, { id: 'b', title: '결론', max: 6, description: '결론' }] };
  assert.equal((await call('questions', 'teacher', { ...questionBody, criteria: [null] })).status, 400);
  const question = (await call('questions', 'teacher', questionBody)).result.question;
  const assignment = (await call('assignments', 'teacher', { academyId: academy.id, questionId: question.id, title: '첫 과제' })).result.assignment;
  assert.equal((await call('submissions', 'student', { mode: 'academy', assignmentId: assignment.id, answer: '풀이' })).status, 403);
  await call('join', 'student', { code: academy.joinCode });
  const submissionBody = { mode: 'academy', assignmentId: assignment.id, answer: '학생 답안', studentCode: 'A-001', clientRequestId: 'first' };
  const submission = (await call('submissions', 'student', submissionBody)).result.submission;
  assert.equal((await call('submissions', 'student', submissionBody)).result.submission.id, submission.id, 'retries reuse the same record');
  assert.equal((await call(`submissions/${submission.id}`, 'outsider')).status, 403);
  const reviewBody = { revision: 1, action: 'draft', scores: [4, 5.5], evidence: ['근거', '결론'], feedback: '보완 의견' };
  assert.equal((await call(`submissions/${submission.id}/review`, 'student', reviewBody)).status, 403);
  assert.equal((await call(`submissions/${submission.id}/review`, 'teacher', { ...reviewBody, scores: [5, 5] })).status, 400);
  const draft = (await call(`submissions/${submission.id}/review`, 'teacher', reviewBody)).result.submission;
  assert.equal(draft.revision, 2);
  const privateView = (await call('state', 'student')).result;
  assert.equal(privateView.submissions[0].draft, null);
  assert.equal(privateView.submissions[0].final, null);
  assert.equal(privateView.academies[0].joinCode, undefined);
  assert.equal((await call(`report-data?ids=${submission.id}`, 'teacher')).status, 409);
  assert.equal((await call(`submissions/${submission.id}/review`, 'teacher', { ...reviewBody, action: 'approve' })).status, 409, 'stale revisions rejected');
  const approved = (await call(`submissions/${submission.id}/review`, 'teacher', { ...reviewBody, revision: 2, action: 'approve' })).result.submission;
  assert.equal(approved.status, 'approved');
  assert.equal((await call(`report-data?ids=${submission.id}`, 'student')).status, 200);
  assert.equal((await call(`report-data?ids=${submission.id}`, 'outsider')).status, 403);
  const aiFailure = await call('analyze', 'student', { submissionId: submission.id });
  assert.equal(aiFailure.status, 503);
  assert.equal(aiFailure.result.code, 'AI_NOT_CONFIGURED');
  assert.equal((await call('state', 'student')).result.usage.used, 0);
  assert.equal((await call(`submissions/${submission.id}`, 'teacher')).result.submission.status, 'approved');
  await call(`submissions/${submission.id}/review`, 'teacher', { revision: 3, action: 'reopen' });
  assert.equal((await call(`submissions/${submission.id}`, 'student')).result.submission.final, null, 'reopened results are held for review');
  assert.equal((await call(`submissions/${submission.id}`, 'teacher')).result.submission.final.scores[1], 5.5, 'teacher previous final is preserved');
  const reference = new FormData();
  reference.set('file', new File(['%PDF-1.7 test'], 'rubric.pdf', { type: 'application/pdf' }));
  reference.set('kind', 'rubric');
  reference.set('revision', '1');
  const referenceResult = await call(`questions/${question.id}/references`, 'teacher', reference);
  assert.equal(referenceResult.status, 201);
  const refId = referenceResult.result.question.references[0].id;
  assert.equal((await call(`references/${refId}`, 'teacher')).status, 200);
  assert.equal((await call(`references/${refId}`, 'student')).status, 404);
  const upload = new FormData();
  upload.set('payload', JSON.stringify({ ...submissionBody, clientRequestId: 'file', studentCode: 'x'.repeat(81) }));
  upload.set('file', new File(['%PDF-1.7 test'], 'answer.pdf', { type: 'application/pdf' }));
  const fileCount = files.size;
  assert.equal((await call('submissions', 'student', upload)).status, 400);
  assert.equal(files.size, fileCount, 'invalid metadata cannot leave orphan files');
  upload.set('payload', JSON.stringify({ ...submissionBody, clientRequestId: 'file' }));
  const uploaded = (await call('submissions', 'student', upload)).result.submission;
  assert.equal((await call(`attachments/${uploaded.attachment.id}`, 'teacher')).status, 200);
  assert.equal((await call(`attachments/${uploaded.attachment.id}`, 'outsider')).status, 403);
  const admissionBody = { university: '예시대학', department: '수학과', academicYear: 2026, examKey: '2026-수학-A', scale: 100, score: 74, metric: 'minimum', pointType: 'essay', sourceUrl: 'https://example.edu/results', sourceLabel: '공식 입학 결과' };
  const admission = (await call('admissions', 'student', admissionBody)).result.record;
  assert.equal(admission.revision, 1);
  assert.equal((await call('admissions', 'outsider', { ...admissionBody, id: admission.id, revision: 1, score: 80 })).status, 404);
  const corrected = (await call('admissions', 'student', { ...admissionBody, id: admission.id, revision: 1, score: 76 })).result.record;
  assert.equal(corrected.id, admission.id);
  assert.equal(corrected.revision, 2);
  assert.equal(corrected.score, 76);
  assert.equal((await call('admissions', 'student', { ...admissionBody, id: admission.id, revision: 1 })).status, 409);
  assert.equal((await call('state', 'student')).result.admissions.length, 1);
  assert.equal((await call('state', 'outsider')).result.admissions.length, 0);
  // Direct submissions save the student problem and answer privately, without inventing a rubric.
  const directBody = { mode: 'academy', academyId: academy.id, directQuestion: { title: '직접 제출', prompt: '', sourceLabel: '직접 작성', sourceUrl: '' }, answer: '나의 풀이', studentQuestion: '왜 끝점도 확인해야 하나요?', clientRequestId: 'direct-one' };
  const directUpload = new FormData();
  directUpload.set('payload', JSON.stringify(directBody));
  directUpload.set('problemFile', new File(['%PDF-1.7 problem'], 'problem.pdf', { type: 'application/pdf' }));
  directUpload.set('file', new File(['%PDF-1.7 answer'], 'answer.pdf', { type: 'application/pdf' }));
  assert.equal((await call('submissions', 'outsider', directUpload)).status, 403);
  const directResult = await call('submissions', 'student', directUpload);
  assert.equal(directResult.status, 201);
  const directSubmission = directResult.result.submission;
  assert.equal(directSubmission.rubricPending, true);
  assert.deepEqual(directSubmission.question.criteria, []);
  assert.equal(directSubmission.studentQuestion, directBody.studentQuestion);
  assert.equal(directSubmission.question.ownerId, 'student');
  assert.equal((await call(`attachments/${directSubmission.problemAttachment.id}`, 'teacher')).status, 200);
  assert.equal((await call(`attachments/${directSubmission.problemAttachment.id}`, 'outsider')).status, 403);
  assert.equal((await call('submissions', 'student', directUpload)).result.submission.id, directSubmission.id);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM questions WHERE id = ?').get(directSubmission.question.id).count, 1);
  assert.equal((await call('state', 'outsider')).result.questions.length, 0);
  assert.equal((await call(`submissions/${directSubmission.id}/review`, 'teacher', { revision: 1, action: 'approve', scores: [], evidence: [], feedback: '보완' })).result.code, 'RUBRIC_REQUIRED');
  const rubricBody = { revision: 1, criteria: questionBody.criteria, notes: '끝점 확인' };
  assert.equal((await call(`submissions/${directSubmission.id}/rubric`, 'student', rubricBody)).status, 403);
  const rubricSet = (await call(`submissions/${directSubmission.id}/rubric`, 'teacher', rubricBody)).result.submission;
  assert.equal(rubricSet.revision, 2);
  assert.equal(rubricSet.rubricPending, false);
  assert.equal((await call(`submissions/${directSubmission.id}/rubric`, 'teacher', rubricBody)).status, 409);
  const reviewQuestion = { revision: 2, action: 'approve', scores: [4, 6], evidence: ['근거','결론'], feedback: '좋은 풀이입니다.' };
  assert.equal((await call(`submissions/${directSubmission.id}/review`, 'teacher', reviewQuestion)).status, 400, 'student question requires a response before approval');
  assert.equal((await call(`submissions/${directSubmission.id}/review`, 'teacher', { ...reviewQuestion, feedback: '', questionResponse: '끝점도 후보입니다.' })).status, 400, 'final feedback is required on server');
  const qDraft = (await call(`submissions/${directSubmission.id}/review`, 'teacher', { ...reviewQuestion, action: 'draft', questionResponse: '끝점도 후보입니다.' })).result.submission;
  const hidden = (await call(`submissions/${directSubmission.id}`, 'student')).result.submission;
  assert.equal(hidden.draft, null);
  assert.equal(hidden.final, null);
  assert.equal(hidden.studentQuestion, directBody.studentQuestion);
  const qApproved = (await call(`submissions/${directSubmission.id}/review`, 'teacher', { ...reviewQuestion, revision: qDraft.revision, questionResponse: '닫힌 구간의 끝점에서도 극값을 가질 수 있어 비교합니다.' })).result.submission;
  assert.equal(qApproved.final.questionResponse, '닫힌 구간의 끝점에서도 극값을 가질 수 있어 비교합니다.');
  assert.equal((await call(`report-data?ids=${directSubmission.id}`, 'student')).result.submissions[0].studentQuestion, directBody.studentQuestion);
  assert.equal((await call(`submissions/${directSubmission.id}/rubric`, 'teacher', { ...rubricBody, revision: qApproved.revision })).status, 409);
  const personal = (await call('submissions', 'student', { ...directBody, mode: 'personal', directQuestion: { ...directBody.directQuestion, prompt: '함수의 최댓값을 구하시오.' }, clientRequestId: 'personal-direct' })).result.submission;
  assert.equal(personal.academyId, null);
  assert.equal((await call(`submissions/${personal.id}`, 'teacher')).status, 403);
  assert.equal((await call(`submissions/${personal.id}/rubric`, 'teacher', rubricBody)).status, 403);
  assert.equal((await call('state', 'student')).result.points.balance, 0);
  assert.deepEqual((await call('state', 'student')).result.sharedQuestions, []);
  const invalidProblem = new FormData();
  invalidProblem.set('payload', JSON.stringify({ ...directBody, clientRequestId: 'invalid-file' }));
  invalidProblem.set('file', new File(['%PDF-1.7 good'], 'answer.pdf', { type: 'application/pdf' }));
  invalidProblem.set('problemFile', new File(['bad'], 'problem.pdf', { type: 'application/pdf' }));
  const beforeBad = files.size;
  assert.equal((await call('submissions', 'student', invalidProblem)).status, 400);
  assert.equal(files.size, beforeBad, 'both originals validated before any file write');
  // Imported provenance survives private editing and cannot be stripped for a new award.
  const published = (await call('shared-questions', 'teacher', { questionId: question.id, contributorName: '선생님', rightsBasis: 'own', rightsNote: '', rightsConfirmed: true, shareConfirmed: true })).result.sharedQuestion;
  const teacher2 = (await call('academies', 'other-teacher', { name: '두 번째 학원' })).result.academy;
  assert.ok(teacher2.id);
  const imported = (await call(`shared-questions/${published.id}/import`, 'other-teacher', {})).result.question;
  assert.equal(imported.originSharedId, published.id);
  const editedImport = (await call('questions', 'other-teacher', { ...imported, prompt: '수정된 가져온 문제', originSharedId: undefined })).result.question;
  assert.equal(editedImport.originSharedId, published.id);
  assert.equal((await call('shared-questions', 'other-teacher', { questionId: imported.id, contributorName: '다른 선생님', rightsBasis: 'own', rightsConfirmed: true, shareConfirmed: true })).status, 409);
  const crossOrigin = await handleApi(new Request('https://test.example/api/academies', { method: 'POST', headers: { origin: 'https://other.example', 'oai-authenticated-user-id': 'teacher', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'bad' }) }));
  assert.equal(crossOrigin.status, 403);
  console.log('Backend regression checks passed — private direct uploads, student questions, rubric gates, sharing provenance, auth, revisions, files, and unconfigured AI.');
} finally {
  sqlite.close();
  delete globalThis.__mathgradeTestEnv;
  await rm(scratch, { recursive: true, force: true });
}

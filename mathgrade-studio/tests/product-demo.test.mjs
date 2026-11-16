import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const app = fileURLToPath(new URL('..', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'mathgrade-product-demo-'));
for (const [folder, name] of [['client', 'api'], ['client', 'product-demo'], ['server', 'validation'], ['server', 'product-analysis']]) {
  const source = (await readFile(join(app, 'lib', folder, `${name}.ts`), 'utf8'))
    .replace(/from "\.\/api"/g, 'from "./api.mjs"')
    .replace(/from "\.\.\/server\/product-analysis"/g, 'from "./product-analysis.mjs"')
    .replace(/from "\.\/validation"/g, 'from "./validation.mjs"');
  await writeFile(join(scratch, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
}
const { ProductDemo } = await import(pathToFileURL(join(scratch, 'product-demo.mjs')));
after(() => rm(scratch, { recursive: true, force: true }));
const teacherId = 'demo-teacher';
function pack(body, entries) {
  const form = new FormData();
  form.set('payload', JSON.stringify({ ...body, fileMeta: entries.map((entry, index) => ({ role: entry.role, order: entry.order ?? index, itemId: entry.itemId })) }));
  entries.forEach((entry, index) => form.append('files', new File([entry.text ?? `%PDF-original-${index}`], entry.name ?? `file-${index}.pdf`, { type: entry.type ?? 'application/pdf' })));
  return form;
}
function examInput(extra = {}) { return { title: '직접 만든 시험', sourceLabel: '직접 제작', classId: 'class-a', items: [], releaseMode: 'teacher_review', ...extra }; }
function contributionInput(exam, extra = {}) { return { examId: exam.id, revision: exam.revision, contributorName: '공개 별명', rightsBasis: 'own', rightsNote: '', rightsConfirmed: true, premiumConfirmed: true, ...extra }; }
async function makeExam(demo, extra = {}, entries = [{ role: 'problem', text: '%PDF-problem-A' }]) { return (await demo.request('exams', pack(examInput(extra), entries))).exam; }

test('demo student lists and details show only published results and no teacher materials or classmates', async () => {
  const demo = new ProductDemo();
  const initial = demo.detail('sub-a');
  const result = structuredClone(initial.submission.latestVersion.result);
  result.summary = '학생에게 아직 공개하지 않은 선생님 초안';
  await demo.request('submissions/sub-a/review', { revision: 2, result, publish: false });
  demo.state.assignments[0].exam.files.push({ id: 'private-rubric', role: 'rubric', type: 'application/pdf', name: '비공개기준.pdf', url: '/private', order: 0, size: 10 });
  assert.equal(demo.getState().submissions.find(s => s.id === 'sub-a').latestVersion.result.summary, result.summary);
  demo.persona = 'academy_student';
  const state = demo.getState();
  assert.equal(state.submissions.some(s => s.studentId === 'demo-student-2'), false);
  assert.equal(state.members.some(m => m.userId !== 'demo-student'), false);
  assert.ok(state.classes.every(c => !c.teacherCode && !c.studentCode));
  assert.ok(state.assignments.every(a => a.exam.items.every(i => i.criteria === '')));
  assert.equal(state.assignments[0].exam.files.some(file => file.role === 'rubric'), false);
  const visible = state.submissions.find(s => s.id === 'sub-a');
  assert.equal(visible.latestVersion.version, 2);
  assert.equal(visible.reviewStatus, 'reviewed');
  assert.notEqual(visible.latestVersion.result.summary, result.summary);
  const detail = demo.detail('sub-a');
  assert.ok(detail.versions.every(v => v.published));
  assert.equal(detail.submission.latestVersion.version, 2);
  assert.equal(state.submissions.find(s => s.id === 'sub-c').reviewStatus, 'unreviewed');
  assert.equal(state.submissions.find(s => s.id === 'sub-c').latestVersion.authorType, 'ai');
});

test('demo record and chat access respect the student and actual teacher membership', async () => {
  const demo = new ProductDemo();
  demo.persona = 'academy_student';
  assert.throws(() => demo.detail('sub-b'), error => error.status === 403);
  await assert.rejects(demo.request('submissions/sub-b/messages', { text: '다른 학생 대화' }), error => error.status === 403);
  await assert.rejects(demo.request('submissions/sub-a/review', { revision: 2, result: {}, publish: false }), error => error.status === 403);
  await assert.rejects(demo.request('submissions/sub-a/messages', { text: '질문', itemId: 'missing' }), error => error.status === 400);
  const { message } = await demo.request('submissions/sub-a/messages', { text: '이 문항을 다시 설명해 주세요.', itemId: 'q1' });
  assert.equal(message.authorRole, 'student');
  demo.persona = 'teacher';
  demo.state.members = demo.state.members.filter(m => !(m.userId === teacherId && m.classId === 'class-a'));
  assert.throws(() => demo.detail('sub-a'), error => error.status === 403);
  assert.equal(demo.getState().submissions.some(s => s.classId === 'class-a'), false);
});

test('demo exam edits retain selected originals, advance revision and preserve assigned snapshots', async () => {
  const demo = new ProductDemo();
  const exam = await makeExam(demo, {}, [{ role: 'problem', text: '%PDF-old-problem' }, { role: 'rubric', text: '%PDF-old-rubric' }]);
  const { assignment } = await demo.request('assignments', { examId: exam.id, classId: 'class-a', title: '배정 당시 시험' });
  const { exam: revised } = await demo.request('exams', pack(examInput({ id: exam.id, revision: 1, title: '수정 시험', retainedFileIds: [exam.files[1].id] }), [{ role: 'problem', text: '%PDF-new-problem' }]));
  assert.equal(revised.id, exam.id); assert.equal(revised.revision, 2); assert.equal(revised.createdAt, exam.createdAt);
  assert.deepEqual(revised.files.map(file => file.order), [0, 1]);
  assert.equal(revised.files[0].id, exam.files[1].id);
  assert.equal(revised.files.some(file => file.id === exam.files[0].id), false);
  assert.equal(demo.state.assignments.find(a => a.id === assignment.id).exam.revision, 1);
  assert.equal(demo.state.assignments.find(a => a.id === assignment.id).exam.title, exam.title);
  await assert.rejects(demo.request('exams', pack(examInput({ id: exam.id, revision: 1 }), [])), error => error.code === 'REVISION_CONFLICT');
  await assert.rejects(demo.request('exams', pack(examInput({ id: exam.id, revision: 2, retainedFileIds: ['not-owned'] }), [])), error => error.status === 400);
});

test('demo submission uses account identity, class payer, complete ordered files and no live AI', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Demo must not call the network'); });
  const demo = new ProductDemo(); demo.persona = 'academy_student';
  const payload = pack({ assignmentId: 'assignment-a', classId: 'class-a', clientRequestId: 'repeat', question: '두 번째 풀이를 봐주세요.' }, [{ role: 'answer', text: '%PDF-page-2', order: 1 }, { role: 'answer', text: '%PDF-page-1', order: 0 }]);
  const { submission } = await demo.request('submissions', payload);
  assert.equal(submission.studentId, 'demo-student'); assert.equal(submission.billingUserId, teacherId);
  assert.equal(submission.files.length, 2); assert.equal(submission.files[0].name, 'file-1.pdf');
  assert.equal(submission.question, '두 번째 풀이를 봐주세요.');
  assert.equal((await demo.request('submissions', payload)).submission.id, submission.id);
  await assert.rejects(demo.request(`submissions/${submission.id}/analyze`, { revision: 1 }), error => error.code === 'AI_NOT_CONFIGURED');
  assert.equal(demo.detail(submission.id).submission.latestVersion, null);
  assert.equal(demo.detail(submission.id).submission.processing, 'not_configured');
  await assert.rejects(demo.request('submissions', pack({ assignmentId: 'assignment-a', clientRequestId: 'spoof', studentId: 'demo-student-2' }, [{ role: 'answer' }])), error => error.status === 403);
  demo.persona = 'teacher';
  const proxy = await demo.request('submissions', pack({ assignmentId: 'assignment-a', classId: 'class-a', studentId: 'demo-student-2', clientRequestId: 'proxy' }, [{ role: 'answer' }]));
  assert.equal(proxy.submission.studentId, 'demo-student-2'); assert.equal(proxy.submission.submittedBy, teacherId);
});

test('demo personal submission needs no manual criteria and premium reuse honors examId', async () => {
  const demo = new ProductDemo();
  const exam = await makeExam(demo);
  const { contribution } = await demo.request('contributions', contributionInput(exam));
  demo.persona = 'personal';
  await assert.rejects(demo.request(`premium/${contribution.id}/import`, {}), error => error.status === 402);
  const direct = await demo.request('submissions', pack({ title: '내가 가져온 시험', sourceLabel: '학교 자료', clientRequestId: 'personal-direct', question: '' }, [{ role: 'mixed', text: '%PDF-mixed-personal' }]));
  assert.deepEqual(direct.submission.exam.items, []);
  assert.equal(demo.getState().exams.find(e => e.id === direct.submission.exam.id).files.length, 1);
  demo.persona = 'premium';
  const { exam: imported } = await demo.request(`premium/${contribution.id}/import`, {});
  const reused = await demo.request('submissions', pack({ examId: imported.id, clientRequestId: 'premium-reuse', question: '풀이 방향을 봐주세요.' }, [{ role: 'answer', text: '%PDF-premium-answer' }]));
  assert.equal(reused.submission.exam.id, imported.id);
  assert.equal(reused.submission.exam.originContributionId, contribution.id);
  assert.equal(reused.submission.exam.files[0].role, 'problem');
  demo.persona = 'personal';
  await assert.rejects(demo.request('submissions', pack({ examId: imported.id, clientRequestId: 'premium-downgrade' }, [{ role: 'answer' }])), error => error.status === 402);
});

test('demo contributions require separate consent, hide private originals, and retry without points', async () => {
  const demo = new ProductDemo();
  const exam = await makeExam(demo, {}, [{ role: 'problem', text: '%PDF-public', name: '학생실명.pdf' }, { role: 'rubric', text: '%PDF-private-rubric' }, { role: 'solution', text: '%PDF-private-solution' }]);
  await assert.rejects(demo.request('contributions', contributionInput(exam, { premiumConfirmed: false })), error => error.status === 400);
  await assert.rejects(demo.request('contributions', contributionInput(exam, { revision: 0 })), error => error.code === 'REVISION_CONFLICT');
  const results = await Promise.all([demo.request('contributions', contributionInput(exam, { rightsNote: '권리자 비공개 연락처' })), demo.request('contributions', contributionInput(exam))]);
  assert.equal(results[0].contribution.id, results[1].contribution.id);
  assert.equal(results[0].contribution.rewardStatus, 'policy_pending'); assert.equal(results[0].pointsAwarded, 0);
  assert.equal(demo.state.contributions.length, 1); assert.deepEqual(demo.state.points, []);
  const snapshot = results[0].contribution.exam;
  assert.equal(snapshot.files.length, 1); assert.equal(snapshot.files[0].role, 'problem');
  assert.equal(snapshot.files[0].name, '문제자료 1.pdf'); assert.equal(snapshot.ownerId, ''); assert.equal(snapshot.classId, null);
  demo.persona = 'premium';
  assert.equal(demo.premiumCatalog()[0].rightsNote, '');
  assert.deepEqual(demo.getState().contributions, []);
  demo.persona = 'academy_student';
  assert.throws(() => demo.premiumCatalog(), error => error.status === 402);
  await assert.rejects(demo.request('contributions', contributionInput(exam)), error => error.status === 403);
});

test('demo canonical duplicate identity ignores file reordering but preserves mathematical case', async () => {
  const demo = new ProductDemo();
  const a = await makeExam(demo, {}, [{ role: 'problem', text: '%PDF-f(2)' }, { role: 'problem', text: '%PDF-page-B' }]);
  const b = await makeExam(demo, {}, [{ role: 'problem', text: '%PDF-page-B' }, { role: 'problem', text: '%PDF-f(2)' }, { role: 'problem', text: '%PDF-f(2)' }]);
  const c = await makeExam(demo, {}, [{ role: 'problem', text: '%PDF-F(2)' }, { role: 'problem', text: '%PDF-page-B' }]);
  await demo.request('contributions', contributionInput(a));
  await assert.rejects(demo.request('contributions', contributionInput(b)), error => error.code === 'DUPLICATE_CONTRIBUTION');
  await demo.request('contributions', contributionInput(c));
  assert.equal(demo.state.contributions.length, 2);
});

test('demo role-specific class codes and billing choices match the server', async () => {
  const demo = new ProductDemo();
  await assert.rejects(demo.request('classes', { name: '새 반', billingTeacherId: 'someone-else' }), error => error.status === 400);
  const { classroom } = await demo.request('classes', { name: '새 반', billingTeacherId: teacherId, releaseMode: 'ai_immediate' });
  await assert.rejects(demo.request('classes/join', { code: classroom.studentCode }), error => error.status === 404);
  demo.persona = 'academy_student';
  await assert.rejects(demo.request('classes/join', { code: classroom.teacherCode }), error => error.status === 404);
  const joined = await demo.request('classes/join', { code: classroom.studentCode.toLowerCase() });
  assert.equal(joined.classroom.id, classroom.id); assert.equal(joined.classroom.teacherCode, undefined);
  assert.equal(demo.getState().members.find(m => m.classId === classroom.id).role, 'student');
  demo.persona = 'personal';
  await assert.rejects(demo.request('classes/join', { code: classroom.studentCode }), error => error.status === 403);
});

test('demo management preserves fixed codes, blocks removed students and keeps historical files and feedback',async()=>{
  const demo=new ProductDemo(),room=demo.getState().classes.find(c=>c.id==='class-a'),codes=[room.studentCode,room.teacherCode];
  await demo.request('classes/class-a/settings',{name:'변경된 이름',billingTeacherId:teacherId});
  assert.deepEqual([demo.getState().classes[0].studentCode,demo.getState().classes[0].teacherCode],codes);
  await demo.request('classes/class-a/remove',{studentId:'demo-student'});demo.persona='academy_student';
  await assert.rejects(()=>demo.request('classes/join',{code:codes[0]}),e=>e.code==='CLASS_REENTRY_BLOCKED');assert.ok(demo.detail('sub-a').versions.length);
  demo.persona='teacher';await demo.request('classes/class-a/readmit',{studentId:'demo-student'});demo.persona='academy_student';await demo.request('classes/join',{code:codes[0]});
  const before=demo.detail('sub-a');await demo.request('submissions/sub-a/materials',pack({revision:before.submission.revision,clientRequestId:'replace',retainedFileIds:[],question:'수정 질문'},[{role:'answer',name:'new-answer.pdf'}]));
  const after=demo.detail('sub-a');assert.equal(after.submission.materialVersion,2);assert.equal(after.versions.length,before.versions.length);assert.equal(after.materials.length,2);
  const body={clientRequestId:'same-message',text:'한 번 전송'};const one=await demo.request('submissions/sub-a/messages',body),two=await demo.request('submissions/sub-a/messages',body);assert.equal(one.message.id,two.message.id);
  demo.persona='teacher';await demo.request('assignments/assignment-a/cancel',{revision:1});
  await assert.rejects(()=>demo.request('submissions/sub-a/materials',pack({revision:after.submission.revision,clientRequestId:'cancelled',retainedFileIds:[]},[{role:'answer'}])),e=>e.code==='ASSIGNMENT_CANCELLED');
});

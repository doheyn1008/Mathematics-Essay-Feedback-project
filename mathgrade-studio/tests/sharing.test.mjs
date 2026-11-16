import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'mathgrade-sharing-'));
const sqlite = new DatabaseSync(':memory:');
for (const name of (await readdir(join(appDir, 'drizzle'))).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(await readFile(join(appDir, 'drizzle', name), 'utf8'));
function statement(sql, values = []) {
  return {
    bind(...args) { return statement(sql, args); },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; }, sql, values,
  };
}
let queue = Promise.resolve();
const db = {
  prepare: statement,
  batch(statements) {
    const operation = queue.then(async () => {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const entry of statements) results.push(/^SELECT/i.test(entry.sql) ? await entry.all() : await entry.run());
        sqlite.exec('COMMIT'); return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    });
    queue = operation.catch(() => {}); return operation;
  },
};
for (const name of ['validation', 'sharing']) {
  const input = (await readFile(join(appDir, 'lib', 'server', `${name}.ts`), 'utf8')).replace('from "./validation"', 'from "./validation.mjs"');
  await writeFile(join(scratch, `${name}.mjs`), ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
}
const { getSharingState, publishSharedQuestion, withdrawSharedQuestion, importSharedQuestion } = await import(pathToFileURL(join(scratch, 'sharing.mjs')));
const teacher = { id: 't1', name: '선생님 1' };
const other = { id: 't2', name: '선생님 2' };
const student = { id: 's1', name: '학생' };
const now = new Date().toISOString();
function createQuestion(id, ownerId, prompt = '정수 x에 대해 x + 1 = 3을 만족하는 x를 구하시오.', overrides = {}) {
  const question = { id, ownerId, academyId: null, revision: 1, title: '자체 제작 문항', prompt, university: '', department: '', examKey: '', academicYear: null, sourceLabel: '직접 제작', sourceUrl: '', notes: '비공개 교사 메모', references: [{ id: 'private', url: '/api/references/private', name: '학생이름.pdf' }], criteria: [{ id: 'c1', title: '과정', max: 10, description: '방정식의 성질을 이용한다.' }], createdAt: now, ...overrides };
  sqlite.prepare('INSERT INTO questions (id, owner_id, data, revision, created_at) VALUES (?, ?, ?, ?, ?)').run(id, ownerId, JSON.stringify(question), 1, now);
  return question;
}
const publish = questionId => ({ questionId, revision: 1, contributorName: '공개 별명', rightsBasis: 'own', rightsNote: '', rightsConfirmed: true, shareConfirmed: true });
try {
  for (const user of [teacher, other]) sqlite.prepare('INSERT INTO academies (id, owner_id, name, join_code, created_at) VALUES (?, ?, ?, ?, ?)').run(`a-${user.id}`, user.id, '학원', `code-${user.id}`, now);
  createQuestion('q1', teacher.id);
  createQuestion('student-q', student.id, '학생 문제');
  await assert.rejects(() => publishSharedQuestion(db, student, publish('student-q')), error => error.status === 403);
  await assert.rejects(() => publishSharedQuestion(db, other, publish('q1')), error => error.status === 403);
  await assert.rejects(() => publishSharedQuestion(db, teacher, { ...publish('q1'), shareConfirmed: false }), error => error.status === 400);
  await assert.rejects(() => publishSharedQuestion(db, teacher, { ...publish('q1'), rightsBasis: 'permission' }), error => error.status === 400);
  await assert.rejects(() => publishSharedQuestion(db, teacher, { ...publish('q1'), revision: 0 }), error => error.code === 'REVISION_CONFLICT');
  const parallel = await Promise.all([publishSharedQuestion(db, teacher, publish('q1')), publishSharedQuestion(db, teacher, publish('q1'))]);
  assert.equal(parallel[0].sharedQuestion.id, parallel[1].sharedQuestion.id);
  assert.equal(parallel.reduce((total, item) => total + item.pointsAwarded, 0), 10, 'concurrent retry awards once');
  const shared = parallel[0].sharedQuestion;
  assert.equal('notes' in shared, false);
  assert.equal('references' in shared, false);
  assert.equal(JSON.stringify(shared).includes('학생이름'), false, 'private filenames cannot be shared');
  const teacherState = await getSharingState(db, teacher);
  assert.equal(teacherState.points.balance, 10);
  assert.equal(teacherState.points.events.length, 1);
  assert.equal((await getSharingState(db, other)).sharedQuestions.length, 1);
  assert.deepEqual(await getSharingState(db, student), { sharedQuestions: [], points: { balance: 0, events: [] } });
  createQuestion('duplicate', other.id, '  정수   x에 대해 x + 1 = 3을 만족하는 x를 구하시오. ');
  await assert.rejects(() => publishSharedQuestion(db, other, publish('duplicate')), error => error.code === 'DUPLICATE_CONTRIBUTION');
  createQuestion('compact-duplicate', other.id, '정수x에대해x+1=3을만족하는x를구하시오.');
  await assert.rejects(() => publishSharedQuestion(db, other, publish('compact-duplicate')), error => error.code === 'DUPLICATE_CONTRIBUTION');
  assert.equal((await getSharingState(db, other)).points.balance, 0);
  const imported = await Promise.all([importSharedQuestion(db, other, shared.id), importSharedQuestion(db, other, shared.id)]);
  assert.equal(imported[0].question.id, imported[1].question.id, 'import retries reuse a private copy');
  assert.equal(imported[0].question.originSharedId, shared.id);
  assert.match(imported[0].question.sourceLabel, /공개 별명/);
  assert.equal(imported[0].question.notes, '');
  assert.deepEqual(imported[0].question.references, []);
  await assert.rejects(() => publishSharedQuestion(db, other, publish(imported[0].question.id)), error => error.code === 'IMPORTED_QUESTION');
  await assert.rejects(() => withdrawSharedQuestion(db, other, shared.id), error => error.status === 404);
  await withdrawSharedQuestion(db, teacher, shared.id);
  assert.equal((await getSharingState(db, other)).sharedQuestions.length, 0);
  assert.equal((await getSharingState(db, teacher)).sharedQuestions[0].status, 'withdrawn');
  const retry = await publishSharedQuestion(db, teacher, publish('q1'));
  assert.equal(retry.pointsAwarded, 0);
  assert.equal(retry.sharedQuestion.status, 'withdrawn');
  assert.equal((await getSharingState(db, teacher)).points.balance, 10, 'withdraw does not re-award or create a new credit');
  const third = { id: 't3', name: '다른 선생님' };
  sqlite.prepare('INSERT INTO academies (id, owner_id, name, join_code, created_at) VALUES (?, ?, ?, ?, ?)').run('a3', third.id, '학원3', 'code3', now);
  await assert.rejects(() => importSharedQuestion(db, third, shared.id), error => error.status === 404);
  createQuestion('case-a', teacher.id, 'f(x)=x, F(x)=x²일 때 f(2)를 구하시오.');
  createQuestion('case-b', teacher.id, 'f(x)=x, F(x)=x²일 때 F(2)를 구하시오.');
  await publishSharedQuestion(db, teacher, publish('case-a'));
  await publishSharedQuestion(db, teacher, publish('case-b'));
  createQuestion('compat-a', teacher.id, 'x² = 4를 풀어라.');
  createQuestion('compat-b', teacher.id, 'x2 = 4를 풀어라.');
  await publishSharedQuestion(db, teacher, publish('compat-a'));
  await publishSharedQuestion(db, teacher, publish('compat-b'));
  createQuestion('changed-during-publish', teacher.id, '새 문제 777');
  const racingDb = { ...db, async batch(writes) {
    sqlite.prepare('UPDATE questions SET revision = 2 WHERE id = ?').run('changed-during-publish');
    return db.batch(writes);
  }};
  await assert.rejects(() => publishSharedQuestion(racingDb, teacher, publish('changed-during-publish')), error => error.code === 'REVISION_CONFLICT');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM shared_questions WHERE source_question_id = ?').get('changed-during-publish').count, 0);
  createQuestion('rollback', teacher.id, '서로 다른 두 주사위에서 눈의 합이 3일 확률을 구하시오.');
  sqlite.exec("CREATE TRIGGER fail_point_award BEFORE INSERT ON point_events BEGIN SELECT RAISE(ABORT, 'simulated ledger failure'); END;");
  await assert.rejects(() => publishSharedQuestion(db, teacher, publish('rollback')));
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM shared_questions WHERE source_question_id = ?').get('rollback').count, 0, 'snapshot and points commit atomically');
  sqlite.exec('DROP TRIGGER fail_point_award');
  console.log('Sharing checks passed — teacher authorization, explicit sharing consent, snapshot privacy, atomic one-time points, duplicate and imported content rejection, withdrawal, idempotent imports.');
} finally {
  sqlite.close(); await rm(scratch, { recursive: true, force: true });
}

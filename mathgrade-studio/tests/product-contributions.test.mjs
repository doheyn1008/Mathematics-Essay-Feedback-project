import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'mathgrade-product-contributions-'));
const runtime = {};
globalThis.__productContributionTestEnv = runtime;
await writeFile(join(scratch, 'env.mjs'), 'export const env = globalThis.__productContributionTestEnv;');
for (const name of ['validation', 'product-auth', 'product-contributions']) {
  const source = (await readFile(join(appDir, 'lib/server', `${name}.ts`), 'utf8'))
    .replace('from "cloudflare:workers"', 'from "./env.mjs"')
    .replace(/from "\.\/(validation|product-auth)"/g, 'from "./$1.mjs"');
  await writeFile(join(scratch, `${name}.mjs`), ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
}
const { handleProductContributionRoute, getProductContributions, contributionPolicy } = await import(pathToFileURL(join(scratch, 'product-contributions.mjs')));
const migrations = await Promise.all((await readdir(join(appDir, 'drizzle'))).filter(name => name.endsWith('.sql')).sort().map(name => readFile(join(appDir, 'drizzle', name), 'utf8')));
after(async () => { delete globalThis.__productContributionTestEnv; await rm(scratch, { recursive: true, force: true }); });

const now = new Date().toISOString();
const user = id => ({ id, name: `사용자 ${id}`, email: `${id}@example.test` });
const teacher = user('teacher');
const otherTeacher = user('other-teacher');
const premium = user('premium');
const otherPremium = user('other-premium');
const basic = user('basic');
const student = user('student');
const inactive = user('inactive');
const submitBody = (examId, extra = {}) => ({ examId, revision: 1, contributorName: '공개 선생님', rightsBasis: 'own', rightsNote: '', rightsConfirmed: true, premiumConfirmed: true, ...extra });

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of migrations) sqlite.exec(migration);
  const objects = new Map();
  let beforeBatch;
  function statement(sql, values = []) {
    return {
      sql, values,
      bind(...args) { return statement(sql, args); },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
    };
  }
  let queue = Promise.resolve();
  const db = {
    prepare: statement,
    batch(statements) {
      const operation = queue.then(async () => {
        if (beforeBatch) { const callback = beforeBatch; beforeBatch = undefined; await callback(); }
        sqlite.exec('BEGIN');
        try {
          const results = [];
          for (const entry of statements) results.push(/^SELECT/i.test(entry.sql) ? await entry.all() : await entry.run());
          sqlite.exec('COMMIT');
          return results;
        } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
  for (const key of Object.keys(runtime)) delete runtime[key];
  runtime.DB = db;
  runtime.BUCKET = { async get(key) {
    const value = objects.get(key);
    if (!value) return null;
    return { body: value.slice(), async arrayBuffer() { return value.slice().buffer; } };
  } };
  for (const [account, type, plan, active] of [
    [teacher, 'teacher', 'teacher', true], [otherTeacher, 'teacher', 'teacher', true],
    [premium, 'personal', 'personal_premium', true], [otherPremium, 'personal', 'personal_premium', true],
    [basic, 'personal', 'personal_basic', true], [student, 'academy_student', null, false],
    [inactive, 'teacher', 'teacher', false],
  ]) {
    sqlite.prepare('INSERT INTO product_profiles (user_id,account_type,display_name,created_at) VALUES (?,?,?,?)').run(account.id, type, account.name, now);
    if (plan) sqlite.prepare('INSERT INTO product_entitlements (user_id,plan,status,expires_at,analysis_limit,used) VALUES (?,?,?,NULL,NULL,0)').run(account.id, plan, active ? 'active' : 'inactive');
  }
  async function request(actor, path, body, options = {}) {
    const method = options.method || (body === undefined ? 'GET' : 'POST');
    const response = await handleProductContributionRoute(new Request(`https://example.test/api/product/${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(options.origin ? { Origin: options.origin } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), path, actor, db);
    assert.ok(response, `route ${path} was handled`);
    return response;
  }
  async function json(actor, path, body, options) { return (await request(actor, path, body, options)).json(); }
  function exam(id, owner = teacher, contents = [`%PDF-${id}`], extra = {}) {
    const files = contents.map((content, index) => {
      const role = typeof content === 'string' ? 'problem' : content.role;
      const text = typeof content === 'string' ? content : content.text;
      const bytes = new TextEncoder().encode(text);
      const file = { id: `${id}-file-${index}`, name: `민감한학생이름-${index}.pdf`, type: 'application/pdf', size: bytes.length, role, order: index, url: `/api/product/files/${id}-file-${index}` };
      objects.set(`object/${file.id}`, bytes);
      return file;
    });
    const value = { id, ownerId: owner.id, classId: null, title: `시험 ${id}`, sourceLabel: '직접 제작', sourceUrl: '', items: [{ id: 'q1', label: '1번', maxScore: 10, criteria: '과정 평가' }], files, releaseMode: 'teacher_review', revision: 1, createdAt: now, ...extra };
    sqlite.prepare('INSERT INTO product_exams (id,owner_id,class_id,data,revision,created_at) VALUES (?,?,NULL,?,?,?)').run(id, owner.id, JSON.stringify(value), value.revision, now);
    for (const file of files) sqlite.prepare('INSERT INTO product_files (id,owner_id,exam_id,submission_id,object_key,role,data) VALUES (?,?,?,NULL,?,?,?)').run(file.id, owner.id, id, `object/${file.id}`, file.role, JSON.stringify(file));
    return value;
  }
  t.after(() => sqlite.close());
  return { sqlite, db, objects, exam, request, json, beforeBatch(callback) { beforeBatch = callback; } };
}

test('contribution requires a paid teacher, their own exam and both explicit consents', async t => {
  const f = fixture(t);
  f.exam('owned');
  f.exam('unpaid', inactive);
  f.exam('student-owned', student);
  for (const [actor, examId, status] of [[otherTeacher, 'owned', 403], [inactive, 'unpaid', 402], [student, 'student-owned', 403]]) {
    await assert.rejects(f.json(actor, 'contributions', submitBody(examId)), error => error.status === status);
  }
  for (const body of [{ rightsConfirmed: false }, { premiumConfirmed: false }, { rightsBasis: 'permission', rightsNote: '' }, { rightsNote: 'a'.repeat(2001) }]) {
    await assert.rejects(f.json(teacher, 'contributions', submitBody('owned', body)), error => error.status === 400);
  }
  await assert.rejects(f.json(teacher, 'contributions', submitBody('owned'), { origin: 'https://outside.test' }), error => error.status === 403);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_contributions').get().n, 0);
});

test('unconfigured points stay pending and consent snapshot is immutable across retries', async t => {
  const f = fixture(t);
  f.exam('pending');
  assert.deepEqual(contributionPolicy(), { contributionPoints: null, contributionPolicyVersion: null });
  const saved = await f.json(teacher, 'contributions', submitBody('pending', { rightsBasis: 'permission', rightsNote: '권리자에게 유료 프리미엄 제공 동의를 받음' }));
  assert.equal(saved.pointsAwarded, 0);
  assert.equal(saved.contribution.rewardStatus, 'policy_pending');
  assert.equal(saved.contribution.sourceRevision, 1);
  assert.equal(saved.contribution.consentVersion, 'premium-reuse-v1');
  assert.match(saved.contribution.consentScope, /개인용 유료 프리미엄/);
  assert.ok(Number.isFinite(Date.parse(saved.contribution.consentAt)));
  const retry = await f.json(teacher, 'contributions', submitBody('pending', { rightsNote: '다른 설명', revision: 99 }));
  assert.deepEqual(retry.contribution, saved.contribution, 'retry cannot silently change the consented snapshot');
  assert.equal(retry.pointsAwarded, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_points').get().n, 0);
});

test('configured policy awards exactly once under concurrent publication retries', async t => {
  const f = fixture(t);
  runtime.CONTRIBUTION_POINTS = '17'; runtime.CONTRIBUTION_POLICY_VERSION = 'test-policy-2';
  f.exam('parallel');
  const responses = await Promise.all([f.json(teacher, 'contributions', submitBody('parallel')), f.json(teacher, 'contributions', submitBody('parallel'))]);
  assert.equal(responses[0].contribution.id, responses[1].contribution.id);
  assert.equal(responses.reduce((total, result) => total + result.pointsAwarded, 0), 17);
  const state = await getProductContributions(f.db, teacher);
  assert.equal(state.points.length, 1);
  assert.equal(state.points[0].amount, 17);
  assert.equal(state.points[0].policyVersion, 'test-policy-2');
  assert.deepEqual(await getProductContributions(f.db, student), { contributions: [], points: [] });
  assert.equal((await getProductContributions(f.db, otherTeacher)).contributions.length, 0);
});

test('point ledger failure rolls back the entire contribution', async t => {
  const f = fixture(t);
  runtime.CONTRIBUTION_POINTS = '8'; runtime.CONTRIBUTION_POLICY_VERSION = 'test-policy';
  f.exam('rollback');
  f.sqlite.exec("CREATE TRIGGER reject_product_point BEFORE INSERT ON product_points BEGIN SELECT RAISE(ABORT, 'ledger unavailable'); END");
  await assert.rejects(f.json(teacher, 'contributions', submitBody('rollback')), /ledger unavailable/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_contributions').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_points').get().n, 0);
});

test('publication rejects stale revisions and a revision changed after preview but before write', async t => {
  const f = fixture(t);
  runtime.CONTRIBUTION_POINTS = '9'; runtime.CONTRIBUTION_POLICY_VERSION = 'test-policy';
  f.exam('stale');
  await assert.rejects(f.json(teacher, 'contributions', submitBody('stale', { revision: 0 })), error => error.code === 'REVISION_CONFLICT');
  f.beforeBatch(() => f.sqlite.prepare('UPDATE product_exams SET revision=2 WHERE id=?').run('stale'));
  await assert.rejects(f.json(teacher, 'contributions', submitBody('stale')), error => error.code === 'REVISION_CONFLICT');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_contributions').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_points').get().n, 0);
});

test('published snapshots contain only authorized problem originals and sanitized filenames', async t => {
  const f = fixture(t);
  const source = f.exam('privacy', teacher, [
    '%PDF-problem', { role: 'answer', text: '%PDF-student-answer' },
    { role: 'mixed', text: '%PDF-mixed-answer' }, { role: 'solution', text: '%PDF-teacher-solution' }, { role: 'rubric', text: '%PDF-private-rubric' },
  ], { privateNotes: '비공개 교사 메모' });
  const { contribution } = await f.json(teacher, 'contributions', submitBody('privacy'));
  assert.equal(contribution.exam.files.length, 1);
  assert.equal(contribution.exam.files[0].id, source.files[0].id);
  assert.equal(contribution.exam.files[0].name, '문제자료 1.pdf');
  assert.equal(contribution.exam.ownerId, '');
  assert.equal(contribution.exam.classId, null);
  assert.equal('privateNotes' in contribution.exam, false);
  assert.equal(JSON.stringify(contribution).includes('민감한학생이름'), false);
  for (const file of source.files.slice(1)) {
    await assert.rejects(f.request(premium, `premium/files/${contribution.id}/${file.id}`), error => error.status === 404);
  }
  const response = await f.request(premium, `premium/files/${contribution.id}/${source.files[0].id}`);
  assert.equal(await response.text(), '%PDF-problem');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('file-only contribution requires real ownership and rejects mixed-only or imported exams', async t => {
  const f = fixture(t);
  f.exam('mixed-only', teacher, [{ role: 'mixed', text: '%PDF-answer-and-problem' }]);
  await assert.rejects(f.json(teacher, 'contributions', submitBody('mixed-only')), error => error.status === 400);
  const source = f.exam('foreign-file');
  f.sqlite.prepare('UPDATE product_files SET owner_id=? WHERE id=?').run(otherTeacher.id, source.files[0].id);
  await assert.rejects(f.json(teacher, 'contributions', submitBody('foreign-file')), error => error.status === 403);
  f.exam('imported', teacher, ['%PDF-import'], { originContributionId: 'original' });
  await assert.rejects(f.json(teacher, 'contributions', submitBody('imported')), error => error.code === 'IMPORTED_EXAM');
  f.exam('legacy', teacher, ['%PDF-legacy'], { legacyId: 'q-old' });
  await assert.rejects(f.json(teacher, 'contributions', submitBody('legacy')), error => error.code === 'IMPORTED_EXAM');
});

test('exact duplicate originals cannot earn again, but different mathematical case stays distinct', async t => {
  const f = fixture(t);
  f.exam('lower', teacher, ['%PDF-f(x)=x,F(x)=x²; f(2)']);
  f.exam('duplicate', otherTeacher, ['%PDF-f(x)=x,F(x)=x²; f(2)']);
  f.exam('upper', otherTeacher, ['%PDF-f(x)=x,F(x)=x²; F(2)']);
  f.exam('exponent', otherTeacher, ['%PDF-f(x)=x,F(x)=x2; f(2)']);
  await f.json(teacher, 'contributions', submitBody('lower'));
  await assert.rejects(f.json(otherTeacher, 'contributions', submitBody('duplicate')), error => error.code === 'DUPLICATE_CONTRIBUTION');
  await f.json(otherTeacher, 'contributions', submitBody('upper'));
  await f.json(otherTeacher, 'contributions', submitBody('exponent'));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_contributions').get().n, 3);
});

test('catalog, import, and files enforce personal premium permission on every endpoint', async t => {
  const f = fixture(t);
  const source = f.exam('access');
  const { contribution } = await f.json(teacher, 'contributions', submitBody('access', { rightsNote: '비공개 권리 근거 연락처' }));
  const paths = ['premium', `premium/${contribution.id}/import`, `premium/files/${contribution.id}/${source.files[0].id}`];
  for (const actor of [teacher, basic, student, inactive]) for (const path of paths) {
    await assert.rejects(f.request(actor, path, path.endsWith('/import') ? {} : undefined), error => error.status === 402 || error.status === 403);
  }
  const catalog = await f.json(premium, 'premium');
  assert.equal(catalog.contributions.length, 1);
  assert.equal(catalog.contributions[0].rightsNote, '');
  f.sqlite.prepare('UPDATE product_entitlements SET expires_at=? WHERE user_id=?').run('2000-01-01T00:00:00Z', premium.id);
  await assert.rejects(f.json(premium, 'premium'), error => error.code === 'ENTITLEMENT_REQUIRED');
});

test('reordering or repeating the same problem files cannot create another contribution award', async t => {
  const f = fixture(t);
  runtime.CONTRIBUTION_POINTS = '13'; runtime.CONTRIBUTION_POLICY_VERSION = 'test-policy';
  f.exam('pages-original', teacher, ['%PDF-page-A', '%PDF-page-B']);
  f.exam('pages-reversed', otherTeacher, ['%PDF-page-B', '%PDF-page-A']);
  f.exam('pages-repeated', otherTeacher, ['%PDF-page-A', '%PDF-page-B', '%PDF-page-A']);
  await f.json(teacher, 'contributions', submitBody('pages-original'));
  for (const examId of ['pages-reversed', 'pages-repeated']) {
    await assert.rejects(f.json(otherTeacher, 'contributions', submitBody(examId)), error => error.code === 'DUPLICATE_CONTRIBUTION');
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_contributions').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_points').get().n, 1);
  assert.equal((await getProductContributions(f.db, otherTeacher)).points.length, 0);
});

test('concurrent imports reuse one private exam, and withdrawal keeps existing records only', async t => {
  const f = fixture(t);
  runtime.CONTRIBUTION_POINTS = '11'; runtime.CONTRIBUTION_POLICY_VERSION = 'test-policy';
  const source = f.exam('withdraw');
  const { contribution } = await f.json(teacher, 'contributions', submitBody('withdraw'));
  const imports = await Promise.all([f.json(premium, `premium/${contribution.id}/import`, {}), f.json(premium, `premium/${contribution.id}/import`, {})]);
  assert.equal(imports[0].exam.id, imports[1].exam.id);
  assert.equal(imports[0].exam.ownerId, premium.id);
  assert.equal(imports[0].exam.originContributionId, contribution.id);
  await assert.rejects(f.json(otherTeacher, `contributions/${contribution.id}/withdraw`, {}), error => error.status === 404);
  f.sqlite.prepare("UPDATE product_entitlements SET status='inactive' WHERE user_id=?").run(teacher.id);
  await f.json(teacher, `contributions/${contribution.id}/withdraw`, {});
  assert.equal((await f.json(premium, 'premium')).contributions.length, 0);
  assert.equal((await f.json(premium, `premium/${contribution.id}/import`, {})).exam.id, imports[0].exam.id);
  assert.equal(await (await f.request(premium, `premium/files/${contribution.id}/${source.files[0].id}`)).text(), '%PDF-withdraw');
  await assert.rejects(f.json(otherPremium, `premium/${contribution.id}/import`, {}), error => error.status === 404);
  await assert.rejects(f.request(otherPremium, `premium/files/${contribution.id}/${source.files[0].id}`), error => error.status === 404);
  const state = await getProductContributions(f.db, teacher);
  assert.equal(state.contributions[0].status, 'withdrawn');
  assert.equal(state.points.length, 1);
  assert.equal(state.points[0].amount, 11);
});

test('withdrawal racing a new import does not create an orphan private exam', async t => {
  const f = fixture(t);
  f.exam('import-race');
  const { contribution } = await f.json(teacher, 'contributions', submitBody('import-race'));
  f.beforeBatch(() => f.sqlite.prepare("UPDATE product_contributions SET status='withdrawn' WHERE id=?").run(contribution.id));
  await assert.rejects(f.json(premium, `premium/${contribution.id}/import`, {}), error => error.status === 404);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_exams WHERE owner_id=?').get(premium.id).n, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_imports').get().n, 0);
});

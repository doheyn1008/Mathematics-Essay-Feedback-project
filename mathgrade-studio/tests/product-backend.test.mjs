import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'mathgrade-product-backend-'));
const runtime = {};
globalThis.__productBackendTestEnv = runtime;
await writeFile(join(scratch, 'env.mjs'), 'export const env = globalThis.__productBackendTestEnv;');
for (const filename of (await readdir(join(appDir, 'lib/server'))).filter(name => name.endsWith('.ts'))) {
  const source = (await readFile(join(appDir, 'lib/server', filename), 'utf8'))
    .replace(/from "cloudflare:workers"/g, 'from "./env.mjs"')
    .replace(/from "\.\/([^".]+)"/g, 'from "./$1.mjs"');
  await writeFile(join(scratch, filename.replace(/\.ts$/, '.mjs')), ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
}
const { routeApi } = await import(pathToFileURL(join(scratch, 'api-router.mjs')));
const { ingestAnalysisResult } = await import(pathToFileURL(join(scratch, 'product-service.mjs')));
const { prepareAnalysisInput } = await import(pathToFileURL(join(scratch, 'product-analysis.mjs')));
const migrations = await Promise.all((await readdir(join(appDir, 'drizzle'))).filter(name => name.endsWith('.sql')).sort().map(name => readFile(join(appDir, 'drizzle', name), 'utf8')));
after(async () => { delete globalThis.__productBackendTestEnv; await rm(scratch, { recursive: true, force: true }); });

const timestamp = new Date().toISOString();
function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of migrations) sqlite.exec(migration);
  const objects = new Map();
  function statement(sql, values = []) {
    return { sql, values, bind(...args) { return statement(sql,args); },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
    };
  }
  let queue = Promise.resolve();
  const db = { prepare: statement, batch(statements) {
    const result = queue.then(async () => {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const entry of statements) results.push(/^SELECT/i.test(entry.sql) ? await entry.all() : await entry.run());
        sqlite.exec('COMMIT'); return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    });
    queue = result.catch(() => {}); return result;
  } };
  for (const key of Object.keys(runtime)) delete runtime[key];
  runtime.DB = db;
  runtime.BUCKET = {
    async put(key, bytes) { objects.set(key,new Uint8Array(bytes)); },
    async delete(key) { objects.delete(key); },
    async get(key) { const bytes = objects.get(key); return bytes ? { body: bytes.slice(), async arrayBuffer() { return bytes.slice().buffer; } } : null; },
  };
  t.after(() => sqlite.close());
  async function call(path,user,body,options={}) {
    const method = options.method ?? (body === undefined ? 'GET' : 'POST');
    const headers = new Headers({ origin: options.origin ?? 'https://example.test' });
    if (user) { headers.set('oai-authenticated-user-id',user); headers.set('oai-authenticated-user-full-name',encodeURIComponent(`이름 ${user}`)); headers.set('oai-authenticated-user-full-name-encoding','percent-encoded-utf-8'); }
    if (body !== undefined && !(body instanceof FormData)) headers.set('content-type','application/json');
    const response = await routeApi(new Request(`https://example.test${path.startsWith('/api/') ? path : '/api/product/'+path}`, {
      method,headers,body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    }));
    const value = response.headers.get('content-type')?.includes('application/json') ? await response.json() : new Uint8Array(await response.arrayBuffer());
    return { status: response.status, value, headers: response.headers };
  }
  async function ok(path,user,body,expected=200) {
    const response = await call(path,user,body);
    assert.equal(response.status,expected,`${path}: ${JSON.stringify(response.value)}`);
    return response.value;
  }
  async function register(id,type,paid=false) {
    await ok('account',id,{accountType:type,displayName:`등록 ${id}`},201);
    if (paid) grant(id,type === 'teacher' ? 'teacher' : 'personal_basic');
  }
  function grant(id,plan='teacher',limit=20) {
    sqlite.prepare('INSERT OR REPLACE INTO product_entitlements (user_id,plan,status,expires_at,analysis_limit,used) VALUES (?,?,?,NULL,?,0)').run(id,plan,'active',limit);
  }
  async function classroom(owner='teacher',mode='teacher_review',name='A대 논술반') {
    return (await ok('classes',owner,{name,billingTeacherId:owner,releaseMode:mode},201)).classroom;
  }
  function form(body,files) {
    const result = new FormData();
    result.set('payload',JSON.stringify({...body,fileMeta:files.map((f,i)=>({role:f.role,order:f.order ?? i,...(f.itemId ? {itemId:f.itemId}:{})}))}));
    files.forEach((f,i)=>result.append('files',new File([f.bytes ?? `%PDF-1.7 ${f.name ?? i}`],f.name ?? `page-${i}.pdf`,{type:f.type ?? 'application/pdf'})));
    return result;
  }
  async function exam(owner='teacher',classId=null,overrides={},files=[{role:'problem'}]) {
    return (await ok('exams',owner,form({title:'다문항 시험',classId,sourceLabel:'직접 제작',sourceUrl:'',items:[{id:'q1',label:'1번',maxScore:10,criteria:''},{id:'q2',label:'2번',maxScore:20,criteria:''}],releaseMode:'teacher_review',...overrides},files),201)).exam;
  }
  async function assignment(classId,examId,owner='teacher') {
    return (await ok('assignments',owner,{classId,examId,title:'주간 시험'},201)).assignment;
  }
  let sequence = 0;
  async function submit(user,assignmentId,extra={},files=[{role:'answer'}]) {
    return (await ok('submissions',user,form({assignmentId,clientRequestId:`request-${++sequence}`,question:'왜 감점되나요?',...extra},files),201)).submission;
  }
  async function base(mode='teacher_review') {
    await register('teacher','teacher',true); await register('student','academy_student'); await register('outsider','academy_student');
    const room = await classroom('teacher',mode);
    await ok('classes/join','student',{code:room.studentCode});
    const paper = await exam('teacher',room.id,{releaseMode:mode});
    const work = await assignment(room.id,paper.id);
    return {room,paper,work};
  }
  return {sqlite,db,objects,call,ok,register,grant,classroom,form,exam,assignment,submit,base};
}
function result(items=[{id:'q1',label:'1번',maxScore:10},{id:'q2',label:'2번',maxScore:20}],summary='수학적 근거를 보완하세요.') {
  return {items:items.map(item=>({itemId:item.id,label:item.label,score:item.maxScore-1,maxScore:item.maxScore,evidence:'조건 확인',feedback:'이유를 명시하세요.',solution:'독립 풀이 검토 내용',uncertainty:''})),total:0,maximum:0,summary,questionResponse:'조건의 근거가 빠져 감점했습니다.',basis:'general',uncertainties:[]};
}

test('account types are immutable; paid grants cannot be obtained through public routes or legacy modes',async t=>{
  const f=fixture(t);
  assert.equal((await f.call('state',null)).value.user,null);
  assert.equal((await f.call('account',null,{accountType:'teacher',displayName:'x'})).status,401);
  await f.register('teacher','teacher');
  const state=await f.ok('state','teacher');
  assert.equal(state.profile.accountType,'teacher'); assert.equal(state.entitlement,null);
  assert.equal((await f.call('account','teacher',{accountType:'personal',displayName:'x'})).value.code,'ACCOUNT_TYPE_LOCKED');
  assert.equal((await f.call('classes','teacher',{name:'반',billingTeacherId:'teacher'})).status,402);
  assert.equal((await f.call('entitlements','teacher',{status:'active',plan:'teacher'})).status,404);
  for(const old of ['academies','join','questions','assignments','submissions','shared-questions','analyze']) {
    assert.equal((await f.call(`/api/${old}`,'teacher',{mode:'teacher',role:'teacher'})).value.code,'LEGACY_READ_ONLY');
  }
  assert.equal((await f.call('/api/academies',null,{})).status,401);
  assert.equal((await f.call('account','other',{accountType:'teacher',displayName:'x'},{origin:'https://evil.test'})).status,403);
  assert.equal((await f.call('state','other')).value.profile,null);
});

test('class roles and multiple memberships are server-enforced; students join free and teachers explicitly accept billing',async t=>{
  const f=fixture(t); await f.register('teacher','teacher',true); await f.register('co','teacher',true); await f.register('student','academy_student'); await f.register('personal','personal',true);
  const one=await f.classroom(),two=await f.classroom('teacher','ai_immediate','B대 논술반');
  assert.equal((await f.call('classes','teacher',{name:'잘못된 담당',billingTeacherId:'co'})).status,400);
  assert.equal((await f.call('classes/join','student',{code:one.teacherCode})).status,404);
  assert.equal((await f.call('classes/join','co',{code:one.studentCode})).status,404);
  assert.equal((await f.call('classes/join','personal',{code:one.studentCode})).status,403);
  for(const room of [one,two]) await f.ok('classes/join','student',{code:room.studentCode});
  await f.ok('classes/join','co',{code:one.teacherCode});
  const studentState=await f.ok('state','student');
  assert.equal(studentState.classes.length,2); assert.equal(studentState.entitlement,null);
  assert.ok(studentState.classes.every(room=>room.studentCode===undefined && room.teacherCode===undefined));
  assert.ok(studentState.members.every(member=>member.userId==='student'));
  assert.equal((await f.call(`classes/${one.id}/settings`,'teacher',{billingTeacherId:'co',releaseMode:'ai_immediate'})).value.code,'BILLING_CONSENT_REQUIRED');
  const changed=await f.ok(`classes/${one.id}/settings`,'co',{billingTeacherId:'co',releaseMode:'ai_immediate'});
  assert.equal(changed.classroom.billingTeacherId,'co');
  assert.equal((await f.call(`classes/${one.id}/settings`,'student',{billingTeacherId:'student',releaseMode:'ai_immediate'})).status,403);
});

test('multi-file assignment submission links student identity, proxy author and designated teacher usage; foreign students are denied',async t=>{
  const f=fixture(t); const {room,paper,work}=await f.base();
  await f.register('co','teacher',true); await f.ok('classes/join','co',{code:room.teacherCode});
  const student=await f.submit('student',work.id,{studentCode:'forged-code'},[{role:'answer',order:1,name:'two.pdf'},{role:'answer',order:0,name:'one.pdf'}]);
  assert.equal(student.studentId,'student'); assert.equal(student.studentName,'등록 student'); assert.equal(student.submittedBy,'student'); assert.equal(student.billingUserId,'teacher');
  assert.deepEqual(student.files.map(file=>file.name),['one.pdf','two.pdf']); assert.equal(student.exam.id,paper.id);
  const proxy=await f.submit('co',work.id,{studentId:'student'});
  assert.equal(proxy.studentId,'student'); assert.equal(proxy.submittedBy,'co'); assert.equal(proxy.billingUserId,'teacher');
  for(const [actor,extra] of [['co',{studentId:'outsider'}],['outsider',{}],['student',{studentId:'outsider'}]]) {
    assert.equal((await f.call('submissions',actor,f.form({assignmentId:work.id,clientRequestId:`bad-${actor}`, ...extra},[{role:'answer'}]))).status,403);
  }
  assert.equal((await f.call(`submissions/${student.id}`,'outsider')).status,403);
  assert.equal((await f.call(`files/${student.files[0].id}`,'outsider')).status,403);
  assert.equal((await f.call(`files/${student.files[0].id}`,'co')).status,200);
  assert.equal((await f.call('state','co')).value.submissions.length,2);
  const request=f.form({assignmentId:work.id,clientRequestId:'repeated'},[{role:'answer'}]);
  const first=await f.ok('submissions','student',request,201),again=await f.ok('submissions','student',request);
  assert.equal(first.submission.id,again.submission.id);
  assert.equal((await f.call('state','outsider')).value.submissions.length,0);
});

test('problem files are assigned once, solution/rubric files remain private, malformed MIME and metadata never store bytes',async t=>{
  const f=fixture(t); const {room}=await f.base();
  const paper=await f.exam('teacher',room.id,{items:[]},[{role:'problem',name:'problem.pdf'},{role:'solution',name:'solution.pdf'},{role:'rubric',name:'rubric.pdf'}]);
  await f.assignment(room.id,paper.id);
  const state=await f.ok('state','student');
  const seen=state.assignments.find(a=>a.exam.id===paper.id);
  assert.deepEqual(seen.exam.files.map(file=>file.role),['problem']);
  for(const file of paper.files) assert.equal((await f.call(`files/${file.id}`,'student')).status,file.role==='problem'?200:403);
  for(const type of ['constructor','__proto__','application/pdf']) {
    const count=f.objects.size;
    assert.equal((await f.call('exams','teacher',f.form({title:'bad',sourceLabel:'own',items:[]},[{role:'problem',type,bytes:'invalid'}]))).status,400);
    assert.equal(f.objects.size,count);
  }
  const duplicateOrder=f.form({title:'bad',sourceLabel:'own',items:[]},[{role:'problem',order:0},{role:'problem',order:0}]);
  assert.equal((await f.call('exams','teacher',duplicateOrder)).status,400);
});

test('personal file-only and mixed submissions need no pre-registered rubric; analysis bundle retains originals and question',async t=>{
  const f=fixture(t); await f.register('personal','personal',true); await f.register('other','personal',true);
  const body={title:'개인 시험',sourceLabel:'소지한 문제',question:'이 줄이 맞나요?',clientRequestId:'direct'};
  const submission=await f.submit('personal',undefined,body,[{role:'problem',name:'question.pdf'},{role:'answer',name:'answer.pdf'}]);
  assert.equal(submission.exam.items.length,0); assert.equal(submission.exam.files.length,1);
  assert.equal(submission.exam.files[0].role,'problem'); assert.equal(submission.billingUserId,'personal');
  const saved=(await f.ok('state','personal')).exams.find(exam=>exam.id===submission.exam.id);
  assert.equal(saved.files[0].id,submission.exam.files[0].id);
  const bundle=prepareAnalysisInput(submission);
  assert.equal(bundle.studentQuestion,body.question); assert.equal(bundle.examId,saved.id);
  assert.ok(bundle.problemFiles.some(file=>file.id===saved.files[0].id)); assert.equal(bundle.answerFiles.length,1);
  assert.ok(bundle.stages.includes('solve_independently')); assert.ok(bundle.generalCriteria.length);
  assert.equal((await f.call(`files/${saved.files[0].id}`,'other')).status,403);
  const mixed=await f.submit('personal',undefined,{...body,clientRequestId:'mixed'},[{role:'mixed'}]);
  assert.equal(mixed.exam.files[0].id,mixed.files[0].id);
  assert.equal((await f.call(`submissions/${mixed.id}/review`,'personal',{revision:1,publish:true,result:result()})).status,403);
  const failure=await f.call(`submissions/${submission.id}/analyze`,'personal',{revision:1});
  assert.equal(failure.status,503); assert.equal(failure.value.code,'AI_NOT_CONFIGURED');
  assert.equal((await f.ok('state','personal')).entitlement.used,0);
  assert.equal((await f.call(`submissions/${submission.id}/result`,'personal',{result:result()})).status,404);
});

test('drafts stay private, published results survive later drafts, and revisions preserve teacher history',async t=>{
  const f=fixture(t); const {work}=await f.base(); const submission=await f.submit('student',work.id);
  const endpoint=`submissions/${submission.id}`;
  assert.equal((await f.call(`${endpoint}/review`,'student',{revision:1,result:result(),publish:true})).status,403);
  const draft=await f.ok(`${endpoint}/review`,'teacher',{revision:1,result:result(),publish:false});
  assert.equal(draft.version.version,1);
  let student=await f.ok(endpoint,'student'); assert.equal(student.submission.latestVersion,null); assert.equal(student.versions.length,0);
  assert.equal((await f.call(`${endpoint}/report`,'student')).status,409);
  assert.equal((await f.call(`${endpoint}/review`,'teacher',{revision:1,result:result(),publish:true})).value.code,'REVISION_CONFLICT');
  const published=await f.ok(`${endpoint}/review`,'teacher',{revision:2,result:result(undefined,'확정 총평'),publish:true});
  assert.equal(published.version.version,2); assert.equal(published.version.result.total,28); assert.equal(published.version.result.maximum,30);
  assert.equal(published.version.teacherReviewed,true);
  await f.ok(`${endpoint}/review`,'teacher',{revision:3,result:result(undefined,'아직 공개하지 않은 수정'),publish:false});
  student=await f.ok(endpoint,'student'); assert.equal(student.submission.latestVersion.version,2); assert.equal(student.submission.latestVersion.result.summary,'확정 총평'); assert.equal(student.versions.length,1);
  const teacher=await f.ok(endpoint,'teacher'); assert.equal(teacher.versions.length,3); assert.equal(teacher.versions[2].version,1);
  assert.equal((await f.ok(`${endpoint}/report`,'student')).submission.latestVersion.version,2);
  assert.equal((await f.ok(`${endpoint}/report`,'teacher')).submission.latestVersion.version,3);
  assert.equal((await f.call(`${endpoint}/review`,'teacher',{revision:4,publish:true,result:{...result(),questionResponse:''}})).status,400);
});

test('AI completion is atomic, charges teacher not student, and supports immediate visibility then teacher revisions',async t=>{
  const f=fixture(t); const {work}=await f.base('ai_immediate'); const submission=await f.submit('student',work.id);
  const completed=await ingestAnalysisResult(f.db,submission.id,1,result());
  assert.equal(completed.latestVersion.authorType,'ai'); assert.equal(completed.latestVersion.teacherReviewed,false); assert.equal(completed.visibility,'visible'); assert.equal(completed.reviewStatus,'unreviewed');
  const student=await f.ok(`submissions/${submission.id}`,'student'); assert.equal(student.versions[0].authorType,'ai');
  assert.equal(f.sqlite.prepare('SELECT used FROM product_entitlements WHERE user_id = ?').get('teacher').used,1);
  assert.equal(f.sqlite.prepare('SELECT user_id FROM product_usage WHERE submission_id = ?').get(submission.id).user_id,'teacher');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM product_entitlements WHERE user_id = ?').get('student').count,0);
  await assert.rejects(()=>ingestAnalysisResult(f.db,submission.id,2,result()),error=>error.code==='ANALYSIS_ALREADY_COMPLETED');
  await f.ok(`submissions/${submission.id}/review`,'teacher',{revision:2,publish:true,result:result(undefined,'선생님 추가 첨삭')});
  const detail=await f.ok(`submissions/${submission.id}`,'student');
  assert.equal(detail.versions.length,2); assert.equal(detail.versions[1].authorType,'ai'); assert.equal(detail.submission.latestVersion.authorType,'teacher'); assert.equal(detail.submission.reviewStatus,'reviewed');
});

test('review-first AI results remain hidden; exhausted usage and ledger failures leave no partial result',async t=>{
  const f=fixture(t); const {work}=await f.base(); const first=await f.submit('student',work.id);
  await ingestAnalysisResult(f.db,first.id,1,result());
  assert.equal((await f.ok(`submissions/${first.id}`,'student')).submission.latestVersion,null);
  assert.equal((await f.ok(`submissions/${first.id}`,'teacher')).versions[0].authorType,'ai');
  const second=await f.submit('student',work.id);
  f.sqlite.prepare('UPDATE product_entitlements SET analysis_limit=used WHERE user_id=?').run('teacher');
  await assert.rejects(()=>ingestAnalysisResult(f.db,second.id,1,result()),error=>error.code==='USAGE_LIMIT_REACHED');
  assert.equal((await f.ok(`submissions/${second.id}`,'teacher')).versions.length,0);
  f.sqlite.prepare('UPDATE product_entitlements SET analysis_limit=20 WHERE user_id=?').run('teacher');
  f.sqlite.exec("CREATE TRIGGER reject_usage BEFORE INSERT ON product_usage BEGIN SELECT RAISE(ABORT,'usage failure'); END;");
  await assert.rejects(()=>ingestAnalysisResult(f.db,second.id,1,result()));
  assert.equal((await f.ok(`submissions/${second.id}`,'teacher')).submission.revision,1);
  assert.equal((await f.ok(`submissions/${second.id}`,'teacher')).versions.length,0);
  assert.equal(f.sqlite.prepare('SELECT used FROM product_entitlements WHERE user_id=?').get('teacher').used,1);
});

test('exam conversations are private to the target student and assigned teachers and retain the initial question separately',async t=>{
  const f=fixture(t); const {room,work}=await f.base(); await f.ok('classes/join','outsider',{code:room.studentCode}); const submission=await f.submit('student',work.id);
  const path=`submissions/${submission.id}/messages`;
  await f.ok(path,'student',{text:'1번이 왜 감점인가요?',itemId:'q1'},201);
  await f.ok(path,'teacher',{text:'정의역 설명을 추가해 주세요.',itemId:'q1'},201);
  assert.equal((await f.call(path,'outsider',{text:'몰래 보기'})).status,403);
  assert.equal((await f.call(`submissions/${submission.id}`,'outsider')).status,403);
  assert.equal((await f.call(path,'student',{text:'없는 문항',itemId:'q999'})).status,400);
  const detail=await f.ok(`submissions/${submission.id}`,'student');
  assert.equal(detail.messages.length,2); assert.equal(detail.submission.question,'왜 감점되나요?');
  assert.deepEqual(new Set(detail.messages.map(message=>message.authorRole)),new Set(['student','teacher']));
  assert.ok(detail.messages.every(message=>message.createdAt && message.authorId));
});

test('legacy text records remain authorized, readable, printable and read-only without granting product plans',async t=>{
  const f=fixture(t); await f.register('teacher','teacher'); await f.register('student','academy_student'); await f.register('outsider','academy_student');
  f.sqlite.prepare('INSERT INTO academies(id,owner_id,name,join_code,created_at) VALUES(?,?,?,?,?)').run('old-class','teacher','기존 반','OLDCODE',timestamp);
  const question={id:'old-q',ownerId:'teacher',academyId:'old-class',revision:1,title:'기존 문항',prompt:'이전 문제 원문',university:'',department:'',examKey:'',academicYear:null,sourceUrl:'',sourceLabel:'자체 작성',notes:'비공개',criteria:[{id:'c1',title:'근거',max:10,description:'기준'}],references:[],createdAt:timestamp};
  f.sqlite.prepare('INSERT INTO questions(id,owner_id,academy_id,data,revision,created_at) VALUES(?,?,?,?,?,?)').run(question.id,'teacher','old-class',JSON.stringify(question),1,timestamp);
  const review={scores:[8],evidence:['기존 근거'],feedback:'기존 총평',reviewedAt:timestamp,reviewerId:'teacher'};
  const old={id:'old-s',studentId:'student',studentCode:'기존 학생',academyId:'old-class',assignmentId:null,mode:'academy',question,answer:'기존 손글씨 전사 내용',attachment:null,status:'approved',draft:review,final:review,revision:2,createdAt:timestamp,updatedAt:timestamp};
  f.sqlite.prepare('INSERT INTO submissions(id,student_id,academy_id,assignment_id,mode,data,revision,client_request_id,created_at) VALUES(?,?,?,NULL,?,?,?,?,?)').run(old.id,'student','old-class','academy',JSON.stringify(old),2,'old-request',timestamp);
  const state=await f.ok('state','teacher'); assert.equal(state.entitlement,null); assert.equal(state.classes.length,0);
  const detail=await f.ok('submissions/legacy:old-s','student');
  assert.equal(detail.submission.legacyAnswer,old.answer); assert.equal(detail.submission.exam.legacyPrompt,question.prompt); assert.equal(detail.submission.latestVersion.result.total,8);
  assert.equal((await f.ok('submissions/legacy:old-s/report','student')).submission.latestVersion.result.summary,'기존 총평');
  assert.equal((await f.call('submissions/legacy:old-s','outsider')).status,403);
  assert.equal((await f.call('submissions/legacy:old-s/review','teacher',{revision:2,publish:true,result:result()})).value.code,'LEGACY_READ_ONLY');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM submissions WHERE id=?').get(old.id).count,1);
});

test('concurrent completions cannot exceed quota and concurrent reviews cannot overwrite one revision',async t=>{
  const f=fixture(t); const {work}=await f.base('ai_immediate');
  const first=await f.submit('student',work.id),second=await f.submit('student',work.id);
  f.sqlite.prepare('UPDATE product_entitlements SET analysis_limit=1 WHERE user_id=?').run('teacher');
  const completions=await Promise.allSettled([ingestAnalysisResult(f.db,first.id,1,result()),ingestAnalysisResult(f.db,second.id,1,result())]);
  assert.equal(completions.filter(outcome=>outcome.status==='fulfilled').length,1);
  assert.equal(f.sqlite.prepare('SELECT used FROM product_entitlements WHERE user_id=?').get('teacher').used,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM product_usage').get().count,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM product_versions').get().count,1);
  const winner=completions.find(outcome=>outcome.status==='fulfilled').value;
  const reviews=await Promise.all([
    f.call(`submissions/${winner.id}/review`,'teacher',{revision:2,publish:true,result:result(undefined,'첫 번째 창')}),
    f.call(`submissions/${winner.id}/review`,'teacher',{revision:2,publish:true,result:result(undefined,'두 번째 창')}),
  ]);
  assert.deepEqual(reviews.map(response=>response.status).sort(),[200,409]);
  const detail=await f.ok(`submissions/${winner.id}`,'teacher');
  assert.equal(detail.versions.length,2); assert.equal(detail.submission.revision,3);
  assert.equal(detail.versions[1].authorType,'ai');
});

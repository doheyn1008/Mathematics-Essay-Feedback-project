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
        for (const entry of statements) results.push(/^\s*(SELECT|WITH)\b/i.test(entry.sql) ? await entry.all() : await entry.run());
        sqlite.exec('COMMIT'); return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    });
    queue = result.catch(() => {}); return result;
  } };
  for (const key of Object.keys(runtime)) delete runtime[key];
  runtime.DB = db;
  runtime.PRODUCT_HOST_LOGIN = "true";
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
    if (options.email) headers.set('oai-authenticated-user-email', options.email);
    if (options.noOrigin) headers.delete('origin');
    if (options.cookie) headers.set('cookie',options.cookie);
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


test('native credentials create fixed-role accounts, rotate and revoke sessions, and never trust host mock headers by default',async t=>{
  const f=fixture(t);delete runtime.PRODUCT_HOST_LOGIN;
  assert.equal((await f.call('state','forged-host')).value.user,null);
  const signup=await f.call('auth/signup',null,{username:'tester_1',password:'correct horse battery',displayName:'김학생',accountType:'academy_student'});
  assert.equal(signup.status,200);const cookie=signup.headers.get('set-cookie').split(';')[0];
  assert.match(signup.headers.get('set-cookie'),/HttpOnly/);assert.match(signup.headers.get('set-cookie'),/Secure/);
  const state=(await f.call('state',null,undefined,{cookie})).value;
  assert.equal(state.profile.accountType,'academy_student');assert.equal(state.profile.displayName,'김학생');assert.equal(state.entitlement,null);
  assert.equal(f.sqlite.prepare('SELECT password_hash FROM product_credentials').get().password_hash.includes('correct horse'),false);
  assert.equal((await f.call('auth/login',null,{username:'tester_1',password:'wrong password'})).status,401);
  assert.equal((await f.call('auth/signup',null,{username:'tester_1',password:'another valid password',displayName:'다른이름',accountType:'teacher'})).status,409);
  const login=await f.call('auth/login',null,{username:'TESTER_1',password:'correct horse battery'}, {cookie});
  assert.equal(login.status,200);assert.equal((await f.call('state',null,undefined,{cookie})).value.user,null);
  const nextCookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.call('account',null,{accountType:'teacher',displayName:'권한변경'}, {cookie:nextCookie})).value.code,'ACCOUNT_TYPE_LOCKED');
  assert.equal((await f.call('auth/logout',null,{}, {cookie:nextCookie,origin:'https://evil.test'})).status,403);
  assert.equal((await f.call('auth/logout',null,{}, {cookie:nextCookie})).status,200);
  assert.equal((await f.call('state',null,undefined,{cookie:nextCookie})).value.user,null);
  assert.equal((await f.call('auth/google',null)).value.code,'OAUTH_NOT_CONFIGURED');
  assert.equal((await f.call('auth/kakao',null)).value.code,'OAUTH_NOT_CONFIGURED');
});

test('credential guessing has a bounded server-side attempt window',async t=>{
  const f=fixture(t);delete runtime.PRODUCT_HOST_LOGIN;
  for(let i=0;i<12;i++)assert.equal((await f.call('auth/login',null,{username:'missing_user',password:'incorrect password'})).status,401);
  assert.equal((await f.call('auth/login',null,{username:'missing_user',password:'incorrect password'})).status,429);
});

test('private exam sources are optional, flat items retain IDs, and creation retries reuse one exam and files',async t=>{
  const f=fixture(t);await f.register('teacher','teacher',true);
  const payload={title:'비공개 시험',createRequestId:'exam-retry',items:[{id:'q1-1',label:'1-1',maxScore:10,criteria:'비공개 기준'},{id:'q1-2',label:'1-2',maxScore:20,criteria:''}]};
  const saved=(await f.ok('exams','teacher',f.form(payload,[{role:'problem'}]),201)).exam;
  assert.equal(saved.sourceLabel,'');assert.equal(saved.items[0].id,'q1-1');assert.equal(saved.items[0].parentId,undefined);
  const retry=await f.ok('exams','teacher',f.form(payload,[{role:'problem'}]));
  assert.equal(retry.exam.id,saved.id);assert.equal(f.objects.size,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_exams').get().n,1);
  assert.equal((await f.call('contributions','teacher',{examId:saved.id,revision:1,contributorName:'선생님',rightsBasis:'own',rightsConfirmed:true,premiumConfirmed:true})).status,400);
  const contributed=(await f.ok('contributions','teacher',{examId:saved.id,revision:1,sourceLabel:'내 창작물',contributorName:'선생님',rightsBasis:'own',rightsConfirmed:true,premiumConfirmed:true},201)).contribution;
  assert.equal(contributed.exam.sourceLabel,'내 창작물');assert.equal(contributed.exam.items[0].criteria,'');
  assert.equal((await f.ok('state','teacher')).exams[0].items[0].criteria,'비공개 기준');
});

function linkAndOptIn(f,userId,preferences={google:true,kakao:true,submissions:true,feedback:true}){
  f.sqlite.prepare("INSERT INTO product_users (id,name,email,created_at) VALUES (?,?,?,?)").run(userId,userId,`${userId}@example.test`,timestamp);
  for(const provider of ['google','kakao'])f.sqlite.prepare('INSERT INTO product_links (provider,subject,user_id,email) VALUES (?,?,?,?)').run(provider,userId,userId,`${userId}@example.test`);
  f.sqlite.prepare('INSERT INTO product_notification_settings (user_id,data,updated_at) VALUES (?,?,?)').run(userId,JSON.stringify(preferences),timestamp);
}
test('notification consent is separate, submission notices target class teachers, and only published versions queue student notices',async t=>{
  const f=fixture(t);const {work}=await f.base();linkAndOptIn(f,'teacher');linkAndOptIn(f,'student');
  const submitted=await f.submit('student',work.id);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM product_notifications WHERE user_id='teacher' AND kind='submission'").get().n,2);
  await f.ok(`submissions/${submitted.id}/review`,'teacher',{revision:1,publish:false,result:result()});
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM product_notifications WHERE user_id='student'").get().n,0);
  await f.ok(`submissions/${submitted.id}/review`,'teacher',{revision:2,publish:true,result:result()});
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM product_notifications WHERE user_id='student'").get().n,2);
  const settings=await f.ok('account/settings','student');assert.equal(settings.deliveryConfigured,false);assert.ok(settings.notifications.every(n=>n.status==='awaiting_provider'));
  await f.ok('account/settings','student',{google:false,kakao:false,submissions:false,feedback:false});
  await f.ok(`submissions/${submitted.id}/review`,'teacher',{revision:3,publish:true,result:result()});
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM product_notifications WHERE user_id='student'").get().n,2);
  assert.equal((await f.call('account/points/purchase','student',{amount:100000})).value.code,'PAYMENT_NOT_CONFIGURED');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_point_events').get().n,0);
});

test('immediate AI publishes notices; review-first AI and unlinked accounts do not',async t=>{
  const f=fixture(t);const {work}=await f.base('ai_immediate');linkAndOptIn(f,'student');
  const first=await f.submit('student',work.id);await ingestAnalysisResult(f.db,first.id,1,result());
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM product_notifications WHERE kind='feedback'").get().n,2);
  const other=await f.submit('student',work.id);const row=f.sqlite.prepare('SELECT data FROM product_submissions WHERE id=?').get(other.id);const data=JSON.parse(row.data);data.releaseMode='teacher_review';f.sqlite.prepare('UPDATE product_submissions SET data=? WHERE id=?').run(JSON.stringify(data),other.id);
  await ingestAnalysisResult(f.db,other.id,1,result());
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM product_notifications WHERE kind='feedback'").get().n,2);
});

test('contribution use rewards require a first successful AI completion per learner, never imports or repeated submissions',async t=>{
  const f=fixture(t);await f.register('teacher','teacher',true);await f.register('personal','personal',true);f.grant('personal','personal_premium');
  runtime.CONTRIBUTION_USE_POINTS='1';runtime.CONTRIBUTION_USE_POLICY_VERSION='pilot-v1';
  const exam=await f.exam();const shared=(await f.ok('contributions','teacher',{examId:exam.id,revision:1,contributorName:'선생님',rightsBasis:'own',rightsConfirmed:true,premiumConfirmed:true},201)).contribution;
  const imported=(await f.ok(`premium/${shared.id}/import`,'personal',{},201)).exam;
  await f.ok(`premium/${shared.id}/import`,'personal',{},201);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_point_events').get().n,0);
  const first=await f.submit('personal',undefined,{examId:imported.id});await ingestAnalysisResult(f.db,first.id,1,result());
  const second=await f.submit('personal',undefined,{examId:imported.id});await ingestAnalysisResult(f.db,second.id,1,result());
  const points=(await f.ok('account/settings','teacher')).points;
  assert.equal(points.length,1);assert.equal(points[0].amount,1);assert.equal(points[0].kind,'usage_reward');
  assert.equal((await f.ok('account/settings','personal')).points.length,0);
});


test('configured Google OAuth binds state to the browser, uses PKCE, and never auto-links by email',async t=>{
  const f=fixture(t);delete runtime.PRODUCT_HOST_LOGIN;runtime.GOOGLE_CLIENT_ID='test-client';runtime.GOOGLE_CLIENT_SECRET='test-secret';
  f.sqlite.prepare("INSERT INTO product_users (id,name,email,created_at) VALUES ('other','기존회원','same@example.test',?)").run(timestamp);
  const start=await f.call('auth/google',null);assert.equal(start.status,303);
  const destination=new URL(start.headers.get('location'));assert.equal(destination.origin,'https://accounts.google.com');assert.equal(destination.searchParams.get('code_challenge_method'),'S256');assert.equal(destination.searchParams.get('scope'),'openid email profile');
  const state=destination.searchParams.get('state'),cookie=start.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.call(`auth/google/callback?code=test-code&state=${state}`,null,undefined,{cookie:'mg_oauth=invalid'})).status,400);
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});let calls=0;
  globalThis.fetch=async(url,options)=>{calls++;if(String(url).endsWith('/token')){const params=new URLSearchParams(options.body);assert.equal(params.get('client_secret'),'test-secret');assert.ok(params.get('code_verifier'));return Response.json({access_token:'test-access'});}assert.equal(String(url),'https://openidconnect.googleapis.com/v1/userinfo');return Response.json({sub:'google-subject',email:'same@example.test',email_verified:true,name:'새 회원'});};
  const callback=await f.call(`auth/google/callback?code=test-code&state=${state}`,null,undefined,{cookie});assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),'/');assert.equal(calls,2);
  const linked=f.sqlite.prepare('SELECT user_id FROM product_links').get();assert.notEqual(linked.user_id,'other');
  assert.equal((await f.call(`auth/google/callback?code=test-code&state=${state}`,null,undefined,{cookie})).status,400);assert.equal(calls,2);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_notification_settings').get().n,0);
});

test('Kakao OAuth links only the current signed-in account without changing notification consent',async t=>{
  const f=fixture(t);runtime.KAKAO_CLIENT_ID='test-client';runtime.KAKAO_CLIENT_SECRET='test-secret';
  assert.equal((await f.call('auth/kakao?link=1',null)).status,401);
  await f.register('teacher','teacher');f.sqlite.prepare("INSERT INTO product_users (id,name,email,created_at) VALUES ('teacher','선생님','',?)").run(timestamp);
  const start=await f.call('auth/kakao?link=1','teacher');assert.equal(start.status,303);const state=new URL(start.headers.get('location')).searchParams.get('state'),cookie=start.headers.get('set-cookie').split(';')[0];
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});globalThis.fetch=async url=>Response.json(String(url).includes('/oauth/token')?{access_token:'test-access'}:{id:12345,kakao_account:{email:'teacher@example.test',is_email_verified:true},properties:{nickname:'선생님'}});
  const done=await f.call(`auth/kakao/callback?code=test-code&state=${state}`,'teacher',undefined,{cookie});assert.equal(done.status,303);assert.equal(done.headers.get('location'),'/account');
  const settings=await f.ok('account/settings','teacher');assert.equal(settings.links[0].provider,'kakao');assert.equal(settings.preferences.kakao,false);assert.equal(settings.preferences.submissions,false);
});


function smsProvider(t) {
  runtime.TWILIO_ACCOUNT_SID='AC'+ 'a'.repeat(32);runtime.TWILIO_AUTH_TOKEN='test-secret';runtime.TWILIO_VERIFY_SERVICE_SID='VA'+'b'.repeat(32);runtime.PHONE_IDENTITY_SECRET='test-only-private-phone-key-32-characters';
  const old=globalThis.fetch;t.after(()=>{globalThis.fetch=old;});const calls=[],verifications=new Map();let count=0;
  globalThis.fetch=async(url,options)=>{
    const params=new URLSearchParams(options.body);calls.push({url:String(url),params});
    if(String(url).endsWith('/Verifications')){const sid='VE'+(++count).toString(16).padStart(32,'0');verifications.set(sid,params.get('To'));return Response.json({sid,to:params.get('To'),status:'pending',service_sid:runtime.TWILIO_VERIFY_SERVICE_SID});}
    const sid=params.get('VerificationSid');return Response.json({sid,to:verifications.get(sid),status:params.get('Code')==='123456'?'approved':'pending'});
  };
  return {calls,verifications};
}
async function phoneStart(f,user,phone='010-1234-5678') {return f.ok('account/phone/start',user,{phone,consent:true});}
async function phoneVerify(f,user,challengeId,code='123456') {return f.call('account/phone/verify',user,{challengeId,code});}
function trialGrant(f,user){f.sqlite.prepare('INSERT INTO product_phone_trials (user_id,phone_hash,phone_masked,verified_at) VALUES (?,?,?,?)').run(user,`test-hash-${user}`,'010-****-5678',timestamp);}
async function trialSubmission(f,user,key){return (await f.ok('submissions',user,f.form({usePhoneTrial:true,title:'무료 첨삭 시험',question:'풀이가 타당한가요?',clientRequestId:key},[{role:'problem'},{role:'answer'}]),201)).submission;}

test('phone trial stays unverified without an SMS provider and cannot be granted by a browser flag',async t=>{
  const f=fixture(t);await f.register('teacher','teacher');
  const settings=await f.ok('account/settings','teacher');assert.equal(settings.phoneTrial.configured,false);assert.equal(settings.phoneTrial.remaining,0);
  assert.equal((await f.call('account/phone/start','teacher',{phone:'01012345678',consent:true})).value.code,'PHONE_NOT_CONFIGURED');
  assert.equal((await f.call('account/phone/verify','teacher',{verified:true,phone:'01012345678',code:'123456'})).value.code,'PHONE_NOT_CONFIGURED');
  assert.equal((await f.call('submissions','teacher',f.form({usePhoneTrial:true,title:'시험',clientRequestId:'no-verify'},[{role:'problem'},{role:'answer'}]))).value.code,'PHONE_VERIFICATION_REQUIRED');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_phone_trials').get().n,0);
});

test('verified phone grants one free analysis to every fixed account type without granting a paid plan',async t=>{
  const f=fixture(t);const provider=smsProvider(t);let number=10;
  for(const role of ['teacher','academy_student','personal']) {
    await f.register(role,role);const phone=`010123456${number++}`;const start=await phoneStart(f,role,phone);
    assert.ok(start.challengeId);const verified=await phoneVerify(f,role,start.challengeId);assert.equal(verified.status,200);assert.equal(verified.value.trial.remaining,1);
    const again=await phoneVerify(f,role,start.challengeId);assert.equal(again.status,200);assert.equal(again.value.trial.remaining,1);
    const state=await f.ok('state',role);assert.equal(state.profile.accountType,role);assert.equal(state.entitlement,null);assert.equal(state.phoneTrial.remaining,1);
    const sub=await trialSubmission(f,role,`trial-${role}`);assert.equal(sub.funding,'phone_trial');assert.equal(sub.classId,null);assert.equal(sub.billingUserId,role);
    const ai=await f.call(`submissions/${sub.id}/analyze`,role,{revision:1});assert.equal(ai.value.code,'AI_NOT_CONFIGURED');assert.equal((await f.ok('state',role)).phoneTrial.remaining,1);
    await ingestAnalysisResult(f.db,sub.id,1,result());assert.equal((await f.ok('state',role)).phoneTrial.remaining,0);
    const replay=await phoneVerify(f,role,start.challengeId);assert.equal(replay.value.trial.remaining,0);
    assert.equal((await f.ok(`submissions/${sub.id}`,role)).submission.latestVersion.published,true);
  }
  assert.equal(provider.calls.filter(c=>c.url.endsWith('/Verifications')).length,3);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_entitlements').get().n,0);
});

test('phone normalization and unique grants prevent repeat claims across accounts, concurrent checks, or phone changes',async t=>{
  const f=fixture(t);smsProvider(t);await f.register('one','teacher');await f.register('two','personal');
  const first=await phoneStart(f,'one','010-1234-5678'),second=await phoneStart(f,'two','+82 10 1234 5678');
  const checked=await Promise.all([phoneVerify(f,'one',first.challengeId),phoneVerify(f,'two',second.challengeId)]);
  assert.deepEqual(checked.map(c=>c.status).sort(),[200,409]);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_phone_trials').get().n,1);
  const owner=checked[0].status===200?'one':'two';
  const changed=await phoneStart(f,owner,'010-9876-5432');assert.equal(changed.alreadyVerified,true);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_phone_trials').get().n,1);
  const privateRows=JSON.stringify(f.sqlite.prepare('SELECT * FROM product_phone_challenges').all());assert.equal(privateRows.includes('+821012345678'),false);assert.equal(privateRows.includes('123456"'),false);
});

test('SMS consent, server cooldown, challenge ownership, expiration and attempt limits are enforced',async t=>{
  const f=fixture(t);const provider=smsProvider(t);await f.register('one','teacher');await f.register('two','personal');
  assert.equal((await f.call('account/phone/start','one',{phone:'01012345678',consent:false})).status,400);
  const sends=await Promise.all([f.call('account/phone/start','one',{phone:'01012345678',consent:true}),f.call('account/phone/start','one',{phone:'01012345678',consent:true})]);assert.deepEqual(sends.map(s=>s.status).sort(),[200,429]);
  assert.equal(provider.calls.length,1);const id=sends.find(s=>s.status===200).value.challengeId;
  assert.equal((await phoneVerify(f,'two',id)).status,400);assert.equal(provider.calls.length,1);
  for(let i=0;i<5;i++)assert.equal((await phoneVerify(f,'one',id,'111111')).value.code,'PHONE_CODE_INVALID');
  assert.equal((await phoneVerify(f,'one',id)).value.code,'PHONE_CHALLENGE_EXPIRED');assert.equal(provider.calls.length,6);
  const another=await phoneStart(f,'two','01087654321');f.sqlite.prepare('UPDATE product_phone_challenges SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',another.challengeId);
  assert.equal((await phoneVerify(f,'two',another.challengeId)).value.code,'PHONE_CHALLENGE_EXPIRED');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_phone_trials').get().n,0);
});

test('free trial results and the single credit commit atomically, including simultaneous submissions',async t=>{
  const f=fixture(t);await f.register('teacher','teacher');trialGrant(f,'teacher');
  const first=await trialSubmission(f,'teacher','first-free'),second=await trialSubmission(f,'teacher','second-free');
  await assert.rejects(()=>ingestAnalysisResult(f.db,first.id,1,{items:[]}));assert.equal((await f.ok('state','teacher')).phoneTrial.remaining,1);
  f.sqlite.exec("CREATE TRIGGER reject_free_usage BEFORE INSERT ON product_usage BEGIN SELECT RAISE(ABORT,'usage failure'); END;");
  await assert.rejects(()=>ingestAnalysisResult(f.db,first.id,1,result()));assert.equal((await f.ok('state','teacher')).phoneTrial.remaining,1);assert.equal((await f.ok(`submissions/${first.id}`,'teacher')).versions.length,0);
  f.sqlite.exec('DROP TRIGGER reject_free_usage');
  const outcomes=await Promise.allSettled([ingestAnalysisResult(f.db,first.id,1,result()),ingestAnalysisResult(f.db,second.id,1,result())]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_versions').get().n,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM product_usage').get().n,1);
  assert.equal((await f.ok('state','teacher')).phoneTrial.remaining,0);
  assert.equal((await f.call('submissions','teacher',f.form({usePhoneTrial:true,title:'다시',clientRequestId:'third-free'},[{role:'problem'},{role:'answer'}]))).value.code,'FREE_TRIAL_USED');
});

test('free trial cannot access premium materials, class proxy submissions or change paid quotas',async t=>{
  const f=fixture(t);const {work}=await f.base();trialGrant(f,'teacher');
  assert.equal((await f.call('submissions','teacher',f.form({usePhoneTrial:true,assignmentId:work.id,studentId:'student',clientRequestId:'proxy-free'},[{role:'answer'}]))).status,400);
  assert.equal((await f.call('submissions','teacher',f.form({usePhoneTrial:true,examId:work.exam.id,clientRequestId:'premium-free'},[{role:'answer'}]))).status,400);
  const sub=await trialSubmission(f,'teacher','paid-owner-free');await ingestAnalysisResult(f.db,sub.id,1,result());
  assert.equal((await f.ok('state','teacher')).entitlement.used,0);assert.equal((await f.ok('state','teacher')).phoneTrial.remaining,0);
  assert.equal((await f.call(`submissions/${sub.id}`,'outsider')).status,403);
});

test('the administrator uses the Sites owner identity and cannot be reached through a customer session', async t => {
  const f = fixture(t);
  const directoryPath = '/api/admin/customers';
  const owner = { email: 'owner@example.test' };
  assert.equal((await f.call(directoryPath, 'owner', undefined, owner)).status, 403);
  runtime.ADMIN_OWNER_EMAIL = 'owner@example.test';
  runtime.ADMIN_SITE_ORIGIN = 'https://example.test';
  assert.equal((await f.call(directoryPath, null, undefined, owner)).status, 401);
  assert.equal((await f.call(directoryPath, 'teacher', undefined, { email: 'teacher@example.test' })).status, 403);
  const customerSession = await f.call('auth/signup', null, { username: 'admin_route_check', password: 'unique-password-example', displayName: '일반 고객', accountType: 'personal' });
  assert.equal(customerSession.status, 200);
  const cookie = customerSession.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  assert.equal((await f.call(directoryPath, null, undefined, { cookie })).status, 401);
  runtime.ADMIN_SITE_ORIGIN = 'https://other-website.test';
  assert.equal((await f.call(directoryPath, 'owner', undefined, owner)).status, 403);
  runtime.ADMIN_SITE_ORIGIN = 'https://example.test';
  f.sqlite.prepare('INSERT INTO product_users (id,name,created_at) VALUES (?,?,?)').run('pending-profile', '가입 유형 선택 대기', timestamp);
  const managed = await f.base();
  const submission = await f.submit('student', managed.work.id);
  assert.equal((await f.call('/api/admin/dashboard', 'owner', undefined, owner)).status, 404);
  const directory = await f.call('/api/admin/customers?query=student&role=academy_student', 'owner', undefined, owner);
  assert.equal(directory.status, 200);
  assert.deepEqual(directory.value.items.map(item => item.id), ['student']);
  const signedUp = await f.call('/api/admin/customers?query='+encodeURIComponent('가입 유형'), 'owner', undefined, owner);
  assert.equal(signedUp.value.total, 1);
  assert.equal(signedUp.value.items[0].role, null);
  const path = '/api/admin/customers/student';
  const details = await f.call(path, 'owner', undefined, owner);
  assert.equal(details.status, 200);
  assert.equal(details.value.customer.role, 'academy_student');
  assert.deepEqual(Object.keys(details.value), ['customer']);
  for (const key of ['note', 'points', 'status', 'recentSubmissions']) {
    assert.equal(Object.hasOwn(details.value.customer, key), false);
  }
  assert.equal((await f.ok(`submissions/${submission.id}`, 'student')).submission.id, submission.id);
  for (const word of ['왜 감점되나요?', '/api/product/files/', 'passwordHash', 'phoneHash']) {
    assert.equal(JSON.stringify(details.value).includes(word), false);
  }
  const update = { role: 'teacher', revision: details.value.customer.revision };
  assert.equal((await f.call(path, 'owner', update, { ...owner, noOrigin: true })).status, 403);
  assert.equal((await f.call(path, 'owner', update, { ...owner, origin: 'https://other.test' })).status, 403);
  assert.equal((await f.call('state', 'student')).value.profile.accountType, 'academy_student');
  assert.equal((await f.call('state', 'student')).value.entitlement, null);
});

test('only the owner can assign a member type, and assignments change customer permissions without granting a plan', async t => {
  const f = fixture(t);
  const owner = { email: 'owner@example.test' };
  runtime.ADMIN_OWNER_EMAIL = owner.email;
  runtime.ADMIN_SITE_ORIGIN = 'https://example.test';
  await f.register('new-teacher', 'personal');
  const path = '/api/admin/customers/new-teacher';
  const change = { role: 'teacher', revision: 0 };
  f.sqlite.prepare('INSERT INTO product_admin_customers (user_id,status,note,revision,updated_at,last_event_id) VALUES (?,?,?,?,?,?)').run('new-teacher', 'follow_up', '기존 메모', 0, timestamp, 'previous-event');
  assert.equal((await f.call(path, 'new-teacher', change, { email: 'member@example.test' })).status, 403);
  assert.equal((await f.call(path, 'owner', { ...change, role: 'admin' }, owner)).status, 400);
  const saved = await f.call(path, 'owner', change, owner);
  assert.equal(saved.status, 200, JSON.stringify(saved.value));
  assert.equal(saved.value.customer.role, 'teacher');
  assert.equal(saved.value.customer.entitlement, null);
  const audit = f.sqlite.prepare('SELECT previous_role AS before, new_role AS after FROM product_admin_customer_events WHERE user_id=?').get('new-teacher');
  assert.equal(audit.before, 'personal');
  assert.equal(audit.after, 'teacher');
  assert.equal(f.sqlite.prepare('SELECT note FROM product_admin_customers WHERE user_id=?').get('new-teacher').note, '기존 메모');
  assert.equal((await f.ok('state','new-teacher')).profile.accountType, 'teacher');
  assert.equal((await f.call('account', 'new-teacher', { accountType: 'personal', displayName: '이름' })).value.code, 'ACCOUNT_TYPE_LOCKED');
  assert.equal((await f.call('classes', 'new-teacher', { name: '역할 변경 후 확인', billingTeacherId: 'new-teacher' })).status, 402);
  assert.equal((await f.call(path, 'owner', { ...change, role: 'personal' }, owner)).status, 409);

  f.sqlite.prepare('INSERT INTO product_users (id,name,created_at) VALUES (?,?,?)').run('waiting-user', '가입 대기 고객', timestamp);
  const freshPath = '/api/admin/customers/waiting-user';
  const assigned = await f.call(freshPath, 'owner', { ...change, role: 'academy_student' }, owner);
  assert.equal(assigned.status, 200, JSON.stringify(assigned.value));
  assert.equal(assigned.value.customer.name, '가입 대기 고객');
  const first = f.sqlite.prepare('SELECT previous_role AS before, new_role AS after FROM product_admin_customer_events WHERE user_id=?').get('waiting-user');
  assert.equal(first.before, null);
  assert.equal(first.after, 'academy_student');
  const peers = await f.call('/api/admin/customers?role=academy_student', 'owner', undefined, owner);
  assert.deepEqual(peers.value.items.map(item => item.id), ['waiting-user']);

  const simultaneous = await Promise.all(['personal','academy_student'].map(role => f.call(path, 'owner', { ...change, role, revision: 1 }, owner)));
  assert.deepEqual(simultaneous.map(result => result.status).sort(), [200,409]);
  const winner = simultaneous.find(result => result.status === 200).value;
  const changes = f.sqlite.prepare('SELECT previous_role AS before, new_role AS after FROM product_admin_customer_events WHERE user_id=? ORDER BY revision DESC').all('new-teacher');
  assert.equal(changes.length, 2);
  assert.equal(changes[0].before, 'teacher');
  assert.equal(changes[0].after, winner.customer.role);
});

test('member type changes preserve class access and active billing', async t => {
  const f = fixture(t);
  const owner = { email: 'owner@example.test' };
  runtime.ADMIN_OWNER_EMAIL = owner.email;
  runtime.ADMIN_SITE_ORIGIN = 'https://example.test';
  const { room, work } = await f.base();
  const submission = await f.submit('student', work.id);
  const change = { role: 'personal', revision: 0 };
  const student = await f.call('/api/admin/customers/student', 'owner', change, owner);
  assert.equal(student.status, 409, JSON.stringify(student.value));
  assert.equal(student.value.code, 'CUSTOMER_ROLE_HAS_MEMBERSHIPS');
  assert.equal((await f.ok(`submissions/${submission.id}`, 'student')).submission.id, submission.id);
  // Isolate an inconsistent older room that still names this payer without a membership row.
  f.sqlite.prepare('DELETE FROM product_members WHERE class_id = ? AND user_id = ?').run(room.id, 'teacher');
  const teacher = await f.call('/api/admin/customers/teacher', 'owner', change, owner);
  assert.equal(teacher.status, 409, JSON.stringify(teacher.value));
  assert.equal(teacher.value.code, 'CUSTOMER_ROLE_BILLING_TEACHER');

  await f.register('paid-personal', 'personal', true);
  const entitlement = await f.call('/api/admin/customers/paid-personal', 'owner', { ...change, role: 'teacher' }, owner);
  assert.equal(entitlement.status, 409, JSON.stringify(entitlement.value));
  assert.equal(entitlement.value.code, 'CUSTOMER_ROLE_ACTIVE_ENTITLEMENT');
  assert.equal((await f.ok('state', 'paid-personal')).entitlement.plan, 'personal_basic');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS total FROM product_admin_customer_events WHERE user_id IN (?,?)').get('teacher', 'paid-personal').total, 0);
});

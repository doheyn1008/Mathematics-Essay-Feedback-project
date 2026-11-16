import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/client/product-chat.ts',import.meta.url),'utf8');
const {startMessagePolling,mergeMessages}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function clock(){let id=0;const jobs=new Map();return {jobs,schedule(fn,delay){const key=++id;jobs.set(key,{fn,delay});return key;},cancel(key){jobs.delete(key);},async tick(){const [key,job]=jobs.entries().next().value;jobs.delete(key);job.fn();await flush();return job.delay;}};}
const message=(id,sequence)=>({id,sequence,submissionId:'s',text:id,createdAt:'2026-01-01',authorId:'u',authorName:'학생',authorRole:'student',itemId:null});

test('chat merges retries by message ID and insertion order, fetches all pages and leaves only one timer',async()=>{
  const timer=clock();let messages=[],calls=0;
  const poller=startMessagePolling({...timer,status:()=>{},receive:incoming=>{messages=mergeMessages(messages,incoming);},load:async cursor=>{calls++;return cursor===''?{messages:[message('one',1)],cursor:'1',hasMore:true}:{messages:[message('two',2)],cursor:'2',hasMore:false};}});
  await flush();assert.equal(calls,2);assert.deepEqual(messages.map(m=>m.id),['one','two']);assert.equal(timer.jobs.size,1);
  await timer.tick();assert.equal(messages.length,2);assert.equal(timer.jobs.size,1);poller.stop();assert.equal(timer.jobs.size,0);
});
test('chat pauses hidden pages, wakes on reconnect and aborts a pending load on navigation',async()=>{
  const timer=clock();let visible=false,calls=0,signal,complete,received=0;
  const poller=startMessagePolling({...timer,visible:()=>visible,status:()=>{},receive:()=>received++,load:(_cursor,s)=>{calls++;signal=s;return new Promise(resolve=>{complete=resolve;});}});
  await flush();assert.equal(calls,0);assert.equal(timer.jobs.size,1);
  visible=true;poller.wake();poller.wake();assert.equal(calls,1);assert.equal(timer.jobs.size,0);
  poller.stop();assert.equal(signal.aborted,true);complete({messages:[message('late',1)],cursor:'1',hasMore:false});await flush();assert.equal(received,0);assert.equal(timer.jobs.size,0);
});
test('chat retries transient failures with backoff and stops when membership authorization is revoked',async()=>{
  const timer=clock(),statuses=[];let calls=0;
  const poller=startMessagePolling({...timer,status:s=>statuses.push(s),receive:()=>{},load:async()=>{calls++;if(calls===1)throw new Error('offline');if(calls===2)return {messages:[],cursor:'0',hasMore:false};throw Object.assign(new Error('removed'),{status:403});}});
  await flush();assert.match(statuses[0],/연결 복구/);assert.equal(await timer.tick(),6000);assert.match(statuses[1],/자동 갱신/);assert.equal(await timer.tick(),3000);assert.match(statuses[2],/접근 권한/);assert.equal(timer.jobs.size,0);poller.wake();await flush();assert.equal(calls,3);poller.stop();
});

"use client";
import {useRef,useState,type FormEvent} from "react";
import {Plus,Trash2} from "lucide-react";
import type {Academy,Assignment,Criterion,Question} from "@/lib/types";
export type QuestionInput=Omit<Question,"id"|"ownerId"|"createdAt"|"revision"|"references"> & {id?:string;revision?:number};
export type SubmitInput={mode:"academy"|"personal";academyId?:string;assignmentId?:string;questionId?:string;directQuestion?:{title:string;prompt:string;sourceLabel:string;sourceUrl:string};answer:string;studentQuestion:string;studentCode?:string;clientRequestId:string};
export type ReferenceUpload={file:File;kind:"problem"|"rubric"};
const limit=15*1024*1024;
export function checkFile(file:File|null){if(file && (!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)||file.size>limit))throw new Error("JPG, PNG, WEBP, PDF 파일을 15MB 이하로 첨부해 주세요.");}
export function QuestionForm({question,academyId,busy,onSave}:{question:Question|null;academyId:string|null;busy:boolean;onSave:(input:QuestionInput,files:ReferenceUpload[])=>Promise<void>}){
 const [criteria,setCriteria]=useState<(Omit<Criterion,"max"> & {max:string})[]>((question?.criteria || [{id:crypto.randomUUID(),title:"풀이 과정",max:10,description:"정확한 논리와 계산 과정을 확인합니다."}]).map(criterion=>({...criterion,max:String(criterion.max)})));
 const [error,setError]=useState("");
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setError("");const form=new FormData(event.currentTarget);try{const numericCriteria=criteria.map(c=>({...c,max:Number(c.max)}));if(!numericCriteria.length||numericCriteria.some(c=>!c.title.trim()||!Number.isFinite(c.max)||c.max<=0||!c.description.trim()))throw new Error("모든 채점 항목에 제목, 0보다 큰 배점, 부분점수 기준을 입력해 주세요.");const files:ReferenceUpload[]=[];for(const kind of ["problem","rubric"] as const){const file=form.get(kind);if(file instanceof File&&file.size){checkFile(file);files.push({file,kind});}}const str=(name:string)=>String(form.get(name)||"").trim();await onSave({id:question?.id,revision:question?.revision,academyId:question?.academyId??academyId,title:str("title"),prompt:str("prompt"),university:str("university"),department:str("department"),examKey:str("examKey"),academicYear:str("academicYear")?Number(str("academicYear")):null,sourceUrl:str("sourceUrl"),sourceLabel:str("sourceLabel"),notes:str("notes"),criteria:numericCriteria},files);}catch(failure){setError(failure instanceof Error?failure.message:"문항을 저장하지 못했습니다.");}}
 return <form onSubmit={submit} className="form-stack"><div className="form-grid"><label className="field wide">문항 이름<input className="text-input" name="title" defaultValue={question?.title} placeholder="예: 함수의 극값과 그래프" required maxLength={160}/></label><label className="field wide">문제 · 풀이 요구사항<textarea className="text-input" name="prompt" rows={4} defaultValue={question?.prompt} placeholder="학생이 풀 문제 또는 원본 자료를 참고할 수 있는 설명" required/></label><label className="field">대학 이름<input className="text-input" name="university" defaultValue={question?.university} placeholder="자체 문항은 비워두세요"/></label><label className="field">학년도<input className="text-input" type="number" name="academicYear" min={1900} max={2200} defaultValue={question?.academicYear??""} placeholder="2027"/></label><label className="field">모집단위<input className="text-input" name="department" defaultValue={question?.department} placeholder="예: 자연계열"/></label><label className="field">시험 · 환산 기준 식별자<input className="text-input" name="examKey" defaultValue={question?.examKey} placeholder="예: 자연계열 오전 논술 전체 100점"/></label><p className="muted wide">대학 비교에는 같은 시험과 환산 기준의 전체 논술 점수를 사용하세요. 개별 문항은 전체 시험 합격선과 비교하지 않습니다.</p><label className="field">출처 명칭<input className="text-input" name="sourceLabel" defaultValue={question?.sourceLabel} placeholder="대학 입학처 · 자료명 또는 직접 출제" required/></label><label className="field">출처 링크<input className="text-input" type="url" name="sourceUrl" defaultValue={question?.sourceUrl} placeholder="https://"/></label></div><div className="card-title-row"><h3>채점기준</h3><button type="button" className="button secondary small" onClick={()=>setCriteria([...criteria,{id:crypto.randomUUID(),title:"",max:"1",description:""}])}><Plus/>항목 추가</button></div><div className="criteria-editor">{criteria.map((criterion,index)=><div className="criterion-editor-row" key={criterion.id}><label className="field">항목 {index+1}<input className="text-input" aria-label={`항목 ${index+1} 제목`} value={criterion.title} onChange={e=>setCriteria(criteria.map((c,i)=>i===index?{...c,title:e.target.value}:c))} required/></label><label className="field">배점<input className="text-input" aria-label={`항목 ${index+1} 배점`} type="number" min={0.1} step={0.1} value={criterion.max} onChange={e=>setCriteria(criteria.map((c,i)=>i===index?{...c,max:e.target.value}:c))} required/></label><button type="button" className="icon-button" aria-label={`항목 ${index+1} 삭제`} disabled={criteria.length<=1} onClick={()=>setCriteria(criteria.filter((_,i)=>i!==index))}><Trash2 size={17}/></button><label className="field description">부분점수 · 판단 기준<textarea className="text-input" rows={2} value={criterion.description} onChange={e=>setCriteria(criteria.map((c,i)=>i===index?{...c,description:e.target.value}:c))} required/></label></div>)}</div><p className="muted">총 배점 {criteria.reduce((total,c)=>total+(Number(c.max)||0),0)}점 · 기존 제출 답안은 제출 당시 기준을 유지합니다.</p><div className="form-grid"><label className="field">문제 원본 (선택)<input className="file-input" type="file" name="problem" accept="image/jpeg,image/png,image/webp,application/pdf"/></label><label className="field">학교 채점기준 원본 (선택)<input className="file-input" type="file" name="rubric" accept="image/jpeg,image/png,image/webp,application/pdf"/></label><label className="field wide">선생님 참고 메모<textarea className="text-input" name="notes" rows={2} defaultValue={question?.notes}/></label></div><p className="muted">파일별 최대 15MB. 자동 판독은 연결 전이므로 채점기준은 직접 입력해 주세요. 출처 표시는 이용 허락을 대신하지 않습니다.</p>{error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><button className="button primary" disabled={busy} type="submit">{busy?"저장 중…":"문항 · 기준 저장"}</button></div></form>
}
export function AssignmentForm({questions,initial,busy,onSave}:{questions:Question[];initial:Question|null;busy:boolean;onSave:(input:{questionId:string;title:string;dueAt?:string})=>Promise<void>}){return <form className="form-stack" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);const due=String(form.get("dueAt")||"");void onSave({questionId:String(form.get("questionId")),title:String(form.get("title")).trim(),dueAt:due?new Date(due).toISOString():undefined});}}><label className="field">문항<select name="questionId" className="text-input" defaultValue={initial?.id||questions[0]?.id} required>{questions.map(q=><option value={q.id} key={q.id}>{q.title}</option>)}</select></label><label className="field">과제 이름<input className="text-input" name="title" defaultValue={initial?.title||""} placeholder="예: 11월 3주차 논술 과제" required maxLength={160}/></label><label className="field">제출 마감 (선택)<input className="text-input" name="dueAt" type="datetime-local"/></label><p className="muted">배정 시점의 채점기준이 과제에 저장됩니다. 이후 기준을 수정해도 기존 과제에는 적용되지 않습니다.</p><div className="modal-footer"><button className="button primary" disabled={busy||!questions.length}>과제 배정</button></div></form>}
export function SubmissionForm({mode,questions,assignments,academies,disabled,onNewQuestion,onSubmit}:{
 mode:"academy"|"personal";questions:Question[];assignments:Assignment[];academies:Academy[];disabled:boolean;onNewQuestion:()=>void;
 onSubmit:(payload:SubmitInput,file:File|null,problemFile:File|null)=>Promise<void>;
}){
 const options=mode==="academy"?assignments:questions;
 const [entryMode,setEntryMode]=useState<"existing"|"direct">(options.length?"existing":"direct");
 const [selection,setSelection]=useState("");
 const selectedId=options.some(option=>option.id===selection)?selection:options[0]?.id||"";
 const question=mode==="academy"?assignments.find(a=>a.id===selectedId)?.question:questions.find(q=>q.id===selectedId);
 const [error,setError]=useState("");
 const [working,setWorking]=useState(false);
 const request=useRef({fingerprint:"",id:crypto.randomUUID()});
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setError("");
  const form=new FormData(event.currentTarget);
  try{
   const str=(name:string)=>String(form.get(name)||"").trim();
   const fileValue=(name:string)=>{const value=form.get(name);return value instanceof File&&value.size?value:null;};
   const answer=str("answer"),file=fileValue("file"),problemFile=entryMode==="direct"?fileValue("problemFile"):null;
   checkFile(file);checkFile(problemFile);
   if(!answer&&!file)throw new Error("풀이를 입력하거나 답안 파일을 첨부해 주세요.");
   if(entryMode==="existing"&&!selectedId)throw new Error("등록된 문항을 선택하거나 문제와 함께 제출해 주세요.");
   const directQuestion=entryMode==="direct"?{title:str("title"),prompt:str("prompt"),sourceLabel:str("sourceLabel"),sourceUrl:str("sourceUrl")}:undefined;
   if(directQuestion&&(!directQuestion.title||!directQuestion.sourceLabel))throw new Error("문항 이름과 출처를 입력해 주세요.");
   if(directQuestion&&!directQuestion.prompt&&!problemFile)throw new Error("문제 내용을 입력하거나 문제 원본을 첨부해 주세요.");
   const academyId=mode==="academy"&&entryMode==="direct"?str("academyId"):undefined;
   if(mode==="academy"&&entryMode==="direct"&&!academyId)throw new Error("학원에 참여한 후 제출할 학원을 선택해 주세요.");
   const fingerprint=JSON.stringify([mode,entryMode,selectedId,academyId,directQuestion,answer,str("studentQuestion"),str("studentCode"),...[file,problemFile].map(f=>f?[f.name,f.size,f.lastModified]:null)]);
   if(request.current.fingerprint!==fingerprint)request.current={fingerprint,id:crypto.randomUUID()};
   setWorking(true);
   await onSubmit({mode,academyId,assignmentId:entryMode==="existing"&&mode==="academy"?selectedId:undefined,questionId:entryMode==="existing"&&mode==="personal"?selectedId:undefined,directQuestion,answer,studentQuestion:str("studentQuestion"),studentCode:str("studentCode"),clientRequestId:request.current.id},file,problemFile);
  }catch(failure){setError(failure instanceof Error?failure.message:"답안을 제출하지 못했습니다.");}
  finally{setWorking(false);}
 }
 const blocked=disabled||working;
 return <section className="card card-padding"><form className="form-stack" onSubmit={submit}>
  <div className="card-title-row"><h2>문제와 풀이 제출하기</h2><span className="muted">텍스트 · 사진 · PDF</span></div>
  <div className="entry-mode-switch" aria-label="제출 방법">
   <button className={`button ${entryMode==="existing"?"primary":"secondary"}`} type="button" onClick={()=>{setEntryMode("existing");setError("");}}>{mode==="academy"?"배정된 과제":"등록된 문항"}</button>
   <button className={`button ${entryMode==="direct"?"primary":"secondary"}`} type="button" onClick={()=>{setEntryMode("direct");setError("");}}>문제와 함께 제출</button>
  </div>
  {entryMode==="existing"?<>
   {options.length?<><label className="field">{mode==="academy"?"배정된 과제":"문항"}<select className="text-input" value={selectedId} onChange={event=>setSelection(event.target.value)}>{options.map(option=><option key={option.id} value={option.id}>{option.title}</option>)}</select></label>
   {question&&<div className="question-box"><strong>{question.title}</strong><p style={{whiteSpace:"pre-wrap"}}>{question.prompt}</p>{question.sourceUrl?<a className="source-link" href={question.sourceUrl} target="_blank" rel="noreferrer">{question.sourceLabel||"출처"}</a>:<p className="muted">{question.sourceLabel}</p>}</div>}</>:<div className="state-callout">{mode==="academy"?"아직 배정된 과제가 없습니다.":"등록한 문항이 없습니다."} ‘문제와 함께 제출’을 선택하면 바로 올릴 수 있어요.</div>}
   {mode==="personal"&&<button className="button ghost small" type="button" disabled={blocked} onClick={onNewQuestion}><Plus/>문항 · 채점기준 별도 등록</button>}
  </>:<>
   {mode==="academy"&&<label className="field">제출할 학원<select name="academyId" className="text-input" defaultValue={academies[0]?.id||""} required><option value="" disabled>학원 선택</option>{academies.map(academy=><option key={academy.id} value={academy.id}>{academy.name}</option>)}</select>{!academies.length&&<span className="form-error">참여 코드로 학원에 먼저 연결해 주세요.</span>}</label>}
   <label className="field">문항 이름<input name="title" className="text-input" required maxLength={200} placeholder="예: 수리논술 연습 2번"/></label>
   <label className="field">문제 내용<textarea name="prompt" className="text-input" rows={4} maxLength={20000} placeholder="문제를 입력하거나 아래에 문제 사진·PDF를 첨부해 주세요."/></label>
   <label className="field">문제 원본 첨부<input className="file-input" type="file" name="problemFile" accept="image/jpeg,image/png,image/webp,application/pdf"/><span className="muted">문제와 답안은 각각 다른 파일로 올릴 수 있어요. 파일별 최대 15MB.</span></label>
   <div className="form-grid"><label className="field">문제 출처<input name="sourceLabel" className="text-input" required maxLength={500} placeholder="학교 · 자료명 · 문항 번호 또는 직접 출제"/></label><label className="field">출처 링크 (선택)<input name="sourceUrl" type="url" className="text-input" placeholder="https://"/></label></div>
   <p className="muted">학교 채점기준이 없는 직접 제출은 기준 등록 대기로 보관됩니다. 선생님이 기준을 정한 뒤 채점합니다.</p>
  </>}
  {mode==="academy"&&<label className="field">학생 코드<input name="studentCode" className="text-input" placeholder="선생님께 받은 학생 코드" required maxLength={80}/></label>}
  <label className="field">나의 풀이<textarea name="answer" className="text-input" rows={7} maxLength={50000} placeholder="계산 결과뿐 아니라 생각한 과정과 근거를 함께 적어주세요."/></label>
  <label className="field">손글씨 답안 첨부<input className="file-input" type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf"/><span className="muted">JPG, PNG, WEBP 또는 PDF · 15MB 이하</span></label>
  <label className="field">추가 질문 · 집중해서 봐주세요 (선택)<textarea name="studentQuestion" className="text-input" rows={3} maxLength={5000} placeholder="예: 이 풀이에서 왜 감점되는지, 다른 방법도 인정되는지 알려주세요."/><span className="muted">선생님이 이 질문에 대한 답변을 작성하고 첨삭 결과와 함께 전달합니다.</span></label>
  <div className="state-callout">문제·풀이·추가 질문은 비공개 제출 기록에 저장됩니다. 학원 제출은 담당 선생님이 열람하며, 공개 자료실이나 AI 학습에 자동 등록되지 않습니다.</div>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="actions"><button className="button primary" disabled={blocked||(entryMode==="existing"&&!options.length)} type="submit">{working?"제출 중…":"답안 제출"}</button><p className="muted">{mode==="academy"?"선생님이 검토하고 결과를 확정합니다.":"AI 연결 전에는 답안만 보관됩니다."}</p></div>
 </form></section>;
}

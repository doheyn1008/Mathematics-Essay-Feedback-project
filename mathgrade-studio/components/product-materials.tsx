"use client";
import { useState, type FormEvent } from "react";
import type { ExamSubmission } from "@/lib/product-types";
import { FilePicker, packFiles, type DraftFile, type ProductAction } from "./product-forms";

export function MaterialEditor({submission,action,done}:{submission:ExamSubmission;action:ProductAction;done:()=>Promise<void>}) {
  const [baseRevision]=useState(submission.revision),[requestId]=useState(()=>crypto.randomUUID());
  const [retained,setRetained]=useState(submission.files.map(f=>f.id)),[files,setFiles]=useState<DraftFile[]>([]),[question,setQuestion]=useState(submission.question);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(e:FormEvent) {e.preventDefault();if(busy)return;setBusy(true);setError("");try{
    await action(`submissions/${submission.id}/materials`,packFiles({revision:baseRevision,clientRequestId:requestId,retainedFileIds:retained,question},files));
    await done();
  }catch(e){setError(e instanceof Error?e.message:"저장하지 못했습니다.");}finally{setBusy(false);}}
  return <form className="p-form p-material-editor" onSubmit={submit}><h3>답안 자료 수정 · 다시 제출</h3><p className="p-note">기존 문제지와 모든 자료·첨삭 버전은 보존됩니다. 수정 자료의 AI 재첨삭 시점과 비용은 정책 확정 후 제공하며, 지금은 사용량을 차감하지 않습니다.</p><fieldset disabled={busy}><legend>현재 제출 자료 · v{submission.materialVersion??1}</legend>{submission.files.filter(f=>retained.includes(f.id)).map(f=><div className="p-file-row" key={f.id}><a href={f.url} target="_blank" rel="noreferrer">{f.name}</a><button type="button" className="button secondary small" onClick={()=>setRetained(retained.filter(id=>id!==f.id))}>새 버전에서 제외</button></div>)}<FilePicker files={files} onChange={setFiles} roles={["answer","mixed"]} items={submission.exam.items}/><label>수정한 추가 질문<textarea maxLength={10000} value={question} onChange={e=>setQuestion(e.target.value)}/></label></fieldset>{error&&<p className="p-error" role="alert">{error}</p>}<button className="button primary" disabled={busy}>{busy?"자료 저장 중…":"수정 자료를 새 버전으로 제출"}</button></form>;
}

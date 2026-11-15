"use client";
/* Uploaded authenticated originals use their protected URL without an image optimizer. */
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { BookOpen, CheckCheck, Clock3, Download, ExternalLink, FileText, MessageSquare, Plus, RotateCcw, Save, ShieldCheck, Trash2 } from "lucide-react";
import type { Criterion, Review, Submission } from "@/lib/types";

type EditableReview = Omit<Review, "reviewedAt" | "reviewerId">;
type ReviewAction = "draft" | "approve" | "reopen";

export function Metric({ title, count, unit, note, icon: Icon }: { title: string; count: number; unit: string; note: string; icon: typeof BookOpen }) {
  return <article className="metric"><div className="metric-label"><span>{title}</span><Icon aria-hidden="true" /></div><strong>{count}<span>{unit}</span></strong><small>{note}</small></article>;
}

export function AnswerCard({ submission }: { submission: Submission }) {
  const { question, attachment, problemAttachment } = submission;
  return <section className="card">
    <div className="card-head"><div><h2>학생 답안</h2><small>{submission.studentCode}</small></div><FileText size={17} color="#ad99bf" aria-hidden="true" /></div>
    <div className="paper-top"><div className="source-line"><span>{question.university || "자체 등록 문항"}</span>{question.academicYear && <span>{question.academicYear}학년도</span>}<span>{submission.rubricPending || !question.criteria.length ? "채점기준 등록 대기" : `${question.criteria.reduce((sum, item) => sum + item.max, 0)}점`}</span></div>
      <div className="question-box"><strong>{question.title}</strong><p>{question.prompt || "등록된 문제 설명이 없습니다."}</p></div>
      {question.sourceUrl ? <a className="source-link" href={question.sourceUrl} target="_blank" rel="noreferrer">{question.sourceLabel || "문항 출처 확인"}<ExternalLink /></a> : question.sourceLabel ? <p className="source-link">{question.sourceLabel}</p> : null}
      {problemAttachment && <div style={{marginTop:16}}><div className="answer-label">학생이 함께 올린 문제 원본</div>
        {problemAttachment.type === "application/pdf" ? <iframe className="answer-media" src={problemAttachment.url} title={`${submission.studentCode}의 문제 원본 PDF`} /> : <img className="answer-media" src={problemAttachment.url} alt={`${submission.studentCode}이 제출한 문제 원본`} />}
        <a className="source-link" href={problemAttachment.url} target="_blank" rel="noreferrer">문제 원본 열기 · {problemAttachment.name}<ExternalLink /></a>
      </div>}
    </div>
    {submission.studentQuestion && <div className="paper-top" style={{paddingTop:0}}><div className="question-box"><strong><MessageSquare size={14} style={{display:"inline",verticalAlign:"middle",marginRight:6}} />학생이 궁금한 점</strong><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{submission.studentQuestion}</p></div></div>}
    <div className="answer-paper"><div className="answer-label">학생이 제출한 풀이</div>{submission.answer ? <p>{submission.answer}</p> : <p className="muted">아래 첨부한 원본 답안을 확인해 주세요.</p>}
      {attachment && <>{attachment.type === "application/pdf" ? <iframe className="answer-media" src={attachment.url} title={`${submission.studentCode}의 PDF 답안`} /> : <img className="answer-media" src={attachment.url} alt={`${submission.studentCode}의 제출 답안`} />}
        <a className="source-link" href={attachment.url} target="_blank" rel="noreferrer">원본 답안 열기 · {attachment.name}<ExternalLink /></a></>}
    </div><p className="paper-foot">제출한 문제와 답안은 비공개로 보관됩니다. 학생의 풀이 원문을 그대로 표시합니다.</p>
  </section>;
}

type SetRubric = (submission: Submission, criteria: Criterion[], notes: string) => Promise<void>;

function RubricEditor({ submission, busy, onSave }: { submission: Submission; busy: boolean; onSave?: SetRubric }) {
  const [rows, setRows] = useState([{id:"rubric-1",title:"",max:"",description:""}]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const disabled = busy || working || !onSave;
  const change = (index: number, field: "title" | "max" | "description", value: string) => setRows(previous => previous.map((row, position) => position === index ? {...row, [field]:value} : row));
  async function save() {
    setError("");
    if (!onSave) return;
    const criteria = rows.map(row => ({...row,title:row.title.trim(),max:Number(row.max),description:row.description.trim()}));
    if (!criteria.length || criteria.some(row => !row.title || !Number.isFinite(row.max) || row.max < 0.01 || row.max > 1000 || !row.description)) {
      setError("각 항목의 이름, 배점(0.01~1000점), 부분점수 기준을 입력해 주세요."); return;
    }
    setWorking(true);
    try { await onSave(submission, criteria, notes.trim()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "채점기준을 저장하지 못했습니다."); }
    finally { setWorking(false); }
  }
  return <section className="card"><div className="card-head"><div><h2>채점기준 먼저 등록</h2><small>학생이 직접 올린 문제입니다.</small></div><BookOpen size={17} /></div><div className="review-form form-stack">
    <p className="review-notice">문제와 학교의 기준을 확인하고 항목별 배점을 입력해 주세요. 기준이 등록되면 점수와 피드백을 작성할 수 있습니다.</p>
    {submission.studentQuestion && <div className="question-box"><strong>학생이 궁금한 점</strong><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{submission.studentQuestion}</p></div>}
    {rows.map((row, index) => <div className="criterion" key={row.id}><div className="card-title-row"><strong>항목 {index + 1}</strong><button className="icon-button" type="button" aria-label={`기준 항목 ${index + 1} 삭제`} disabled={disabled || rows.length === 1} onClick={() => setRows(previous => previous.filter((_, position) => position !== index))}><Trash2 size={16} /></button></div>
      <label className="field">항목 이름<input className="text-input" aria-label={`기준 항목 ${index + 1} 이름`} value={row.title} maxLength={150} disabled={disabled} onChange={event => change(index,"title",event.target.value)} /></label>
      <label className="field">배점<input className="text-input" aria-label={`기준 항목 ${index + 1} 배점`} type="number" min={0.01} max={1000} step="any" value={row.max} disabled={disabled} onChange={event => change(index,"max",event.target.value)} /></label>
      <label className="field">부분점수 · 판단 기준<textarea className="text-input" aria-label={`기준 항목 ${index + 1} 판단 기준`} rows={3} value={row.description} maxLength={3000} disabled={disabled} onChange={event => change(index,"description",event.target.value)} /></label>
    </div>)}
    <button className="button secondary" type="button" disabled={disabled || rows.length >= 30} onClick={() => setRows(previous => [...previous,{id:crypto.randomUUID(),title:"",max:"",description:""}])}><Plus />채점 항목 추가</button>
    <label className="field">채점 참고 메모<textarea className="text-input" rows={2} value={notes} maxLength={15000} disabled={disabled} onChange={event => setNotes(event.target.value)} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button primary" type="button" disabled={disabled} onClick={save}><Save />{working ? "저장 중…" : "채점기준 등록"}</button>
  </div></section>;
}

export function ReviewCard({ submission, demo, busy, canReview, onSave, onPdf, onSetRubric }: {
  submission: Submission;
  demo: boolean;
  busy: boolean;
  canReview: boolean;
  onSave: (submission: Submission, action: ReviewAction, review: EditableReview) => Promise<void>;
  onPdf: (submissions: Submission[]) => Promise<void>;
  onSetRubric?: SetRubric;
}) {
  const approved = submission.status === "approved" && Boolean(submission.final);
  const current = approved ? submission.final : canReview ? submission.draft : null;
  const [scores, setScores] = useState<string[]>(() => submission.question.criteria.map((_, index) => current?.scores[index]?.toString() ?? ""));
  const [evidence, setEvidence] = useState<string[]>(() => submission.question.criteria.map((_, index) => current?.evidence[index] ?? ""));
  const [feedback, setFeedback] = useState(current?.feedback ?? "");
  const [questionResponse, setQuestionResponse] = useState(current?.questionResponse ?? "");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const editable = canReview && !approved;
  const disabled = busy || working;
  const maximum = submission.question.criteria.reduce((sum, criterion) => sum + criterion.max, 0);
  const rubricPending = submission.rubricPending || !submission.question.criteria.length;
  const total = scores.reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
  const scoreReady = scores.every((value) => value.trim() !== "");

  async function save(action: ReviewAction) {
    setError("");
    const values = scores.map(Number);
    if (action !== "reopen") {
      if (rubricPending) { setError("먼저 채점기준을 등록해 주세요."); return; }
      const invalid = submission.question.criteria.findIndex((criterion, index) => scores[index].trim() === "" || !Number.isFinite(values[index]) || values[index] < 0 || values[index] > criterion.max);
      if (invalid >= 0) { setError(`${submission.question.criteria[invalid].title}: 0점부터 ${submission.question.criteria[invalid].max}점 사이로 입력해 주세요.`); return; }
      if (action === "approve" && !feedback.trim()) { setError("확정하기 전에 학생에게 전달할 피드백을 입력해 주세요."); return; }
      if (action === "approve" && submission.studentQuestion?.trim() && !questionResponse.trim()) { setError("학생의 추가 질문에 답변한 뒤 확정해 주세요."); return; }
    }
    setWorking(true);
    try { await onSave(submission, action, { scores: values, evidence: evidence.map((value) => value.trim()), feedback: feedback.trim(), questionResponse:questionResponse.trim() }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했습니다. 다시 시도해 주세요."); }
    finally { setWorking(false); }
  }

  async function download() {
    setWorking(true); setError("");
    try { await onPdf([submission]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "PDF를 만들지 못했습니다. 다시 시도해 주세요."); }
    finally { setWorking(false); }
  }

  if (!canReview && !approved) return <section className="card"><div className="card-head"><h2>첨삭 결과</h2><span className={`status ${submission.status}`}>검토 중</span></div><div className="empty"><Clock3 /><h3>{rubricPending ? "채점기준 확인을 기다리고 있어요" : "피드백을 기다리고 있어요"}</h3><p>{submission.mode === "personal" ? "현재 AI 첨삭은 연결 전입니다. 제출한 문제, 답안과 질문은 기록에서 다시 확인할 수 있습니다." : rubricPending ? "선생님이 문제의 채점기준을 등록하고 답안과 추가 질문을 검토합니다." : "선생님이 검토하고 확정하면 점수와 질문에 대한 답변을 확인할 수 있습니다."}</p></div></section>;
  if (canReview && rubricPending && !approved) return <RubricEditor submission={submission} busy={disabled} onSave={onSetRubric} />;

  return <section className="card">
    <div className="card-head"><div><h2>{approved ? "확정된 첨삭" : "채점기준 · 피드백"}</h2><small>{approved ? "담당 선생님이 확인한 결과" : "항목별 근거와 부분점수를 확인하세요"}</small></div><div className="score-summary">{scoreReady ? Number(total.toFixed(2)) : "—"}<small> / {maximum}</small></div></div>
    <div className="review-form">
      <div className="review-notice">{approved ? <><ShieldCheck size={11} style={{display:"inline",verticalAlign:"middle",marginRight:4}} />선생님 확정 · PDF로 저장해 인쇄할 수 있어요.</> : demo ? "예시 체험입니다. 항목별 점수와 피드백을 직접 수정해 보세요." : "AI 첨삭 연결 전 · 선생님이 채점기준에 따라 직접 검토해 주세요."}</div>
      {submission.studentQuestion && <div className="question-box" style={{marginBottom:18}}><strong>학생이 궁금한 점</strong><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{submission.studentQuestion}</p></div>}
      {submission.question.criteria.map((criterion, index) => <div className="criterion" key={criterion.id || index}>
        <div className="criterion-head"><label htmlFor={`score-${submission.id}-${index}`}>{criterion.title}</label><div className="point-field">{editable ? <input id={`score-${submission.id}-${index}`} aria-label={`${criterion.title} 점수`} type="number" min={0} max={criterion.max} step="any" value={scores[index]} disabled={disabled} onChange={(event) => setScores((previous) => previous.map((value, position) => position === index ? event.target.value : value))} /> : <strong>{scores[index]}</strong>}<span> / {criterion.max}점</span></div></div>
        {criterion.description && <p className="criterion-description">{criterion.description}</p>}
        {editable ? <textarea className="evidence-field" aria-label={`${criterion.title} 채점 근거`} placeholder="풀이의 어느 부분이 기준에 해당하는지 적어 주세요." value={evidence[index]} maxLength={3000} disabled={disabled} onChange={(event) => setEvidence((previous) => previous.map((value, position) => position === index ? event.target.value : value))} /> : <p className="evidence-field" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{evidence[index] || "별도 채점 근거가 없습니다."}</p>}
      </div>)}
      <label className="field">선생님 피드백{editable ? <textarea rows={5} value={feedback} maxLength={15000} disabled={disabled} placeholder="잘한 점, 보완할 점과 다음 풀이에서 기억할 내용을 적어 주세요." onChange={(event) => setFeedback(event.target.value)} /> : <p className="question-box" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontWeight:450}}>{feedback || "추가 피드백이 없습니다."}</p>}</label>
      {submission.studentQuestion && <label className="field" style={{marginTop:16}}>추가 질문에 대한 답변{editable ? <textarea rows={5} value={questionResponse} maxLength={15000} disabled={disabled} placeholder="학생이 질문한 부분에 직접 답변해 주세요. 확정된 답변은 리포트와 PDF에 함께 표시됩니다." onChange={event => setQuestionResponse(event.target.value)} /> : <p className="question-box" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontWeight:450}}>{questionResponse || "추가 질문의 답변이 기록되지 않았습니다."}</p>}</label>}
      {error && <div className="form-error" role="alert" style={{marginTop:12}}>{error}</div>}
      <div className="actions">{approved ? <>{canReview && <button className="button secondary" disabled={disabled} onClick={() => save("reopen")}><RotateCcw />다시 검토</button>}<button className="button primary" disabled={disabled} onClick={download}><Download />PDF 저장 · 인쇄</button></> : <><button className="button secondary" disabled={disabled} onClick={() => save("draft")}><Save />초안 저장</button><button className="button primary" disabled={disabled} onClick={() => save("approve")}><CheckCheck />검토 확정</button></>}</div>
      {editable && <p className="muted" style={{marginTop:10}}>확정하면 학생에게 점수와 피드백이 공개됩니다.</p>}
    </div>
  </section>;
}

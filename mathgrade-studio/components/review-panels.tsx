"use client";
/* Uploaded authenticated originals use their protected URL without an image optimizer. */
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { BookOpen, CheckCheck, Clock3, Download, ExternalLink, FileText, RotateCcw, Save, ShieldCheck } from "lucide-react";
import type { Review, Submission } from "@/lib/types";

type EditableReview = Omit<Review, "reviewedAt" | "reviewerId">;
type ReviewAction = "draft" | "approve" | "reopen";

export function Metric({ title, count, unit, note, icon: Icon }: { title: string; count: number; unit: string; note: string; icon: typeof BookOpen }) {
  return <article className="metric"><div className="metric-label"><span>{title}</span><Icon aria-hidden="true" /></div><strong>{count}<span>{unit}</span></strong><small>{note}</small></article>;
}

export function AnswerCard({ submission }: { submission: Submission }) {
  const { question, attachment } = submission;
  return <section className="card">
    <div className="card-head"><div><h2>학생 답안</h2><small>{submission.studentCode}</small></div><FileText size={17} color="#ad99bf" aria-hidden="true" /></div>
    <div className="paper-top"><div className="source-line"><span>{question.university || "자체 등록 문항"}</span>{question.academicYear && <span>{question.academicYear}학년도</span>}<span>{question.criteria.reduce((sum, item) => sum + item.max, 0)}점</span></div>
      <div className="question-box"><strong>{question.title}</strong><p>{question.prompt || "등록된 문제 설명이 없습니다."}</p></div>
      {question.sourceUrl ? <a className="source-link" href={question.sourceUrl} target="_blank" rel="noreferrer">{question.sourceLabel || "문항 출처 확인"}<ExternalLink /></a> : question.sourceLabel ? <p className="source-link">{question.sourceLabel}</p> : null}
    </div>
    <div className="answer-paper"><div className="answer-label">학생이 제출한 풀이</div>{submission.answer ? <p>{submission.answer}</p> : <p className="muted">아래 첨부한 원본 답안을 확인해 주세요.</p>}
      {attachment && <>{attachment.type === "application/pdf" ? <iframe className="answer-media" src={attachment.url} title={`${submission.studentCode}의 PDF 답안`} /> : <img className="answer-media" src={attachment.url} alt={`${submission.studentCode}의 제출 답안`} />}
        <a className="source-link" href={attachment.url} target="_blank" rel="noreferrer">원본 답안 열기 · {attachment.name}<ExternalLink /></a></>}
    </div><p className="paper-foot">학생의 풀이 원문을 그대로 표시합니다.</p>
  </section>;
}

export function ReviewCard({ submission, demo, busy, canReview, onSave, onPdf }: {
  submission: Submission;
  demo: boolean;
  busy: boolean;
  canReview: boolean;
  onSave: (submission: Submission, action: ReviewAction, review: EditableReview) => Promise<void>;
  onPdf: (submissions: Submission[]) => Promise<void>;
}) {
  const approved = submission.status === "approved" && Boolean(submission.final);
  const current = approved ? submission.final : canReview ? submission.draft : null;
  const [scores, setScores] = useState<string[]>(() => submission.question.criteria.map((_, index) => current?.scores[index]?.toString() ?? ""));
  const [evidence, setEvidence] = useState<string[]>(() => submission.question.criteria.map((_, index) => current?.evidence[index] ?? ""));
  const [feedback, setFeedback] = useState(current?.feedback ?? "");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const editable = canReview && !approved;
  const disabled = busy || working;
  const maximum = submission.question.criteria.reduce((sum, criterion) => sum + criterion.max, 0);
  const total = scores.reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
  const scoreReady = scores.every((value) => value.trim() !== "");

  async function save(action: ReviewAction) {
    setError("");
    const values = scores.map(Number);
    if (action !== "reopen") {
      const invalid = submission.question.criteria.findIndex((criterion, index) => scores[index].trim() === "" || !Number.isFinite(values[index]) || values[index] < 0 || values[index] > criterion.max);
      if (invalid >= 0) { setError(`${submission.question.criteria[invalid].title}: 0점부터 ${submission.question.criteria[invalid].max}점 사이로 입력해 주세요.`); return; }
      if (action === "approve" && !feedback.trim()) { setError("확정하기 전에 학생에게 전달할 피드백을 입력해 주세요."); return; }
    }
    setWorking(true);
    try { await onSave(submission, action, { scores: values, evidence: evidence.map((value) => value.trim()), feedback: feedback.trim() }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했습니다. 다시 시도해 주세요."); }
    finally { setWorking(false); }
  }

  async function download() {
    setWorking(true); setError("");
    try { await onPdf([submission]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "PDF를 만들지 못했습니다. 다시 시도해 주세요."); }
    finally { setWorking(false); }
  }

  if (!canReview && !approved) return <section className="card"><div className="card-head"><h2>첨삭 결과</h2><span className={`status ${submission.status}`}>검토 중</span></div><div className="empty"><Clock3 /><h3>피드백을 기다리고 있어요</h3><p>{submission.mode === "personal" ? "현재 AI 첨삭은 연결 전입니다. 제출한 답안은 기록에서 다시 확인할 수 있습니다." : "선생님이 검토하고 확정하면 점수와 피드백을 확인할 수 있습니다."}</p></div></section>;

  return <section className="card">
    <div className="card-head"><div><h2>{approved ? "확정된 첨삭" : "채점기준 · 피드백"}</h2><small>{approved ? "담당 선생님이 확인한 결과" : "항목별 근거와 부분점수를 확인하세요"}</small></div><div className="score-summary">{scoreReady ? Number(total.toFixed(2)) : "—"}<small> / {maximum}</small></div></div>
    <div className="review-form">
      <div className="review-notice">{approved ? <><ShieldCheck size={11} style={{display:"inline",verticalAlign:"middle",marginRight:4}} />선생님 확정 · PDF로 저장해 인쇄할 수 있어요.</> : demo ? "예시 체험입니다. 항목별 점수와 피드백을 직접 수정해 보세요." : "AI 첨삭 연결 전 · 선생님이 채점기준에 따라 직접 검토해 주세요."}</div>
      {submission.question.criteria.map((criterion, index) => <div className="criterion" key={criterion.id || index}>
        <div className="criterion-head"><label htmlFor={`score-${submission.id}-${index}`}>{criterion.title}</label><div className="point-field">{editable ? <input id={`score-${submission.id}-${index}`} aria-label={`${criterion.title} 점수`} type="number" min={0} max={criterion.max} step="any" value={scores[index]} disabled={disabled} onChange={(event) => setScores((previous) => previous.map((value, position) => position === index ? event.target.value : value))} /> : <strong>{scores[index]}</strong>}<span> / {criterion.max}점</span></div></div>
        {criterion.description && <p className="criterion-description">{criterion.description}</p>}
        {editable ? <textarea className="evidence-field" aria-label={`${criterion.title} 채점 근거`} placeholder="풀이의 어느 부분이 기준에 해당하는지 적어 주세요." value={evidence[index]} maxLength={3000} disabled={disabled} onChange={(event) => setEvidence((previous) => previous.map((value, position) => position === index ? event.target.value : value))} /> : <p className="evidence-field" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{evidence[index] || "별도 채점 근거가 없습니다."}</p>}
      </div>)}
      <label className="field">선생님 피드백{editable ? <textarea rows={5} value={feedback} maxLength={15000} disabled={disabled} placeholder="잘한 점, 보완할 점과 다음 풀이에서 기억할 내용을 적어 주세요." onChange={(event) => setFeedback(event.target.value)} /> : <p className="question-box" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontWeight:450}}>{feedback || "추가 피드백이 없습니다."}</p>}</label>
      {error && <div className="form-error" role="alert" style={{marginTop:12}}>{error}</div>}
      <div className="actions">{approved ? <>{canReview && <button className="button secondary" disabled={disabled} onClick={() => save("reopen")}><RotateCcw />다시 검토</button>}<button className="button primary" disabled={disabled} onClick={download}><Download />PDF 저장 · 인쇄</button></> : <><button className="button secondary" disabled={disabled} onClick={() => save("draft")}><Save />초안 저장</button><button className="button primary" disabled={disabled} onClick={() => save("approve")}><CheckCheck />검토 확정</button></>}</div>
      {editable && <p className="muted" style={{marginTop:10}}>확정하면 학생에게 점수와 피드백이 공개됩니다.</p>}
    </div>
  </section>;
}

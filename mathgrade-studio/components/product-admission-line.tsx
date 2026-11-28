"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, GraduationCap, Plus } from "lucide-react";
import { comparePastCutoffs, type StudentEssayScore } from "@/lib/admissions";
import { api } from "@/lib/client/api";
import type { ExamSubmission, FeedbackScore, FeedbackVersion } from "@/lib/product-types";
import type { AdmissionHistoryPaper, AdmissionLine } from "@/lib/product-admission-types";
import type { AdmissionRecord } from "@/lib/types";
import { ProductAdmissionStability } from "./product-admission-stability";

type AdmissionLineProps = {
  submission: ExamSubmission;
  versions: FeedbackVersion[];
  teacher: boolean;
  demo: boolean;
};

function demoAdmissionLine(versions: FeedbackVersion[], teacher: boolean): AdmissionLine {
  const version = versions
    .filter(item => item.published && (!teacher || item.teacherReviewed))
    .sort((left, right) => right.version - left.version)[0];
  if (!version) return { score: null, references: [] };
  const { total, maximum } = version.result;
  return {
    score: { total, maximum },
    references: [{
      id: "example-admission-cutoff",
      ownerId: "",
      university: "가상대",
      department: "수리논술 · 자연계열",
      academicYear: 2026,
      examKey: "자연계열 수리논술 전체 (예시)",
      score: Math.round(maximum * 0.75 * 100) / 100,
      scale: maximum,
      metric: "minimum",
      pointType: "essay",
      sourceUrl: "https://example.invalid/",
      sourceLabel: "체험용 가상 기준",
      createdAt: version.createdAt,
    }],
  };
}

function compareRegisteredCutoffs(submissionId: string, score: FeedbackScore, references: AdmissionRecord[]) {
  const scores = new Map<string, StudentEssayScore>();
  for (const reference of references) {
    const { university, academicYear, examKey } = reference;
    const key = JSON.stringify([university, academicYear, examKey]);
    scores.set(key, { id: submissionId, university, academicYear, examKey, scale: score.maximum, score: score.total });
  }
  return comparePastCutoffs([...scores.values()], references);
}

function CutoffForm({ maximum, reference, context, onSave, onCancel }: {
  maximum: number;
  reference?: AdmissionRecord;
  context?: AdmissionRecord;
  onSave: (input: Record<string, string | number | boolean>) => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const fields = new FormData(event.currentTarget);
    const field = (name: string) => String(fields.get(name) ?? "").trim();
    setBusy(true);
    try {
      await onSave({
        ...(reference ? { id: reference.id, revision: reference.revision ?? 1 } : {}),
        university: field("university"),
        department: field("department"),
        academicYear: Number(field("academicYear")),
        examKey: field("examKey"),
        score: Number(field("score")),
        sourceLabel: field("sourceLabel"),
        sourceUrl: field("sourceUrl"),
        comparableFullExam: fields.get("comparableFullExam") === "on",
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "논술 최저점을 등록하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="p-form p-line-form" onSubmit={event => void submit(event)}>
    <h3>{reference ? "공개 논술 최저점 수정" : "공개 논술 최저점 등록"}</h3>
    <div className="p-grid-two">
      <label>대학명<input name="university" required maxLength={100} defaultValue={(reference ?? context)?.university} readOnly={Boolean(context)} /></label>
      <label>전형 · 모집단위<input name="department" required maxLength={150} placeholder="예: 논술전형 · 자연계열" defaultValue={reference?.department} /></label>
      <label>학년도<input name="academicYear" required type="number" min={2000} max={2100} step={1} defaultValue={(reference ?? context)?.academicYear} readOnly={Boolean(context)} /></label>
      <label>공개 논술 최저점<input name="score" required type="number" min={0} max={maximum} step="any" defaultValue={reference?.score} aria-describedby="line-cutoff-scale" /></label>
    </div>
    <p className="p-help" id="line-cutoff-scale">기준 자료도 {maximum}점 만점이어야 비교할 수 있습니다.</p>
    <label>시험 · 채점 기준<input name="examKey" required maxLength={150} placeholder="예: 자연계열 오전 수리논술 전체" defaultValue={(reference ?? context)?.examKey} readOnly={Boolean(context)} /></label>
    <label>자료 출처<input name="sourceLabel" required maxLength={500} placeholder="대학 입학처 자료명과 페이지" defaultValue={reference?.sourceLabel} /></label>
    <label>원문 링크<input name="sourceUrl" required type="url" maxLength={2000} placeholder="https://" defaultValue={reference?.sourceUrl} /></label>
    <label className="p-line-confirm">
      <input type="checkbox" name="comparableFullExam" required />
      <span>이 성적표는 등록할 최저점과 같은 학년도·시험 전체·채점 기준·만점으로 산출했습니다.</span>
    </label>
    {error && <p className="p-error" role="alert">{error}</p>}
    <div className="actions">
      <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>취소</button>
      <button type="submit" className="button primary" disabled={busy}>{busy ? "등록 중…" : "저장하고 비교"}</button>
    </div>
  </form>;
}

export function ProductAdmissionLine({ submission, versions, teacher, demo }: AdmissionLineProps) {
  const [data, setData] = useState<AdmissionLine | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [cutoffRevision, setCutoffRevision] = useState(0);
  const [editing, setEditing] = useState<AdmissionRecord | "new" | null>(null);
  const endpoint = `/api/product/submissions/${encodeURIComponent(submission.id)}/admission-line`;

  useEffect(() => {
    if (demo) return;
    let active = true;
    setError("");
    setData(null);
    api<AdmissionLine>(endpoint).then(result => {
      if (active) setData(result);
    }).catch(failure => {
      if (active) setError(failure instanceof Error ? failure.message : "입시 기준을 불러오지 못했습니다.");
    });
    return () => { active = false; };
  }, [demo, endpoint, retry, submission.revision]);

  const line = demo ? demoAdmissionLine(versions, teacher) : data;
  let content;
  if (error) {
    content = <div className="p-empty">
      <p className="p-error" role="alert">{error}</p>
      <button type="button" className="button secondary" onClick={() => setRetry(attempt => attempt + 1)}>다시 불러오기</button>
    </div>;
  } else if (!line) {
    content = <p className="p-help" role="status">입시 기준을 불러오는 중…</p>;
  } else if (!line.score) {
    content = <div className="p-empty">
      <h3>비교할 첨삭 점수를 기다리고 있어요</h3>
      <p>{teacher ? "선생님 첨삭을 확정하면 등록한 논술 최저점과 비교할 수 있어요." : "첨삭이 완료되면 등록한 논술 최저점과 비교할 수 있어요."}</p>
    </div>;
  } else {
    const score = line.score;
    const { comparisons, reason } = compareRegisteredCutoffs(submission.id, score, line.references);
    content = <>
      <div className="p-line-score">
        <span>{teacher ? "선생님 확정 첨삭" : "비교에 사용한 첨삭 점수"}</span>
        <strong>{score.total} / {score.maximum}점</strong>
      </div>
      {demo && <p className="p-note">가상 대학과 합격컷을 사용한 체험 예시입니다.</p>}
      {comparisons.length > 0 ? <ul className="p-line-results" aria-label="논술 최저점 비교 결과">
        {comparisons.map(row => {
          const reference = line.references.find(item => item.university === row.university && item.department === row.department && item.academicYear === row.academicYear && item.examKey === row.examKey);
          return <li key={JSON.stringify([row.university, row.department, row.academicYear, row.examKey])} className="p-line-result">
          <div className="p-line-result-head">
            <div><h3>{row.university} <span>· {row.department}</span></h3><p className="p-help">{row.academicYear}학년도 · {row.examKey}</p></div>
            <span className="p-badge">{row.position === "above" ? "최저점 상회" : row.position === "below" ? "최저점 미달" : "최저점 동일"}</span>
          </div>
          <dl className="p-line-values">
            <div><dt>논술 최저점</dt><dd>{row.referenceScore} / {row.scale}점</dd></div>
            <div><dt>점수 차</dt><dd>{row.gap > 0 && "+"}{row.gap}점</dd></div>
          </dl>
          {demo ? <span className="p-help">{row.sourceLabel}</span> : <div className="p-line-result-foot">
            <a className="p-line-source" href={row.sourceUrl} target="_blank" rel="noopener noreferrer">{row.sourceLabel}<ArrowUpRight size={14} aria-hidden="true" /></a>
            {reference && !editing && <button type="button" className="button ghost small" aria-label={`${row.department} 최저점 수정`} onClick={() => setEditing(reference)}>수정</button>}
          </div>}
        </li>;})}
      </ul> : <div className="p-empty">
        <h3>{line.references.length ? "비교할 수 있는 최저점이 없습니다" : "등록한 논술 최저점이 없습니다"}</h3>
        <p>{line.references.length ? reason : "같은 시험의 공개 논술 최저점과 원문 출처를 등록해 주세요."}</p>
      </div>}
      {comparisons.length > 0 && <p className="p-help">동일 시험의 과거 기준과 비교한 결과예요. 지원 판단에는 해당 학년도 모집요강과 수능 최저 등을 함께 확인해 주세요.</p>}
      {!demo && (editing ? <CutoffForm key={editing === "new" ? "new" : editing.id} maximum={score.maximum} reference={editing === "new" ? undefined : editing} context={line.references.find(row => editing === "new" || row.id !== editing.id)} onCancel={() => setEditing(null)} onSave={async input => {
        const saved = await api<AdmissionLine>(endpoint, input);
        setData(saved);
        setCutoffRevision(current => current + 1);
        setEditing(null);
      }} /> : <button type="button" className="button secondary p-line-add" onClick={() => setEditing("new")}><Plus size={16} aria-hidden="true" /> 논술 최저점 등록</button>)}
    </>;
  }

  const demoReference = demo ? line?.references[0] : undefined;
  const demoPaper: AdmissionHistoryPaper | undefined = demoReference && line?.score ? {
    ...line.score,
    submissionId: submission.id,
    examTitle: submission.exam.title,
    difficulty: submission.exam.difficulty,
    reviewedAt: demoReference.createdAt,
    university: demoReference.university,
    department: demoReference.department,
    academicYear: demoReference.academicYear,
    examKey: demoReference.examKey,
    cutoff: demoReference.score,
    sourceUrl: demoReference.sourceUrl,
    sourceLabel: demoReference.sourceLabel,
  } : undefined;

  return <>
  <ProductAdmissionStability submissionId={submission.id} demo={demo} demoPaper={demoPaper} refreshKey={submission.revision + cutoffRevision} />
  <section className="p-admission-line" aria-labelledby="product-admission-line-heading">
    <div className="p-line-heading">
      <GraduationCap size={22} aria-hidden="true" />
      <div><h2 id="product-admission-line-heading">과거 논술 최저점 대비</h2><p className="p-help">첨삭 점수와 같은 시험의 공개 논술 최저점을 비교합니다.</p></div>
    </div>
    {content}
  </section>
  </>;
}

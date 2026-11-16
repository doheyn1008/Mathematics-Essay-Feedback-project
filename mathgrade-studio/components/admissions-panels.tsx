"use client";

import { useState, type FormEvent } from "react";
import { ExternalLink, GraduationCap, TrendingUp } from "lucide-react";
import type { AdmissionRecord, Submission } from "@/lib/types";
import { comparePastCutoffs, forecastCutoff } from "@/lib/admissions";

export type AdmissionInput = Omit<AdmissionRecord, "id" | "ownerId" | "createdAt"> & { id?: string };

const metricNames: Record<AdmissionRecord["metric"], string> = {
  minimum: "최저점", average: "평균점", percentile70: "70% 지점 성적",
};
const pointNames: Record<AdmissionRecord["pointType"], string> = {
  essay: "논술 점수", total: "전형 총점", school: "학생부 성적",
};
const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

export function Recommendations({ submissions, admissions, onAdd }: {
  submissions: Submission[];
  admissions: AdmissionRecord[];
  onAdd: () => void;
}) {
  const eligible = submissions.filter((submission) => submission.mode === "personal"
    && submission.status === "approved" && submission.final && submission.question.academicYear !== null);
  const result = comparePastCutoffs(eligible.map((submission) => ({
    id: submission.id,
    university: submission.question.university,
    academicYear: submission.question.academicYear!,
    examKey: submission.question.examKey,
    scale: total(submission.question.criteria.map((criterion) => criterion.max)),
    score: total(submission.final!.scores),
  })), admissions);

  return <div className="stack">
    <div className="state-callout">
      대학 추천은 완료된 개인용 첨삭의 <strong>과거 기준 비교</strong>로 제공합니다.
      같은 대학·시험 기준·학년도·만점의 논술 최저점만 비교하며, 다른 대학의 점수를 대신 적용하지 않습니다.
      합격 가능성이나 올해 합격을 보장하는 결과는 아닙니다.
    </div>
    {result.status === "insufficient" ? <section className="card">
      <div className="empty"><GraduationCap /><h3>비교할 자료가 아직 부족해요</h3><p>{result.reason}</p>
        <p>평균점, 70% 지점 성적, 학생부 성적과 전형 총점은 논술 최저점으로 사용하지 않습니다.</p>
        <button className="button secondary" onClick={onAdd}>입시 기준 자료 확인</button>
      </div>
    </section> : <>
      <p className="muted">{result.reason}</p>
      <div className="two-column">{result.comparisons.map((comparison) => <section
        className="card card-padding"
        key={`${comparison.submissionId}-${comparison.university}-${comparison.department}-${comparison.academicYear}-${comparison.examKey}`}>
        <p className="eyebrow">{comparison.label}</p>
        <h2>{comparison.university} · {comparison.department}</h2>
        <p className="muted" style={{ margin: "8px 0 18px" }}>{comparison.academicYear}학년도 · {comparison.examKey}</p>
        <div className="two-column">
          <div><p className="muted">나의 첨삭 점수</p><strong style={{ fontSize: 25 }}>{comparison.studentScore}<small className="muted"> / {comparison.scale}</small></strong></div>
          <div><p className="muted">등록된 논술 최저점</p><strong style={{ fontSize: 25 }}>{comparison.referenceScore}<small className="muted"> / {comparison.scale}</small></strong></div>
        </div>
        <p style={{ margin: "16px 0 8px" }}>{comparison.description}</p>
        <p className="muted">답안: {eligible.find((submission) => submission.id === comparison.submissionId)?.question.title}</p>
        <a className="source-link" href={comparison.sourceUrl} target="_blank" rel="noreferrer">{comparison.sourceLabel}<ExternalLink /></a>
        <p className="muted">사용자가 등록한 출처 · 내용은 자동 검증되지 않았습니다.</p>
      </section>)}</div>
    </>}
    <div className="state-callout">같은 시험과 환산 기준의 전체 논술 점수만 비교하세요. 개별 문항 점수를 전체 시험 합격선과 비교하지 마세요. 현재 AI 연결 전이므로 새 개인 답안의 자동 첨삭 점수는 생성되지 않습니다.</div>
  </div>;
}

export function Admissions({ records, onEdit }: {
  records: AdmissionRecord[];
  onEdit: (record: AdmissionRecord) => void;
}) {
  const groups = new Map<string, AdmissionRecord[]>();
  for (const record of records) {
    if (record.metric !== "minimum" || record.pointType !== "essay") continue;
    const key = JSON.stringify([record.university.trim(), record.department.trim(), record.examKey.trim(), record.scale]);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const forecasts = [...groups].map(([key, rows]) => {
    const targetYear = Math.max(...rows.map((record) => record.academicYear)) + 1;
    return { key, rows, targetYear, result: forecastCutoff(rows, targetYear) };
  });

  return <div className="stack">
    <div className="state-callout">이 목록은 직접 등록한 자료입니다. 출처의 내용과 점수 기준은 자동 검증되지 않았습니다. 대학이 공개한 자료를 확인하고, 최저점·평균점·70% 지점 성적을 구분해 입력하세요.</div>
    <section className="card">
      {records.length ? <div className="table-scroll"><table><thead><tr>
        <th>대학 · 모집단위</th><th>학년도 · 시험 기준</th><th>성적 종류</th><th>점수 / 만점</th><th>출처</th><th>관리</th>
      </tr></thead><tbody>{records.map((record) => <tr key={record.id}>
        <td><strong>{record.university}</strong><p className="muted">{record.department}</p></td>
        <td>{record.academicYear}<p className="muted">{record.examKey}</p></td>
        <td>{pointNames[record.pointType]}<p className="muted">{metricNames[record.metric]}</p></td>
        <td>{record.score} / {record.scale}</td>
        <td><a className="source-link" href={record.sourceUrl} target="_blank" rel="noreferrer">{record.sourceLabel}<ExternalLink /></a></td>
        <td><button className="button secondary small" onClick={() => onEdit(record)}>수정</button></td>
      </tr>)}</tbody></table></div> : <div className="empty"><GraduationCap /><h3>등록한 입시 자료가 없습니다</h3><p>대학별 논술 성적과 원문 출처를 등록하면 비교 기준으로 사용할 수 있습니다.</p><p>실제 대학의 합격선을 임의로 채워 넣지 않습니다.</p></div>}
    </section>
    <div><h2>학교별 합격선 참고 예측</h2><p className="muted" style={{ marginTop: 8 }}>같은 대학·모집단위·시험 기준·만점의 연속 자료를 묶어, 마지막 자료의 다음 학년도를 계산합니다.</p></div>
    {!forecasts.length ? <section className="card"><div className="empty"><TrendingUp /><h3>논술 최저점 자료가 필요해요</h3><p>직전 학년도까지 이어지는 연속 3개 학년도 이상이 있어야 참고 예측을 표시합니다.</p></div></section>
      : <div className="two-column">{forecasts.map(({ key, rows, targetYear, result }) => <section className="card card-padding" key={key}>
        <p className="eyebrow">{targetYear}학년도 참고 예측</p>
        <h3>{rows[0].university} · {rows[0].department}</h3>
        <p className="muted" style={{ margin: "8px 0 16px" }}>{rows[0].examKey} · {rows[0].scale}점 만점</p>
        {result.status === "insufficient" ? <p className="muted">{result.reason}</p> : <>
          <strong style={{ fontSize: 27 }}>{result.estimate}<small className="muted">점</small></strong>
          <p style={{ margin: "10px 0" }}>과거 자료 기반 참고 범위 {result.lower}~{result.upper}점</p>
          <p className="muted">사용 자료: {result.years.join(" · ")}학년도<br />순차 검증 {result.backtestCount}회 · 평균 절대오차 {result.backtestMeanAbsoluteError}점</p>
          <p className="muted" style={{ marginTop: 12 }}>{result.method}</p>
          <p className="muted" style={{ marginTop: 8 }}>이 범위는 통계적 신뢰구간이나 합격 확률이 아닙니다. {result.limitation}</p>
          <div className="actions" style={{ marginTop: 12 }}>{result.sourceUrls.map((url, index) => <a className="source-link" href={url} key={url} target="_blank" rel="noreferrer">등록 출처 {index + 1}<ExternalLink /></a>)}</div>
        </>}
      </section>)}</div>}
  </div>;
}

export function AdmissionForm({ record, busy, onSave }: {
  record: AdmissionRecord | null;
  busy: boolean;
  onSave: (payload: AdmissionInput) => Promise<void>;
}) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const score = Number(form.get("score"));
    const scale = Number(form.get("scale"));
    if (!Number.isFinite(score) || !Number.isFinite(scale) || score < 0 || scale <= 0 || score > scale) {
      setError("점수는 0점 이상, 입력한 만점 이하여야 합니다.");
      return;
    }
    try {
      await onSave({
        ...(record ? { id: record.id, revision: record.revision ?? 1 } : {}),
        university: String(form.get("university") ?? "").trim(),
        department: String(form.get("department") ?? "").trim(),
        academicYear: Number(form.get("academicYear")),
        examKey: String(form.get("examKey") ?? "").trim(),
        scale,
        score,
        metric: form.get("metric") as AdmissionRecord["metric"],
        pointType: form.get("pointType") as AdmissionRecord["pointType"],
        sourceUrl: String(form.get("sourceUrl") ?? "").trim(),
        sourceLabel: String(form.get("sourceLabel") ?? "").trim(),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "입시 자료를 저장하지 못했습니다.");
    }
  }

  return <form onSubmit={submit} className="stack">
    <div className="form-grid">
      <label className="field">대학 이름<input name="university" required maxLength={100} defaultValue={record?.university} placeholder="자료에 적힌 대학 이름" /></label>
      <label className="field">모집단위<input name="department" required maxLength={150} defaultValue={record?.department} placeholder="학과 또는 모집단위" /></label>
      <label className="field">학년도<input name="academicYear" type="number" min={2000} max={2100} step={1} required defaultValue={record?.academicYear ?? new Date().getFullYear()} /></label>
      <label className="field">시험 비교 기준<input name="examKey" required maxLength={150} defaultValue={record?.examKey} placeholder="동일 문항군·환산 기준 식별자" /><small>문항에 입력한 시험 기준과 같아야 비교됩니다. 출제·환산 기준이 달라지면 별도 기준으로 등록하세요.</small></label>
      <label className="field">점수 종류<select name="pointType" defaultValue={record?.pointType ?? "essay"}><option value="essay">논술 점수</option><option value="total">전형 총점</option><option value="school">학생부 성적</option></select></label>
      <label className="field">성적 지표<select name="metric" defaultValue={record?.metric ?? "minimum"}><option value="minimum">최저점</option><option value="average">평균점</option><option value="percentile70">70% 지점 성적</option></select></label>
      <label className="field">점수<input name="score" type="number" min={0} max={10000} step="any" required defaultValue={record?.score} aria-invalid={Boolean(error)} aria-describedby={error ? "admission-score-error" : undefined} /></label>
      <label className="field">만점<input name="scale" type="number" min={1} max={10000} step="any" required defaultValue={record?.scale ?? 100} /></label>
      <label className="field wide">자료 출처 이름<input name="sourceLabel" required maxLength={500} defaultValue={record?.sourceLabel} placeholder="자료 제목 · 발표 기관" /></label>
      <label className="field wide">원문 출처 URL<input name="sourceUrl" type="url" required maxLength={2000} defaultValue={record?.sourceUrl} placeholder="https://" /></label>
    </div>
    {error && <p id="admission-score-error" className="form-error" role="alert">{error}</p>}
    <p className="muted">추천과 예측에는 논술 최저점만 사용합니다. 같은 시험과 환산 기준의 전체 논술 점수를 입력하고, 출처에서 확인되지 않은 합격선은 등록하지 마세요.</p>
    <button className="button primary" type="submit" disabled={busy}>{busy ? "저장 중…" : record ? "자료 수정 저장" : "입시 자료 등록"}</button>
  </form>;
}

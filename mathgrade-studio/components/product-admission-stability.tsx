"use client";

import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { evaluateAdmissionStability, minimumStabilityPapers, minimumStabilityYears } from "@/lib/admission-stability";
import type { AdmissionHistory, AdmissionHistoryPaper } from "@/lib/product-admission-types";
import { api } from "@/lib/client/api";
import { examDifficultyGuidance } from "@/lib/exam-difficulty";

const statusLabels = {
  stable: "안정라인 기준 충족",
  below: "안정라인 기준 미충족",
  insufficient: "자료 부족",
};

function demoSeries(paper?: AdmissionHistoryPaper): AdmissionHistoryPaper[] {
  if (!paper) return [];
  if (paper.submissionId !== "sub-a") return [paper];
  return [
    { ...paper, academicYear: 2024, difficulty: "standard", total: 79, cutoff: 73, maximum: 100 },
    { ...paper, academicYear: 2025, difficulty: "standard", total: 77, cutoff: 74, maximum: 100 },
    paper,
  ];
}

export function ProductAdmissionStability({ submissionId, demo, demoPaper, refreshKey }: {
  submissionId: string;
  demo: boolean;
  demoPaper?: AdmissionHistoryPaper;
  refreshKey: number;
}) {
  const [papers, setPapers] = useState<AdmissionHistoryPaper[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (demo) return;
    let active = true;
    setError("");
    api<AdmissionHistory>(`/api/product/submissions/${encodeURIComponent(submissionId)}/admission-history`)
      .then(response => { if (active) setPapers(response.papers); })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "기출 결과를 불러오지 못했어요."); });
    return () => { active = false; };
  }, [demo, refreshKey, retry, submissionId]);

  const effectivePapers = demo ? demoSeries(demoPaper) : papers;
  const summaries = effectivePapers ? evaluateAdmissionStability(effectivePapers) : [];
  return <section className="p-admission-stability" aria-labelledby="admission-stability-heading">
    <div className="p-line-heading">
      <BarChart3 size={22} aria-hidden="true" />
      <div>
        <h2 id="admission-stability-heading">기출 첨삭 기반 안정라인</h2>
        <p className="p-help">같은 대학·전형·모집단위의 기출을 모아 각 시험의 공개 최저점과 비교합니다.</p>
      </div>
    </div>
    <p className="p-note">난이도가 지정된 기출 {minimumStabilityYears}개 학년도·{minimumStabilityPapers}회 이상, 비교한 모든 회차에서 최저점 초과, 그중 심화 1회 이상 초과를 기준으로 봅니다. 같은 기출은 최근 확정 점수 1개만 반영합니다.</p>
    {demo && <p className="p-help">가상 대학의 성적과 최저점을 사용한 체험 예시입니다.</p>}
    {error ? <div className="p-empty">
      <p className="p-error" role="alert">{error}</p>
      <button className="button secondary small" type="button" onClick={() => setRetry(value => value + 1)}>다시 불러오기</button>
    </div> : !effectivePapers ? <p role="status" className="p-help">기출 첨삭 기록을 불러오는 중…</p>
      : !summaries.length ? <p className="p-help">비교할 기출이 아직 없습니다. 해당 기출 성적표에 공개 최저점을 연결하면 여기에 쌓입니다.</p>
      : <ul className="p-line-results" aria-label="대학별 안정라인 기준 비교">
        {summaries.map(summary => <li className="p-line-result" key={JSON.stringify([summary.university, summary.department])}>
          <div className="p-line-result-head">
            <div>
              <h3>{summary.university} <span>· {summary.department}</span></h3>
              <p className="p-help">난이도 지정 {summary.yearCount}개 학년도·{summary.difficultyCount}회 · 심화 초과 {summary.advancedAbove}회</p>
            </div>
            <span className={`p-badge ${summary.status === "stable" ? "green" : "amber"}`}>{statusLabels[summary.status]}</span>
          </div>
          {summary.conflicts > 0 && <p className="p-help">같은 기출에 서로 다른 공개 최저점 또는 만점이 등록되어 있습니다. 해당 자료의 출처와 점수를 확인해 주세요.</p>}
          {summary.papers.length > 0 && <details className="p-admission-evidence">
            <summary>회차별 점수와 출처</summary>
            <ul>
              {summary.papers.map(paper => <li key={JSON.stringify([paper.academicYear, paper.examKey])}>
                <div><strong>{paper.academicYear}학년도 · {paper.examKey}</strong><p className="p-help">{paper.difficulty ? examDifficultyGuidance[paper.difficulty]?.label ?? "난이도 미지정" : "난이도 미지정"}</p></div>
                <div>첨삭 {paper.total} / {paper.maximum}점 · 최저점 {paper.cutoff}점 <strong>({paper.gap > 0 ? "+" : ""}{paper.gap}점)</strong></div>
                {demo ? <span className="p-help">{paper.sourceLabel}</span> : <a className="p-line-source" href={paper.sourceUrl} target="_blank" rel="noopener noreferrer">{paper.sourceLabel}</a>}
              </li>)}
            </ul>
          </details>}
        </li>)}
      </ul>}
    <p className="p-help">과거 기출 성적을 바탕으로 한 학습 지표입니다. 지원할 때는 해당 학년도 모집요강과 수능 최저를 함께 확인하세요.</p>
  </section>;
}

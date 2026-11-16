"use client";

import { useState, type FormEvent } from "react";
import { BookOpen, Coins, Download, ExternalLink, Eye, FilePlus2, Search, ShieldCheck } from "lucide-react";
import type { PointEvent, Question, SharedQuestion } from "@/lib/types";

export type PublishInput = {
  questionId: string;
  revision: number;
  contributorName: string;
  rightsBasis: "own" | "permission";
  rightsNote: string;
  rightsConfirmed: true;
  shareConfirmed: true;
};

type Props = {
  questions: Question[];
  sharedQuestions: SharedQuestion[];
  points: { balance: number; events: PointEvent[] };
  userId: string;
  busy: boolean;
  demo: boolean;
  onPublish: (input: PublishInput) => Promise<void>;
  onWithdraw: (id: string) => Promise<void>;
  onImport: (id: string) => Promise<void>;
};

const dateText = (value: string) => new Intl.DateTimeFormat("ko-KR", {
  year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Seoul",
}).format(new Date(value));

export function CommunityPanel({ questions, sharedQuestions, points, userId, busy, demo, onPublish, onWithdraw, onImport }: Props) {
  const [tab, setTab] = useState<"browse" | "publish" | "points">("browse");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [rightsBasis, setRightsBasis] = useState<"own" | "permission">("own");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const disabled = busy || working;
  const eligible = questions.filter((question) => question.ownerId === userId && !question.originSharedId && !question.rubricPending && question.criteria.length > 0 && !sharedQuestions.some(shared => shared.sourceQuestionId === question.id));
  const selected = eligible.find((question) => question.id === selectedId) ?? eligible[0];
  const published = sharedQuestions.filter((question) => question.status === "published");
  const visible = sharedQuestions.filter((question) => {
    if (question.status !== "published" && question.contributorId !== userId) return false;
    return `${question.title} ${question.prompt} ${question.university} ${question.contributorName} ${question.sourceLabel}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  });

  async function run(action: () => Promise<void>) {
    setError(""); setWorking(true);
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "요청을 처리하지 못했습니다. 다시 시도해 주세요."); }
    finally { setWorking(false); }
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    await run(async () => {
      if (!selected) throw new Error("공개할 문항을 먼저 등록해 주세요.");
      if (form.get("rightsConfirmed") !== "on" || form.get("shareConfirmed") !== "on") throw new Error("공개할 권한과 공유 내용을 확인해 주세요.");
      const contributorName = String(form.get("contributorName") ?? "").trim();
      const rightsNote = String(form.get("rightsNote") ?? "").trim();
      if (!contributorName) throw new Error("다른 선생님께 표시할 이름을 입력해 주세요.");
      if (rightsBasis === "permission" && !rightsNote) throw new Error("공개와 수업 이용을 허락받은 범위를 입력해 주세요.");
      await onPublish({ questionId: selected.id, revision: selected.revision, contributorName, rightsBasis, rightsNote, rightsConfirmed: true, shareConfirmed: true });
      element.reset(); setRightsBasis("own"); setTab("browse");
    });
  }

  function chooseTab(value: "browse" | "publish" | "points") { setTab(value); setError(""); }

  return <div className="stack">
    <div className="two-column">
      <section className="card card-padding">
        <div className="card-title-row"><div><p className="eyebrow">TEACHER CONTRIBUTION</p><h2>함께 쌓는 수학 문항</h2></div><BookOpen size={24} color="#9b78b8" /></div>
        <p className="muted" style={{ marginTop: 12 }}>선생님이 공개를 선택한 문제와 채점기준을 다른 선생님이 자신의 문항함으로 가져가 사용할 수 있어요.</p>
        <p className="muted" style={{ marginTop: 8 }}>학생의 제출 문제·답안·질문은 비공개 보관됩니다. 이 공간에는 선생님이 아래에서 확인한 내용만 게시됩니다.</p>
      </section>
      <section className="card card-padding quota-card">
        <div className="card-title-row"><h3>{demo ? "예시 기여 포인트" : "나의 기여 포인트"}</h3><Coins size={22} /></div>
        <strong>{points.balance.toLocaleString("ko-KR")}<small> P</small></strong>
        <p className="muted">새 공개 문항 1건당 10P · 동일 내용은 중복 적립되지 않습니다.</p>
        <p className="muted" style={{ marginTop: 7 }}>현재 기여 기록용입니다. 현금 전환·결제 할인 기능은 제공하지 않습니다.</p>
      </section>
    </div>

    <div className="filter-row" aria-label="공유 문항 메뉴">
      <button className={`filter-tab ${tab === "browse" ? "active" : ""}`} onClick={() => chooseTab("browse")}>공유 문항 {published.length}</button>
      <button className={`filter-tab ${tab === "publish" ? "active" : ""}`} onClick={() => chooseTab("publish")}>문항 공개하기</button>
      <button className={`filter-tab ${tab === "points" ? "active" : ""}`} onClick={() => chooseTab("points")}>포인트 내역</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}

    {tab === "browse" && <>
      <div className="search-box"><Search aria-hidden="true" /><input aria-label="공유 문항 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="문항, 출처, 선생님 이름으로 검색" /></div>
      <div className="stack">{visible.map((question) => <article className="card card-padding" key={question.id}>
        <div className="card-title-row"><div><div className="source-line"><span>{question.contributorName}</span>{question.university && <span>{question.university}</span>}{question.academicYear && <span>{question.academicYear}학년도</span>}<span>{question.criteria.reduce((sum, item) => sum + item.max, 0)}점</span></div><h3>{question.title}</h3></div><span className={`status ${question.status === "published" ? "approved" : "pending"}`}>{question.status === "published" ? "공개 중" : "공개 중지"}</span></div>
        <div className="question-box" style={{ marginTop: 15 }}><p>{question.prompt}</p></div>
        <details style={{ marginTop: 12 }}><summary style={{ cursor: "pointer", color: "#74558d", fontSize: 12 }}>채점기준 {question.criteria.length}개 보기</summary><div className="stack" style={{ marginTop: 12 }}>{question.criteria.map((criterion) => <div key={criterion.id} className="question-box"><strong>{criterion.title} · {criterion.max}점</strong><p>{criterion.description}</p></div>)}</div></details>
        <div style={{ marginTop: 13 }}>{question.sourceUrl ? <a className="source-link" href={question.sourceUrl} target="_blank" rel="noreferrer">{question.sourceLabel}<ExternalLink /></a> : <p className="source-link">{question.sourceLabel}</p>}<p className="muted">{question.rightsBasis === "own" ? "직접 제작으로 등록" : "이용 허락을 받아 등록"} · {dateText(question.createdAt)}</p>{question.rightsNote && <p className="muted" style={{ marginTop: 5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{question.rightsNote}</p>}</div>
        <div className="actions" style={{ marginTop: 16 }}>{question.status === "published" && <button className="button primary small" disabled={disabled} onClick={() => run(() => onImport(question.id))}><Download />내 문항함으로 가져오기</button>}{question.status === "published" && question.contributorId === userId && <button className="button secondary small" disabled={disabled} onClick={() => run(() => onWithdraw(question.id))}>공개 중지</button>}</div>
        {question.status === "withdrawn" && <p className="muted" style={{ marginTop: 10 }}>새로운 열람과 가져오기가 중지됐습니다. 이미 가져간 문항은 회수되지 않습니다.</p>}
      </article>)}</div>
      {!visible.length && <section className="card"><div className="empty"><BookOpen /><h3>{query ? "검색 결과가 없습니다" : "첫 공유 문항을 기다리고 있어요"}</h3><p>{query ? "다른 문항 이름이나 출처로 검색해 보세요." : "직접 만든 문제와 채점기준을 공개하고 기여 포인트를 받아보세요."}</p>{!query && <button className="button primary" onClick={() => chooseTab("publish")}><FilePlus2 />문항 공개하기</button>}</div></section>}
    </>}

    {tab === "publish" && <section className="card card-padding">
      <div className="card-title-row"><div><h2>공개할 내용을 확인하세요</h2><p className="muted" style={{ marginTop: 6 }}>다른 선생님에게 보여줄 문제·채점기준·출처와 표시 이름을 확인합니다.</p></div><Eye size={22} color="#9b78b8" /></div>
      {!eligible.length ? <div className="empty"><FilePlus2 /><h3>공개할 문항이 없습니다</h3><p>문항 · 채점기준 메뉴에서 본인이 공유할 수 있는 문항을 먼저 등록하세요. 가져온 공유 문항과 기준 미등록 문항은 기여 대상으로 올릴 수 없습니다.</p></div> : <form onSubmit={publish} className="form-stack" style={{ marginTop: 20 }}>
        <label className="field">공개할 내 문항<select className="text-input" value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)} disabled={disabled}>{eligible.map((question) => <option key={question.id} value={question.id}>{question.title}</option>)}</select></label>
        {selected && <section className="question-box" aria-label="공개 내용 미리보기"><strong>공개 내용 미리보기</strong><h3 style={{ marginBottom: 8 }}>{selected.title}</h3><p>{selected.prompt}</p><div className="stack" style={{ marginTop: 12 }}>{selected.criteria.map((criterion) => <div key={criterion.id}><strong>{criterion.title} · {criterion.max}점</strong><p>{criterion.description}</p></div>)}</div><p style={{ marginTop: 12 }}>출처: {selected.sourceLabel}</p>{selected.sourceUrl && <a className="source-link" href={selected.sourceUrl} target="_blank" rel="noreferrer">{selected.sourceUrl}<ExternalLink /></a>}{selected.university && <p>{selected.university}{selected.academicYear ? ` · ${selected.academicYear}학년도` : ""}</p>}</section>}
        <p className="muted">문제 전체를 읽을 수 있게 본문을 등록해 주세요. 비공개 메모, 원본 첨부파일, 학생 답안과 추가 질문은 공유되지 않습니다.</p>
        <div className="form-grid"><label className="field">공개 표시 이름<input className="text-input" name="contributorName" placeholder="예: 이룸수학 연구실" required maxLength={80} disabled={disabled} /></label><label className="field">공개할 수 있는 근거<select className="text-input" value={rightsBasis} onChange={(event) => setRightsBasis(event.target.value as "own" | "permission")} disabled={disabled}><option value="own">내가 직접 제작한 문항</option><option value="permission">권리자의 이용 허락을 받은 문항</option></select></label></div>
        <label className="field">{rightsBasis === "permission" ? "허락받은 이용 범위 (필수)" : "공개 이용 안내 (선택)"}<textarea className="text-input" name="rightsNote" rows={3} maxLength={2000} required={rightsBasis === "permission"} disabled={disabled} placeholder={rightsBasis === "permission" ? "권리자, 허락받은 공개·수업 이용 범위와 확인 가능한 근거를 적어 주세요. 이 내용도 공개됩니다." : "다른 선생님에게 알려줄 출제 의도나 이용 범위를 적어 주세요. 이 내용도 공개됩니다."} /></label>
        <div className="state-callout"><ShieldCheck size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} />출처 표시와 공개할 권한을 함께 확인하세요. 기출문항을 보유하거나 학생에게 제출받았다는 이유만으로 공개할 수 있는 것은 아닙니다.</div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12, lineHeight: 1.7, color: "#665472" }}><input type="checkbox" name="rightsConfirmed" required disabled={disabled} style={{ marginTop: 4, flexShrink: 0 }} /><span>문제와 채점기준을 공개하고 다른 선생님이 가져가 수업에 이용하도록 허락할 권한이 있습니다.</span></label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12, lineHeight: 1.7, color: "#665472" }}><input type="checkbox" name="shareConfirmed" required disabled={disabled} style={{ marginTop: 4, flexShrink: 0 }} /><span>위 미리보기와 표시 이름·이용 안내를 다른 선생님에게 공개하는 데 동의합니다. 학생 개인정보는 포함하지 않았습니다.</span></label>
        <div className="actions"><button className="button primary" disabled={disabled} type="submit"><FilePlus2 />{disabled ? "처리 중…" : "확인한 내용 공개하기"}</button><p className="muted">새 문항 공개 시 10P · 중복 게시와 가져온 문항은 추가 적립 제외</p></div>
      </form>}
    </section>}

    {tab === "points" && <section className="card card-padding"><h2>기여 포인트 내역</h2><p className="muted" style={{ margin: "8px 0 18px" }}>공개 기여에 대한 적립 기록입니다. {demo ? "체험 중 변경한 내역은 이 화면에서만 유지됩니다." : "적립 내역은 계정에 저장됩니다."}</p>{points.events.length ? <div className="table-scroll"><table><thead><tr><th>날짜</th><th>내용</th><th>포인트</th></tr></thead><tbody>{points.events.map((event) => <tr key={event.id}><td>{dateText(event.createdAt)}</td><td>{event.reason}</td><td><strong>{event.amount > 0 ? "+" : ""}{event.amount}P</strong></td></tr>)}</tbody></table></div> : <div className="empty"><Coins /><h3>아직 적립 내역이 없어요</h3><p>공유할 수 있는 새 문항을 공개하면 기여 포인트가 기록됩니다.</p></div>}</section>}
  </div>;
}

"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, Clock3, Download, FileText, History, MessageSquare, Plus, RefreshCw, Send, Sparkles, Trash2 } from "lucide-react";
import type { ExamResult, FeedbackVersion, ItemFeedback, ProductState, SubmissionDetail } from "@/lib/product-types";
import { MaterialEditor } from "./product-materials";
import { mergeMessages, startMessagePolling, type MessagePage } from "@/lib/client/product-chat";
import { roleNames, type ProductAction } from "./product-forms";

export const formatDate = (date: string) => new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(date));
export function resultStatus(detail: SubmissionDetail["submission"]) {
  if (detail.latestVersion&&(detail.latestVersion.materialVersion??1)!==(detail.materialVersion??1)) return "자료 수정 · 이전 결과 보존";
  if (detail.latestVersion?.teacherReviewed && detail.latestVersion.published) return "선생님 검토 완료";
  if (detail.latestVersion?.authorType === "ai" && detail.latestVersion.published) return "AI 결과 · 선생님 검토 전";
  if (detail.latestVersion) return "선생님 검토 중";
  return detail.processing === "not_configured" ? "AI 연결 대기" : detail.processing === "processing" ? "AI 첨삭 중" : "첨삭 대기";
}
const failureText = (failure: unknown) => failure instanceof Error ? failure.message : "처리하지 못했습니다. 다시 시도해 주세요.";

function ResultView({ version }: { version: FeedbackVersion }) {
  const result = version.result;
  return <div className="p-result">
    <div className="p-scorecard"><div><span className="p-eyebrow">EXAM REPORT</span><h2>시험 성적표</h2><p>{version.teacherReviewed ? "선생님 검토 완료" : version.authorType === "ai" ? "AI 첨삭 결과 · 선생님 검토 전" : "선생님 검토 초안 · 학생 비공개"}</p></div><div className="p-bigscore">{result.total}<small>/ {result.maximum}</small></div></div>
    <div className="p-score-grid">{result.items.map(item => <div key={item.itemId}><span>{item.label}</span><strong>{item.score}<small> / {item.maxScore}</small></strong><div className="p-progress"><i style={{ width: `${Math.min(100, item.maxScore ? item.score / item.maxScore * 100 : 0)}%` }} /></div></div>)}</div>
    <div className="p-summary"><h3>시험 총평</h3><p>{result.summary}</p></div>
    <p className="p-help">평가 근거: {result.basis === "provided" ? "등록된 시험별 평가 자료" : "일반 평가 기준"} · 대학의 공식 합격 판정이 아닙니다.</p>
    {!!result.uncertainties.length && <div className="p-note p-warning"><strong>판독·판단 확인 필요</strong><ul>{result.uncertainties.map((u, i) => <li key={i}>{u}</li>)}</ul></div>}
    {result.items.map(item => <details className="p-feedback-item" key={item.itemId} open><summary><span>{item.label}</span><strong>{item.score} / {item.maxScore}점</strong><ChevronDown size={16} /></summary><dl><dt>평가 근거</dt><dd>{item.evidence || "별도 근거가 없습니다."}</dd><dt>개선 방향</dt><dd>{item.feedback || "추가 피드백이 없습니다."}</dd>{item.solution && <><dt>풀이 검토</dt><dd>{item.solution}</dd></>}{item.uncertainty && <><dt>확인할 부분</dt><dd className="p-warning-text">{item.uncertainty}</dd></>}</dl></details>)}
    {result.questionResponse && <section className="p-answer-box"><h3><MessageSquare size={16} /> 제출 질문에 대한 답변</h3><p>{result.questionResponse}</p></section>}
  </div>;
}

type EditableItem = Omit<ItemFeedback, "score" | "maxScore"> & { score: string; maxScore: string };
function ReviewEditor({ detail, save }: { detail: SubmissionDetail; save: (result: ExamResult, publish: boolean, expectedRevision: number) => Promise<void> }) {
  const [baseRevision]=useState(detail.submission.revision);
  const current = (detail.submission.latestVersion?.materialVersion??1)===(detail.submission.materialVersion??1) ? detail.submission.latestVersion?.result : undefined;
  const fixedStructure = detail.submission.exam.items.length > 0;
  const hasProvidedCriteria = detail.submission.exam.items.some(i => i.criteria.trim()) || detail.submission.exam.files.some(f => f.role === "rubric");
  const initialItems = current?.items ?? detail.submission.exam.items.map(item => ({ itemId: item.id, label: item.label, score: 0, maxScore: item.maxScore, evidence: "", feedback: "", solution: "", uncertainty: "" }));
  const [items, setItems] = useState<EditableItem[]>(initialItems.map(i => ({ ...i, score: String(i.score), maxScore: String(i.maxScore) })));
  const [summary, setSummary] = useState(current?.summary ?? ""); const [response, setResponse] = useState(current?.questionResponse ?? "");
  const [basis, setBasis] = useState<"general" | "provided">(current?.basis ?? (hasProvidedCriteria ? "provided" : "general"));
  const [uncertainties, setUncertainties] = useState(current?.uncertainties.join("\n") ?? "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  function change(index: number, field: keyof EditableItem, value: string) { setItems(items.map((item, i) => i === index ? { ...item, [field]: value } : item)); }
  async function submit(publish: boolean) { setError(""); setBusy(true); try {
    if (!items.length) throw new Error("문항별 평가를 한 개 이상 입력하세요.");
    if (items.some(i => !i.label.trim() || i.score === "" || i.maxScore === "" || !Number.isFinite(Number(i.score)) || !Number.isFinite(Number(i.maxScore)) || Number(i.score) < 0 || Number(i.maxScore) <= 0 || Number(i.score) > Number(i.maxScore))) throw new Error("모든 문항 점수를 0점 이상, 배점 이하로 입력하세요.");
    if (publish && (!summary.trim() || items.some(i => !i.evidence.trim() || !i.feedback.trim()))) throw new Error("확정하려면 총평과 각 문항의 평가 근거·피드백을 입력하세요.");
    if (publish && detail.submission.question.trim() && !response.trim()) throw new Error("학생이 제출한 추가 질문에 답변한 뒤 공개하세요.");
    const parsed = items.map(i => ({ ...i, score: Number(i.score), maxScore: Number(i.maxScore) }));
    const parentIds = new Set(detail.submission.exam.items.map(item => item.parentId).filter(Boolean));
    const leaves = parsed.filter(item => !parentIds.has(item.itemId));
    await save({ items: parsed, total: Number(leaves.reduce((sum, i) => sum + i.score, 0).toFixed(2)), maximum: Number(leaves.reduce((sum, i) => sum + i.maxScore, 0).toFixed(2)), summary, questionResponse: response, basis, uncertainties: uncertainties.split("\n").map(s => s.trim()).filter(Boolean) }, publish, baseRevision);
  } catch (error) { setError(failureText(error)); } finally { setBusy(false); } }
  return <div className="p-form"><p className="p-note">이전 AI 결과와 수정 이력은 보존됩니다. 등록된 문항 구조와 배점은 이 시험 기록에서 유지됩니다. 저장할 때마다 새 버전이 만들어집니다.</p>
    <div className="p-section-line"><h3>문항별 평가</h3><button className="button secondary small" disabled={fixedStructure} onClick={() => setItems([...items, { itemId: crypto.randomUUID(), label: `${items.length + 1}번`, score: "", maxScore: "", evidence: "", feedback: "", solution: "", uncertainty: "" }])}><Plus /> 문항 추가</button></div>
    {items.map((item, i) => <div className="p-item-edit" key={item.itemId}><div className="p-review-fields"><label>문항 이름<input readOnly={fixedStructure} value={item.label} onChange={e => change(i, "label", e.target.value)} /></label><label>점수<input type="number" min={0} step="0.1" max={Number(item.maxScore) || undefined} value={item.score} onChange={e => change(i, "score", e.target.value)} /></label><label>배점<input readOnly={fixedStructure} type="number" min="0.1" step="0.1" value={item.maxScore} onChange={e => change(i, "maxScore", e.target.value)} /></label></div><label>평가 근거<textarea rows={2} value={item.evidence} onChange={e => change(i, "evidence", e.target.value)} /></label><label>피드백 · 개선 방향<textarea rows={2} value={item.feedback} onChange={e => change(i, "feedback", e.target.value)} /></label><details><summary>풀이 검토 · 판독 불확실성 추가</summary><label>풀이와 정답 검토<textarea rows={2} value={item.solution} onChange={e => change(i, "solution", e.target.value)} /></label><label>판독·판단 불확실성<input value={item.uncertainty} onChange={e => change(i, "uncertainty", e.target.value)} /></label></details><button type="button" disabled={fixedStructure} className="button ghost small" onClick={() => setItems(items.filter((_, index) => i !== index))}><Trash2 size={13} /> 문항 삭제</button></div>)}
    <label>시험 총평<textarea rows={4} value={summary} onChange={e => setSummary(e.target.value)} /></label>{detail.submission.question && <div className="p-question"><strong>학생의 추가 질문</strong><p>{detail.submission.question}</p></div>}<label>추가 질문에 대한 답변<textarea rows={3} value={response} onChange={e => setResponse(e.target.value)} /></label><label>평가 기준<select value={basis} onChange={e => setBasis(e.target.value as "general" | "provided")}><option value="general">일반 평가 기준</option><option value="provided" disabled={!hasProvidedCriteria}>등록된 시험별 평가 자료</option></select></label><label>시험 전체 확인 사항 <span className="p-optional">한 줄에 하나씩</span><textarea rows={2} value={uncertainties} onChange={e => setUncertainties(e.target.value)} /></label>
    {error && <p className="p-error" role="alert">{error}</p>}<div className="actions"><button className="button secondary" disabled={busy} onClick={() => void submit(false)}>검토 초안 저장</button><button className="button primary" disabled={busy} onClick={() => void submit(true)}><CheckCircle2 /> 선생님 확정 · 학생 공개</button></div>
  </div>;
}

export function ExamDetail({ detail, data, action, refresh, onBack, onPdf, demo, loadMessages }: { detail: SubmissionDetail; data: ProductState; action: ProductAction; refresh: () => Promise<void>; onBack: () => void; onPdf: () => Promise<void>; demo: boolean; loadMessages:(id:string,cursor:string,signal:AbortSignal)=>Promise<MessagePage> }) {
  const { submission, versions } = detail;
  const [messages,setMessages]=useState(detail.messages),[chatStatus,setChatStatus]=useState("대화 연결 중"),[reviewEpoch,setReviewEpoch]=useState(0);
  const pendingMessage=useRef<{text:string;itemId:string;clientRequestId:string}|null>(null),chatLock=useRef(false);
  useEffect(()=>{setMessages(current=>mergeMessages(current,detail.messages));},[detail.messages]);
  useEffect(()=>{
    if(!submission.classId||submission.legacyId)return;
    const poller=startMessagePolling({load:(cursor,signal)=>loadMessages(submission.id,cursor,signal),receive:incoming=>setMessages(current=>mergeMessages(current,incoming)),status:setChatStatus,visible:()=>document.visibilityState!=="hidden"});
    const wake=()=>poller.wake();
    window.addEventListener("online",wake);document.addEventListener("visibilitychange",wake);
    return ()=>{poller.stop();window.removeEventListener("online",wake);document.removeEventListener("visibilitychange",wake);};
  },[submission.id,submission.classId,submission.legacyId,loadMessages]);
  const teacher = data.profile?.accountType === "teacher" && !!submission.classId && data.members.some(m=>m.classId===submission.classId&&m.userId===data.user?.id&&m.role==="teacher") && !submission.legacyId;
  const [tab, setTab] = useState<"report" | "files" | "review" | "history">("report");
  const [historical, setHistorical] = useState<string | null>(null);
  const [text, setText] = useState(""); const [itemId, setItemId] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const canEdit=!submission.legacyId&&(!submission.classId||(!data.classes.find(c=>c.id===submission.classId)?.archivedAt&&data.members.some(m=>m.classId===submission.classId&&m.userId===data.user?.id)))&&!data.assignments.find(a=>a.id===submission.assignmentId)?.cancelledAt;
  const visibleVersion = versions.find(v => v.id === historical) ?? submission.latestVersion;
  async function guarded(operation: () => Promise<void>) { setError(""); setBusy(true); try { await operation(); } catch (failure) { setError(failureText(failure)); } finally { setBusy(false); } }
  async function save(result: ExamResult, publish: boolean, expectedRevision:number) { try { await action(`submissions/${submission.id}/review`, { revision: expectedRevision, result, publish }); await refresh(); setHistorical(null); setTab("report"); } catch (error) { if ((error as { code?: string }).code === "REVISION_CONFLICT") { await refresh(); setError("다른 창에서 변경된 최신 결과를 불러왔습니다. 작성 중인 첨삭은 유지했습니다. 최신 결과와 비교한 뒤 편집을 다시 시작하세요."); } throw error; } }
  async function chat(e:FormEvent) {
    e.preventDefault();if(chatLock.current)return;chatLock.current=true;
    await guarded(async()=>{
      if(!text.trim())throw new Error("질문이나 답변을 입력하세요.");
      if(pendingMessage.current?.text!==text||pendingMessage.current?.itemId!==itemId)pendingMessage.current={text,itemId,clientRequestId:crypto.randomUUID()};
      const result=await action(`submissions/${submission.id}/messages`,{...pendingMessage.current,itemId:itemId||null});
      if(result.message)setMessages(current=>mergeMessages(current,[result.message]));
      pendingMessage.current=null;setText("");
    });
    chatLock.current=false;
  }
  const files = [...submission.exam.files, ...submission.files].filter((f, i, all) => all.findIndex(x => x.id === f.id) === i).sort((a, b) => a.order - b.order);
  return <div className="p-detail"><button className="button ghost p-back" onClick={onBack}><ArrowLeft size={15} /> 시험 목록</button>
    <div className="p-section-line p-detail-heading"><div><span className="p-eyebrow">{teacher ? `${submission.studentName}의 시험 기록` : "나의 시험 기록"}</span><h1>{submission.exam.title}</h1><p className="page-subtitle">{submission.studentName} · {formatDate(submission.createdAt)} 제출 · {submission.submittedBy === submission.studentId ? "학생 직접 제출" : "선생님 대리 제출"}</p></div><div className="actions"><button className="button secondary" disabled={busy} onClick={() => void guarded(refresh)} aria-label="시험 기록 새로고침"><RefreshCw size={15} /></button><button className="button secondary" disabled={busy || !submission.latestVersion} onClick={() => void guarded(onPdf)}><Download /> PDF · 인쇄</button></div></div>
    <div className="p-status-line"><span className={`p-badge ${submission.reviewStatus === "reviewed" ? "green" : "amber"}`}>{resultStatus(submission)}</span><span>자료 v{submission.materialVersion??1} · 결과 v{submission.latestVersion?.version ?? 0}</span><span>{submission.visibility === "visible" ? "학생 공개" : "학생 결과 비공개"}</span>{demo && <span className="p-badge">가상 체험 데이터</span>}</div>
    {error && <p className="p-error" role="alert">{error}</p>}{submission.legacyId && <p className="p-note">이전 개별 문항 기록을 시험 한 건으로 연결했습니다. 원본·확정 결과를 보존하는 읽기 전용 기록입니다.</p>}
    <div className="p-detail-grid"><section className="p-card"><div className="p-tabs">{([["report", "성적표"], ["files", "제출 자료"], ...(teacher ? [["review", "선생님 첨삭"]] : []), ["history", "변경 이력"]] as [typeof tab, string][]).map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</div><div className="p-card-body">
      {tab === "report" && <>{historical && <div className="p-note p-warning">과거 버전 v{visibleVersion?.version}을 보고 있습니다.<button className="button ghost small" onClick={() => setHistorical(null)}>최신 결과 보기</button></div>}{visibleVersion ? <>{(visibleVersion.materialVersion??1)!==(submission.materialVersion??1)&&<p className="p-note p-warning">이 결과는 자료 v{visibleVersion.materialVersion??1}을 기준으로 작성되었습니다. 현재 제출은 자료 v{submission.materialVersion??1}입니다.</p>}<ResultView version={visibleVersion} /></> : <div className="p-empty"><Sparkles size={30} /><h3>아직 첨삭 결과가 없습니다</h3><p>{data.capabilities.aiConfigured ? "문제와 답안, 추가 질문을 함께 분석합니다." : "파일은 안전하게 저장되었습니다. AI 연결 후 첨삭을 요청할 수 있습니다."}</p><button className="button primary" disabled={busy || !data.capabilities.aiConfigured || !!submission.legacyId} onClick={() => void guarded(async () => { await action(`submissions/${submission.id}/analyze`, { revision: submission.revision }); await refresh(); })}>AI 첨삭 요청</button>{!data.capabilities.aiConfigured && <span className="p-help">AI 미연결 · 횟수 차감 없음</span>}{teacher && <button className="button secondary" onClick={() => setTab("review")}>선생님 직접 검토</button>}</div>}{submission.question && <section className="p-question"><h3>최초 제출 시 추가 질문</h3><p>{submission.question}</p></section>}</>}
      {tab === "files" && <>{canEdit&&<MaterialEditor key={submission.materialVersion??1} submission={submission} action={action} done={refresh}/>}<h3>문제와 손글씨 답안</h3><p className="p-help">파일별 분류와 페이지 순서를 함께 보관합니다.</p>{submission.exam.legacyPrompt && <section className="p-legacy-text"><h3>이전 문제 본문</h3><p style={{whiteSpace:"pre-wrap"}}>{submission.exam.legacyPrompt}</p></section>}{submission.legacyAnswer && <section className="p-legacy-text"><h3>이전 학생 풀이</h3><p style={{whiteSpace:"pre-wrap"}}>{submission.legacyAnswer}</p></section>}{!files.length ? <div className="p-empty"><FileText /><p>{demo ? "가상 예시에는 원본 파일을 첨부하지 않았습니다. 새 제출에서 실제 파일 흐름을 체험하세요." : "이전 기록에 연결된 원본 파일이 없습니다."}</p></div> : files.map(file => <div className="p-attached" key={file.id}><div className="p-section-line"><strong>{file.order + 1}. {file.name}</strong><span className="p-badge">{roleNames[file.role]}</span></div>{file.itemId && <p className="p-help">관련 문항: {submission.exam.items.find(i => i.id === file.itemId)?.label ?? file.itemId}</p>}{file.type.startsWith("image/") && <img src={file.url} alt={`${roleNames[file.role]} ${file.name}`} loading="lazy" />}<a className="button secondary small" href={file.url} target="_blank" rel="noreferrer">원본 열기 ↗</a></div>)}<p className="p-help">출처: {submission.exam.sourceLabel} {submission.exam.sourceUrl && <a href={submission.exam.sourceUrl} target="_blank" rel="noreferrer">출처 확인 ↗</a>}</p></>}
      {tab === "review" && teacher && <>{error&&<button className="button secondary" onClick={()=>{if(window.confirm("작성 중인 초안을 버리고 최신 결과로 편집을 다시 시작할까요?")){setReviewEpoch(v=>v+1);setError("");}}}>최신 결과로 편집 다시 시작</button>}<ReviewEditor key={`${submission.materialVersion??1}:${reviewEpoch}`} detail={detail} save={save}/></>}
      {tab === "history" && <><h3><History size={16} /> 결과 변경 이력</h3><p className="p-help">자료 버전과 이를 기준으로 작성한 AI·선생님 첨삭을 구분해 보관합니다.</p>{detail.materials?.map(material=><details key={material.id} className="p-feedback-item"><summary>자료 v{material.version} · {formatDate(material.createdAt)}</summary><p>{material.question||"추가 질문 없음"}</p>{material.files.map(file=><p key={file.id}><a href={file.url} target="_blank" rel="noreferrer">{file.name} ↗</a></p>)}</details>)}{!versions.length && <p className="p-empty">아직 저장된 결과 버전이 없습니다.</p>}{[...versions].reverse().map(version => <button key={version.id} className="p-history-row" onClick={() => { setHistorical(version.id); setTab("report"); }}><span className="p-history-dot" /><span><strong>v{version.version} · 자료 v{version.materialVersion??1} · {version.authorName}</strong><small>{version.authorType === "ai" ? "AI 최초 첨삭" : "선생님 추가·수정 첨삭"} · {formatDate(version.createdAt)}</small></span><span className="p-badge">{version.published ? version.teacherReviewed ? "검토 완료" : "AI 공개" : "비공개 초안"}</span></button>)}</>}
    </div></section><aside className="p-card p-chat"><div className="p-card-heading"><h2><MessageSquare size={17} /> 시험별 질문 · 답변</h2><p>해당 학생과 담당 선생님만 볼 수 있습니다.</p>{submission.classId&&!submission.legacyId&&<small role="status">{chatStatus}</small>}</div><div className="p-chat-messages">{!submission.classId ? <p className="p-help">개인 학습공간은 담당 선생님과 연결되어 있지 않습니다. 최초 제출 질문은 AI 첨삭 요청에 함께 포함됩니다.</p> : !messages.length ? <div className="p-empty"><MessageSquare /><p>어려웠던 문항에 대해 질문해 보세요.</p></div> : messages.map(message => <div key={message.id} className={`p-message ${message.authorId === data.user?.id ? "mine" : ""}`}><div><strong>{message.authorName}</strong><small>{message.authorRole === "teacher" ? "선생님" : "학생"} · {formatDate(message.createdAt)}</small></div>{message.itemId && <span className="p-message-item">{submission.exam.items.find(i => i.id === message.itemId)?.label ?? submission.latestVersion?.result.items.find(i => i.itemId === message.itemId)?.label ?? "관련 문항"}</span>}<p>{message.text}</p></div>)}</div>{submission.classId && canEdit && <form className="p-chat-form" onSubmit={chat}><label className="p-sr-only" htmlFor="chat-item">관련 문항</label><select id="chat-item" value={itemId} onChange={e => setItemId(e.target.value)}><option value="">시험 전체 질문</option>{(submission.latestVersion?.result.items ?? submission.exam.items.map(i => ({ itemId: i.id, label: i.label }))).map(item => <option key={item.itemId} value={item.itemId}>{item.label}</option>)}</select><label className="p-sr-only" htmlFor="chat-text">질문 또는 답변</label><textarea id="chat-text" required maxLength={5000} rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="이 시험에 대한 질문 또는 답변…" /><button className="button primary" disabled={busy || !text.trim()}><Send size={14} /> 보내기</button></form>}</aside></div>
  </div>;
}

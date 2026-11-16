"use client";
/* Full navigation intentionally resets the isolated demo workspace. */
/* eslint-disable @next/next/no-html-link-for-pages */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, Check, CheckCheck, ChevronRight, ClipboardCheck, Clock3, Download, ExternalLink, FileText, GraduationCap, LayoutDashboard, LogIn, Plus, Search, Send, Settings2, Users, X } from "lucide-react";
import type { Academy, AdmissionRecord, Assignment, Criterion, Question, Review, SharedQuestion, Submission, WorkspaceState } from "@/lib/types";
import { api, ApiError } from "@/lib/client/api";
import { createDemoState } from "@/lib/client/demo";
import { Admissions, Recommendations, AdmissionForm } from "@/components/admissions-panels";
import { Metric, AnswerCard, ReviewCard } from "@/components/review-panels";
import { QuestionForm, AssignmentForm, SubmissionForm, type SubmitInput } from "@/components/workspace-forms";
import { CommunityPanel, type PublishInput } from "@/components/community-panel";

type Mode = "teacher" | "student" | "personal";
type View = "review" | "questions" | "academy" | "submit" | "history" | "recommendations" | "admissions" | "community" | "plans";
type ModalName = "academy" | "join" | "question" | "assignment" | "admission" | null;
const viewNames: Record<View, string> = {review:"첨삭 작업대",questions:"문항 · 채점기준",academy:"학원 · 과제",submit:"답안 제출",history:"첨삭 기록",recommendations:"대학 추천",admissions:"입시 기준 자료",community:"공개 문항 · 포인트",plans:"이용 안내"};
const statusNames = {pending:"검토 대기",draft:"초안 작성",approved:"확정 완료"};
const icons: Record<View, typeof BookOpen> = {review:ClipboardCheck,questions:BookOpen,academy:Users,submit:Send,history:FileText,recommendations:GraduationCap,admissions:LayoutDashboard,community:BookOpen,plans:Settings2};
const emptyState: WorkspaceState = {user:null,academies:[],memberships:[],questions:[],assignments:[],submissions:[],admissions:[],usage:{limit:3,used:0,remaining:3,day:""},ai:{configured:false},storageReady:false};
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const maximum = (question: Question) => sum(question.criteria.map((criterion) => criterion.max));
const dateText = (value: string) => new Intl.DateTimeFormat("ko-KR", {month:"short",day:"numeric",timeZone:"Asia/Seoul"}).format(new Date(value));
const makeId = () => crypto.randomUUID();

function Source({ question }: { question: Question }) {
  if (question.sourceUrl) return <a className="source-link" href={question.sourceUrl} target="_blank" rel="noreferrer">{question.sourceLabel || "출처 확인"}<ExternalLink /></a>;
  return question.sourceLabel ? <p className="source-link">{question.sourceLabel}</p> : null;
}

function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="empty"><FileText /><h3>{title}</h3><p>{text}</p>{action}</div>;
}

function Modal({ title, children, onClose, narrow = false }: { title: string; children: ReactNode; onClose: () => void; narrow?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    root?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled]), input, textarea, select, a[href]"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className={`modal ${narrow ? "narrow" : ""}`} ref={ref} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="닫기" onClick={onClose}><X size={18} /></button></div><div className="modal-body">{children}</div></div></div>;
}

export default function FeedbackWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [demo, setDemo] = useState(false);
  const [mode, setMode] = useState<Mode>("teacher");
  const [view, setView] = useState<View>("review");
  const [modal, setModal] = useState<ModalName>(null);
  const [editing, setEditing] = useState<Question | null>(null);
  const [admissionEdit,setAdmissionEdit] = useState<AdmissionRecord|null>(null);
  const [assignmentQuestion, setAssignmentQuestion] = useState<Question | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewFailure, setReviewFailure] = useState<{ id: string; message: string } | null>(null);
  const [message, setMessage] = useState("");
  const [legacy, setLegacy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoRequests = useRef(new Map<string,string>());
  // Only a completed upload with the same content is safe to omit on a retry.
  const completedReferences = useRef(new Set<string>());

  function notify(value: string) {
    setMessage(value);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(""), 4500);
  }

  useEffect(() => {
    let cancelled=false;
    Promise.resolve().then(async () => {
      if(cancelled)return;
      try { setLegacy(Boolean(localStorage.getItem("mathgrade-studio-v1"))); } catch {}
      const useDemo = new URLSearchParams(window.location.search).get("demo") === "1";
      if (useDemo) { setDemo(true); setWorkspace(createDemoState()); return; }
      try {
        const data=await api<WorkspaceState>("/api/state");
        if(cancelled)return;
        setWorkspace(data);
        const teacher = data.academies.some((academy) => academy.ownerId === data.user?.id);
        const student = data.memberships.some((membership) => membership.userId === data.user?.id);
        setMode(teacher ? "teacher" : student ? "student" : "personal");
        setView(teacher ? "review" : "submit");
      } catch(failure) { if(!cancelled){setWorkspace(emptyState);setError(failure instanceof Error?failure.message:"작업공간을 불러오지 못했습니다.");} }
    });
    return () => { cancelled=true; if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  async function refresh() {
    const data = await api<WorkspaceState>("/api/state");
    setWorkspace(data);
    return data;
  }

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : "처리 중 오류가 발생했습니다."); }
    finally { setBusy(false); }
  }

  const data = workspace ?? emptyState;
  const ownAcademies = data.academies.filter((academy) => academy.ownerId === data.user?.id);
  const teacher = demo || ownAcademies.length > 0;
  const activeAcademy = demo ? data.academies[0] : ownAcademies[0];
  const actorId = demo && mode === "student" ? "demo-student" : data.user?.id;
  const submissions = data.submissions.filter((submission) => {
    if (mode === "teacher") return submission.mode === "academy" && (demo || ownAcademies.some((academy) => academy.id === submission.academyId));
    if (mode === "student") return submission.mode === "academy" && submission.studentId === actorId;
    return submission.mode === "personal" && submission.studentId === actorId;
  });
  const visibleSubmissions = submissions.filter((submission) => (filter === "all" || submission.status === filter) && `${submission.studentCode} ${submission.question.title}`.toLowerCase().includes(query.toLowerCase()));
  const selected = visibleSubmissions.find((submission) => submission.id === selectedId) ?? visibleSubmissions[0];
  const approved = submissions.filter((submission) => submission.status === "approved");
  const drafts = submissions.filter((submission) => submission.status === "draft");
  const nav: View[] = mode === "teacher" ? ["review", "questions", "academy", "community", "admissions", "plans"] : mode === "student" ? ["submit", "history", "plans"] : ["submit", "history", "recommendations", "questions", "admissions", "plans"];

  function changeMode(next: Mode) {
    setMode(next);
    setView(next === "teacher" ? "review" : "submit");
    setSelectedId(""); setFilter("all"); setQuery("");
  }

  function showQuestion(question?: Question) { setEditing(question ?? null); setModal("question"); }
  const closeModal = useCallback(() => { setModal(null); setError(""); }, []);

  async function downloadReports(records: Submission[]) {
    await perform(async () => {
      if (!records.length) throw new Error("확정된 첨삭 결과를 선택해 주세요.");
      const { downloadFeedbackPdf } = await import("@/lib/pdf");
      for(let offset=0;offset<records.length;offset+=50){
        const batch=records.slice(offset,offset+50);
        const source=demo?batch.map(record=>({...record,studentCode:`${record.studentCode} (예시)`})):(await api<{submissions:Submission[]}>("/api/report-data?ids="+batch.map(record=>encodeURIComponent(record.id)).join(","))).submissions;
        const name=records.length===1?`첨삭결과_${records[0].studentCode}.pdf`:`학급_첨삭결과${records.length>50?"_"+(Math.floor(offset/50)+1):""}.pdf`;
        await downloadFeedbackPdf(source,name);
      }
      notify("PDF를 만들었습니다. 저장 후 인쇄할 수 있습니다.");
    });
  }

  async function saveReview(submission: Submission, action: "draft" | "approve" | "reopen", review: Omit<Review,"reviewedAt"|"reviewerId">) {
    setReviewFailure(null);
    await strictAction(async () => {
      if (demo) {
        const nextReview: Review = {...review,reviewedAt:new Date().toISOString(),reviewerId:"demo-teacher"};
        setWorkspace({...data,submissions:data.submissions.map((entry) => entry.id === submission.id ? {...entry,status:action === "approve" ? "approved" : "draft",draft:action === "reopen" ? entry.final : nextReview,final:action === "approve" ? nextReview : null,revision:entry.revision + 1} : entry)});
      } else {
        try {
          await api(`/api/submissions/${submission.id}/review`, {revision:submission.revision,action,...review});
        } catch (failure) {
          // Recover the current revision before a retry, while still letting the
          // review card report the failed save close to the edited fields.
          const refreshed = await refresh().then(() => true).catch(() => false);
          const message = failure instanceof ApiError && failure.code === "REVISION_CONFLICT" && refreshed
            ? "다른 창에서 수정되어 최신 첨삭을 불러왔습니다. 내용을 확인하고 다시 저장해 주세요."
            : failure instanceof Error ? failure.message : "첨삭을 저장하지 못했습니다.";
          setReviewFailure({ id: submission.id, message });
          throw failure;
        }
        await refresh();
      }
      notify(action === "approve" ? "첨삭을 확정했습니다. 학생에게 결과가 공개됩니다." : action === "reopen" ? "첨삭을 다시 열었습니다." : "검토 초안을 저장했습니다.");
    });
  }

  async function strictAction(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "처리하지 못했습니다."); throw failure; }
    finally { setBusy(false); }
  }

  async function setSubmissionRubric(submission: Submission, criteria: Criterion[], notes = "") {
    await strictAction(async () => {
      if (demo) {
        setWorkspace({...data,submissions:data.submissions.map(entry => entry.id === submission.id ? {...entry,question:{...entry.question,criteria,notes,rubricPending:false},rubricPending:false,draft:null,final:null,status:"pending",revision:entry.revision+1} : entry)});
      } else {
        await api(`/api/submissions/${submission.id}/rubric`,{revision:submission.revision,criteria,notes});
        await refresh();
      }
      notify("이 답안의 채점기준을 등록했습니다.");
    });
  }

  async function submitAnswer(payload: SubmitInput, file: File | null, problemFile: File | null) {
    await strictAction(async () => {
      if (demo) {
        const duplicateId=demoRequests.current.get(`${actorId}:${payload.clientRequestId}`);
        if (duplicateId) {setSelectedId(duplicateId);setView("history");return;}
        const now=new Date().toISOString();
        const assignment=data.assignments.find(entry => entry.id===payload.assignmentId);
        let question=assignment?.question || data.questions.find(entry => entry.id===payload.questionId);
        if(payload.directQuestion)question={...payload.directQuestion,id:makeId(),ownerId:actorId || "demo-student",academyId:payload.academyId || null,revision:1,university:"",department:"",examKey:"",academicYear:null,notes:"",criteria:[],rubricPending:true,createdAt:now};
        if(!question)throw new Error("문항을 선택하거나 문제를 함께 제출해 주세요.");
        const attachmentFor=(value:File|null)=>value?{id:makeId(),name:value.name,type:value.type,size:value.size,url:URL.createObjectURL(value)}:null;
        const id=makeId();
        const submission:Submission={id,studentId:actorId || "demo-student",studentCode:payload.studentCode || "개인 학습자",academyId:assignment?.academyId || payload.academyId || null,assignmentId:assignment?.id || null,mode:payload.mode,question:structuredClone(question),answer:payload.answer,studentQuestion:payload.studentQuestion,attachment:attachmentFor(file),problemAttachment:attachmentFor(problemFile),rubricPending:question.criteria.length===0,status:"pending",draft:null,final:null,revision:1,createdAt:now,updatedAt:now};
        demoRequests.current.set(`${actorId}:${payload.clientRequestId}`,id);
        setWorkspace({...data,questions:payload.directQuestion?[question,...data.questions]:data.questions,submissions:[submission,...data.submissions]});
        setSelectedId(id);
      } else {
        const form=new FormData();form.set("payload",JSON.stringify(payload));
        if(file)form.set("file",file);if(problemFile)form.set("problemFile",problemFile);
        const result=await api<{submission:Submission}>("/api/submissions",form);
        await refresh();setSelectedId(result.submission.id);
      }
      setView("history");notify("문제와 답안, 추가 질문을 비공개 기록에 저장했습니다.");
    });
  }

  async function publishQuestion(input: PublishInput) {
    await strictAction(async () => {
      if(demo){
        const question=data.questions.find(item=>item.id===input.questionId && item.ownerId===data.user?.id);
        if(!question||question.originSharedId)throw new Error("직접 등록한 문항을 선택해 주세요.");
        if(question.revision!==input.revision)throw new Error("문항이 변경되었습니다. 최신 내용을 확인하고 다시 공개해 주세요.");
        const normalize=(text:string)=>text.normalize("NFC").replace(/\s+/g,"");
        if((data.sharedQuestions||[]).some(item=>item.sourceQuestionId===question.id || normalize(item.prompt)===normalize(question.prompt)))throw new Error("이미 기여된 문항입니다. 중복 등록은 포인트가 지급되지 않습니다.");
        const id=makeId(),now=new Date().toISOString();
        const sharedQuestion:SharedQuestion={id,sourceQuestionId:question.id,contributorId:data.user!.id,contributorName:input.contributorName,title:question.title,prompt:question.prompt,criteria:structuredClone(question.criteria),university:question.university,academicYear:question.academicYear,sourceLabel:question.sourceLabel,sourceUrl:question.sourceUrl,rightsBasis:input.rightsBasis,rightsNote:input.rightsNote,createdAt:now,status:"published"};
        const points=data.points||{balance:0,events:[]};
        setWorkspace({...data,sharedQuestions:[sharedQuestion,...(data.sharedQuestions||[])],points:{balance:points.balance+10,events:[{id:makeId(),amount:10,reason:"공개 문항 기여",createdAt:now,sharedQuestionId:id},...points.events]}});
      }else{const result=await api<{sharedQuestion:SharedQuestion}>("/api/shared-questions",input);await refresh();if(result.sharedQuestion.status==="withdrawn")throw new Error("이미 공개를 중지한 문항입니다. 기존 기여 내역을 확인해 주세요. 포인트는 중복 지급되지 않습니다.");}
      notify("문항을 공개 자료실에 등록했습니다. 기여 내역을 확인하세요.");
    });
  }

  async function withdrawQuestion(id: string) {
    await strictAction(async()=>{
      if(demo)setWorkspace({...data,sharedQuestions:(data.sharedQuestions||[]).map(item=>item.id===id&&item.contributorId===data.user?.id?{...item,status:"withdrawn"}:item)});
      else{await api(`/api/shared-questions/${id}/withdraw`,{});await refresh();}
      notify("공개 자료실에서 문항을 내렸습니다. 기여 기록은 유지됩니다.");
    });
  }

  async function importQuestion(id: string) {
    await strictAction(async()=>{
      if(demo){
        const item=(data.sharedQuestions||[]).find(entry=>entry.id===id&&entry.status==="published");
        if(!item)throw new Error("현재 공유 중인 문항을 선택해 주세요.");
        if(!data.questions.some(question=>question.originSharedId===id&&question.ownerId===data.user?.id)){
          const question:Question={id:makeId(),ownerId:data.user!.id,academyId:null,revision:1,title:item.title,prompt:item.prompt,university:item.university,department:"",examKey:"",academicYear:item.academicYear,sourceUrl:item.sourceUrl,sourceLabel:item.sourceLabel,notes:`공개 기여자: ${item.contributorName}`,criteria:structuredClone(item.criteria),originSharedId:item.id,createdAt:new Date().toISOString()};
          setWorkspace({...data,questions:[question,...data.questions]});
        }
      }else{await api(`/api/shared-questions/${id}/import`,{});await refresh();}
      notify("내 문항에 가져왔습니다. 출처와 채점기준을 확인해 주세요.");
    });
  }

  function exportCsv() {
    if (!approved.length) { notify("확정된 첨삭 결과가 없습니다."); return; }
    const cell = (value: unknown) => {
      let text = String(value ?? "");
      if (/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/u.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"','""') + '"';
    };
    const rows = [["학생 코드","문항","점수","만점","피드백","학생 추가 질문","질문 답변"], ...approved.map((record) => [record.studentCode,record.question.title,sum(record.final!.scores),maximum(record.question),record.final!.feedback,record.studentQuestion||"",record.final!.questionResponse||""])];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}));
    const link = document.createElement("a"); link.href=url; link.download="첨삭_확정결과.csv"; link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }

  if (!workspace) return <div className="loading"><p>첨삭 작업공간을 불러오고 있어요.</p></div>;

  return <div className="workspace-layout">
    <aside className="sidebar"><a className="brand" href="/"><span className="brand-icon">∑</span><span>수식채점실<small>MATH FEEDBACK STUDIO</small></span></a><div className="sidebar-caption">WORKSPACE</div><nav aria-label="주 메뉴">{nav.map((name) => { const Icon=icons[name]; return <button key={name} className={`nav-item ${view === name ? "active" : ""}`} aria-current={view === name ? "page" : undefined} onClick={() => {setView(name);setError("");}}><Icon />{viewNames[name]}</button>; })}</nav><div className="sidebar-bottom"><div className="sidebar-note"><strong>풀이의 과정까지 읽는 첨삭</strong>답안의 근거를 확인하고<br />학생에게 다음 풀이의 방향을 남겨요.</div>{legacy && <a className="nav-item" href="/legacy/" style={{marginTop:10}}><BookOpen />이전 작업대 열기</a>}<div className="account"><span className="avatar">{mode === "teacher" ? "선" : "학"}</span><div>{demo ? "예시 작업공간" : data.user?.name || "방문자"}<small>{mode === "teacher" ? "학원 선생님" : mode === "student" ? "학원 학생" : "개인 학습자"}</small></div></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><span>{mode === "teacher" ? "학원 작업공간" : mode === "student" ? "나의 학원" : "개인 학습공간"}</span><ChevronRight size={12} /><strong>{viewNames[view]}</strong></div><div className="topbar-actions">{demo ? <span className="environment-chip">예시 체험</span> : <span className="environment-chip">{data.user ? "로그인됨" : "로그인 필요"}</span>}{!demo && data.user && <>{teacher && mode!=="teacher" && <button className="topbar-link" onClick={()=>changeMode("teacher")}>선생님 작업대</button>}{data.memberships.some(member=>member.userId===data.user?.id) && mode!=="student" && <button className="topbar-link" onClick={()=>changeMode("student")}>학원 과제</button>}{mode!=="personal" && <button className="topbar-link" onClick={()=>changeMode("personal")}>개인 학습</button>}</>}{demo ? <a className="topbar-link" href="/">내 작업공간</a> : data.user ? <a className="topbar-link" href="/signout-with-chatgpt?return_to=/" target="_top">로그아웃</a> : <a className="topbar-link" href="/signin-with-chatgpt?return_to=/" target="_top">로그인</a>}</div></header>
    <main className="main-content">
      {demo && <div className="banner"><p><strong>예시 답안으로 체험 중입니다.</strong> 변경 사항은 이 화면에서만 유지됩니다.</p><div className="demo-role-switch" aria-label="체험 역할">{(["teacher","student","personal"] as Mode[]).map((role) => <button key={role} className={mode===role?"active":""} onClick={() => changeMode(role)}>{role === "teacher" ? "선생님" : role === "student" ? "학생" : "개인용"}</button>)}</div></div>}
      {!demo && !data.user && <div className="banner"><p><strong>로그인하고 나만의 첨삭 공간을 시작하세요.</strong><br />학원 과제와 제출 답안이 계정에 저장됩니다.</p><div className="actions"><a className="button secondary" href="/?demo=1">예시 체험</a><a className="button primary" href="/signin-with-chatgpt?return_to=/" target="_top"><LogIn />ChatGPT로 로그인</a></div></div>}
      {!demo && data.user && !data.storageReady && <div className="form-error" style={{marginBottom:18}}>저장 공간 연결을 확인하고 있습니다. 새로고침 후 다시 시도해 주세요.</div>}
      {legacy && !demo && <div className="banner neutral"><p><strong>이 브라우저에 이전 작업이 남아 있어요.</strong> 이전 작업대에서 문항과 기준을 확인한 뒤 이 공간에 등록해 주세요.</p><a className="button secondary small" href="/legacy/" target="_blank" rel="noreferrer">이전 작업대 열기</a></div>}
      {error && !modal && <div className="form-error" role="alert" style={{marginBottom:18}}>{error}</div>}
      {!demo && data.user && !ownAcademies.length && !data.memberships.length && <div className="banner neutral"><p><strong>어떤 공간으로 시작할까요?</strong> 개인 학습을 시작하거나 학원에 연결할 수 있습니다.</p><div className="actions"><button className="button secondary" onClick={() => setModal("join")}>학원 참여</button><button className="button secondary" onClick={() => setModal("academy")}>선생님 학원 만들기</button></div></div>}
      <div className="page-heading"><div><p className="eyebrow">{view === "review" ? "REVIEW DESK" : view === "submit" ? "YOUR NEXT STEP" : "MATH FEEDBACK"}</p><h1>{viewNames[view]}</h1><p className="page-subtitle">{view === "review" ? "한 줄의 풀이에도 근거를. 검토하고, 학생의 다음 성장을 남겨주세요." : view === "submit" ? "풀이 과정을 보내주세요. 어느 부분을 보완하면 좋을지 확인할 수 있어요." : view === "questions" ? "문제와 학교별 채점기준을 연결하고, 출처를 함께 기록하세요." : view === "academy" ? "학생을 연결하고 과제를 배정하세요. 제출된 답안은 작업대에 모입니다." : view === "recommendations" ? "같은 대학·시험의 첨삭 결과를 공개된 논술 성적과 비교합니다." : view === "admissions" ? "자료의 연도와 점수 종류를 기록하고, 비교 가능한 성적을 확인하세요." : view === "history" ? "문제·풀이·추가 질문과 확정된 피드백을 비공개 기록으로 모아보세요." : view === "community" ? "함께 쓰는 문항을 기여하고, 출처와 채점기준을 나누세요." : "학습 방식에 맞게 첨삭을 이용하세요."}</p></div><div className="actions">{view === "review" && <><button className="button secondary" disabled={busy || !approved.length} onClick={exportCsv}><Download />CSV</button><button className="button primary" disabled={busy || !approved.length} onClick={() => downloadReports(approved)}><Download />학급 PDF</button></>}{view === "questions" && <button className="button primary" onClick={() => showQuestion()} disabled={!data.user}><Plus />문항 등록</button>}{view === "admissions" && <button className="button primary" onClick={() => {setAdmissionEdit(null);setModal("admission");}} disabled={!data.user}><Plus />입시 자료 등록</button>}</div></div>
      {view === "review" && <><div className="metric-grid"><Metric title="전체 답안" count={submissions.length} unit="건" note="현재 학원에 제출된 답안" icon={FileText} /><Metric title="검토 대기" count={submissions.filter((record) => record.status === "pending").length} unit="건" note="선생님의 검토를 기다려요" icon={Clock3} /><Metric title="첨삭 초안" count={drafts.length} unit="건" note="부분점수와 피드백 확인" icon={ClipboardCheck} /><Metric title="확정 완료" count={approved.length} unit="건" note="PDF로 출력할 수 있어요" icon={CheckCheck} /></div><div className="review-grid"><section className="card queue"><div className="card-head"><h2>제출 답안</h2><span className="muted">{visibleSubmissions.length}건</span></div><div className="queue-tools"><div className="search-box"><Search /><input aria-label="답안 검색" placeholder="학생 코드, 문항 검색" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="filter-row">{[["all","전체"],["pending","대기"],["draft","초안"],["approved","확정"]].map(([value,label]) => <button key={value} className={`filter-tab ${filter===value?"active":""}`} onClick={() => setFilter(value)}>{label}</button>)}</div></div><div className="submission-list">{visibleSubmissions.map((record) => <button key={record.id} className={`submission-row ${selected?.id===record.id?"active":""}`} onClick={() => setSelectedId(record.id)}><span className="student-initial">{record.studentCode.slice(0,2)}</span><span className="submission-meta"><span className="submission-name"><strong>{record.studentCode}</strong><span className={`status ${record.status}`}>{statusNames[record.status]}</span></span><p>{record.question.title}</p><small>{dateText(record.createdAt)} 제출</small></span></button>)}</div>{!visibleSubmissions.length && <Empty title="아직 제출된 답안이 없어요" text="학원에 과제를 배정하면 학생 답안이 여기에 모입니다." action={<button className="button secondary" onClick={() => setView("academy")}>학원 · 과제 열기</button>} />}</section>{selected ? <><AnswerCard submission={selected} /><ReviewCard key={`${selected.id}-${selected.revision}`} submission={selected} demo={demo} busy={busy} canReview onSave={saveReview} saveError={reviewFailure?.id===selected?.id?reviewFailure.message:undefined} onSetRubric={setSubmissionRubric} onPdf={downloadReports} /></> : <section className="card review-placeholder"><Empty title="답안을 선택해 주세요" text="원문과 채점기준을 나란히 보며 검토할 수 있습니다." /></section>}</div></>}
      {view === "questions" && <div className="question-list">{data.questions.filter((question) => question.ownerId === data.user?.id).map((question) => <article className="card question-item" key={question.id}><div className="line"><div><div className="source-line"><span>{question.university || "자체 문항"}</span>{question.academicYear && <span>{question.academicYear}학년도</span>}<span>{question.criteria.length ? `${maximum(question)}점` : "채점기준 등록 전"}</span></div><h3>{question.title}</h3></div><button className="button secondary" onClick={() => showQuestion(question)}>기준 수정</button></div><p>{question.prompt}</p>{(question.rubricPending || !question.criteria.length) && <p className="muted">기준 미등록 · 원본은 첨삭 기록에서 확인해 주세요.</p>}<Source question={question} />{question.references?.length ? <div className="actions" style={{marginTop:12}}>{question.references.map((reference) => <a key={reference.id} href={reference.url} target="_blank" rel="noreferrer" className="button secondary small"><FileText />{reference.kind === "rubric" ? "채점기준 원본" : "문제 원본"}</a>)}</div> : null}<div className="actions"><span className="muted">채점 항목 {question.criteria.length}개 · 기준 버전 {question.revision}</span>{mode === "teacher" && <button className="button primary small" disabled={Boolean(question.rubricPending)||!question.criteria.length} onClick={() => {setAssignmentQuestion(question);setModal("assignment");}}><Plus />과제 배정</button>}</div></article>)}{!data.questions.length && <section className="card"><Empty title="첫 문항을 등록해 주세요" text="문제, 학교별 배점과 부분점수 기준, 출처를 함께 기록할 수 있습니다." action={<button className="button primary" onClick={() => showQuestion()} disabled={!data.user}><Plus />문항 등록</button>} /></section>}<div className="state-callout">학교에서 제공한 채점기준을 항목별 배점으로 입력하세요. 사진·PDF 원본을 함께 보관할 수 있습니다. 현재 자동 수식 판독과 AI 첨삭은 연결 전입니다.</div></div>}
      {view === "academy" && <div className="stack"><div className="two-column"><section className="card card-padding"><div className="card-title-row"><div><h2>{activeAcademy?.name || "나의 학원"}</h2><p className="muted">학생은 로그인 후 참여 코드로 학원에 연결합니다.</p></div><Users size={23} color="#b297c6" /></div>{activeAcademy ? <><p className="muted">학생 참여 코드</p><div className="join-code">{activeAcademy.joinCode}</div><button className="button secondary small" onClick={() => navigator.clipboard.writeText(activeAcademy.joinCode || "").then(() => notify("참여 코드를 복사했습니다.")).catch(() => notify("화면에 표시된 참여 코드를 복사해 주세요."))}>코드 복사</button><p className="muted" style={{marginTop:15}}>학생이 사이트에 접속할 수 있도록 사이트 공유 설정도 확인해 주세요.</p></> : <button className="button primary" disabled={!data.user} onClick={() => setModal("academy")}><Plus />학원 만들기</button>}</section><section className="card card-padding"><h2>과제 배정</h2><p className="muted" style={{margin:"10px 0 18px"}}>등록한 문제와 채점기준으로 과제를 만들면 학생의 제출 화면에 표시됩니다.</p><button className="button primary" disabled={!activeAcademy || !data.questions.some(question => question.criteria.length > 0)} onClick={() => {setAssignmentQuestion(null);setModal("assignment");}}><Plus />새 과제</button>{!data.questions.length && <button className="button ghost" onClick={() => showQuestion()}>문항 먼저 등록</button>}</section></div><section className="card card-padding"><h2>배정한 과제</h2><div className="assignment-list">{data.assignments.filter((assignment) => demo || ownAcademies.some((academy) => academy.id === assignment.academyId)).map((assignment) => <div className="assignment-row" key={assignment.id}><div><h3>{assignment.title}</h3><p>{assignment.question.title} · {maximum(assignment.question)}점{assignment.dueAt ? ` · 마감 ${dateText(assignment.dueAt)}` : ""}</p></div><span className="muted">{data.submissions.filter((submission) => submission.assignmentId === assignment.id).length}건 제출</span></div>)}</div>{!data.assignments.length && <Empty title="배정한 과제가 없습니다" text="새 과제를 추가해 학생의 풀이를 받아보세요." />}</section></div>}
      {view === "submit" && <><div className="personal-top"><section className="card card-padding"><div className="card-title-row"><div><h2>{mode === "personal" ? "나의 풀이를 한 걸음 더" : "과제를 확인하고 제출하세요"}</h2><p className="muted">{mode === "personal" ? "풀이를 텍스트로 적거나 손글씨 답안을 첨부해 보세요." : "선생님이 확정한 첨삭 결과는 기록에서 확인할 수 있습니다."}</p></div><Send size={24} color="#b294c9" /></div><p className="muted">현재 AI 첨삭은 연결 전입니다.{mode === "student" ? " 제출한 답안은 선생님이 직접 검토하고 확정할 수 있습니다." : " 답안은 보관되며, 자동 첨삭 완료 횟수는 차감되지 않습니다."}</p>{mode === "student" && !data.memberships.length && <button className="button secondary" style={{marginTop:16}} onClick={() => setModal("join")} disabled={!data.user}>참여 코드 입력</button>}</section>{mode === "personal" ? <section className="card quota-card"><h3>오늘의 첨삭 이용</h3><strong>{data.usage.remaining}<small> / {data.usage.limit}회 남음</small></strong><div className="progress-track"><div className="progress-fill" style={{width:`${data.usage.remaining / data.usage.limit * 100}%`}} /></div><p className="muted">한국 시간 자정에 초기화 · 첨삭 완료 시 1회 사용</p></section> : <section className="card quota-card"><h3>나의 제출 현황</h3><strong>{submissions.length}<small>건 제출</small></strong><p className="muted">확정 {approved.length}건 · 검토 중 {submissions.length - approved.length}건</p><button className="button secondary small" style={{marginTop:14}} onClick={() => setView("history")}>첨삭 기록 확인</button></section>}</div><SubmissionForm key={mode} mode={mode === "personal" ? "personal" : "academy"} questions={data.questions.filter(question => question.ownerId === actorId && !question.rubricPending && question.criteria.length > 0)} assignments={data.assignments} academies={data.academies.filter(academy => data.memberships.some(member => member.academyId === academy.id && member.userId === actorId))} disabled={busy || !data.user || (!demo && !data.storageReady)} onNewQuestion={() => showQuestion()} onSubmit={submitAnswer} /></>}
      {view === "history" && <div className="stack"><section className="card"><div className="table-scroll"><table><thead><tr><th>문항</th><th>제출일</th><th>상태</th><th>점수</th><th>결과</th></tr></thead><tbody>{submissions.map((record) => <tr key={record.id}><td><strong>{record.question.title}</strong><p className="muted">{record.question.university}</p></td><td>{dateText(record.createdAt)}</td><td><span className={`status ${record.status}`}>{statusNames[record.status]}</span></td><td>{record.final ? `${sum(record.final.scores)} / ${maximum(record.question)}` : "검토 중"}</td><td><button className="button secondary small" onClick={() => setSelectedId(record.id)}>답안 보기</button></td></tr>)}</tbody></table></div>{!submissions.length && <Empty title="아직 제출한 풀이가 없어요" text="첫 답안을 제출하고 피드백을 모아보세요." action={<button className="button primary" onClick={() => setView("submit")}>답안 제출</button>} />}</section>{selected && <div className="two-column"><AnswerCard submission={selected} /><ReviewCard key={`${selected.id}-${selected.revision}`} submission={{...selected,draft:null}} demo={demo} busy={busy} canReview={false} onSave={saveReview} saveError={reviewFailure?.id===selected?.id?reviewFailure.message:undefined} onSetRubric={setSubmissionRubric} onPdf={downloadReports} /></div>}</div>}
      {view === "community" && mode === "teacher" && <CommunityPanel questions={data.questions} sharedQuestions={data.sharedQuestions || []} points={data.points || {balance:0,events:[]}} userId={data.user?.id || ""} busy={busy} demo={demo} onPublish={publishQuestion} onWithdraw={withdrawQuestion} onImport={importQuestion} />}
      {view === "recommendations" && <Recommendations submissions={submissions} admissions={data.admissions} onAdd={() => setView("admissions")} />}
      {view === "admissions" && <Admissions records={data.admissions} onEdit={(record) => {setAdmissionEdit(record);setModal("admission");}} />}
      {view === "plans" && <><div className="two-column"><section className="card plan-card"><span className="plan-icon"><Users /></span><p className="eyebrow">FOR ACADEMIES</p><h2>학원용</h2><p className="muted">선생님의 검토와 확정을 중심으로</p><ul><li>학원 참여 코드와 온라인 과제 제출</li><li>학교별 채점기준에 맞춘 부분점수 검토</li><li>선생님 수정·확정과 학생 결과 공개</li><li>학생별·학급별 A4 첨삭 PDF 출력</li></ul><button className="button primary" onClick={() => teacher ? changeMode("teacher") : setModal("academy")} disabled={!data.user}>{teacher ? "선생님 작업대" : "학원 만들기"}</button></section><section className="card plan-card"><span className="plan-icon"><GraduationCap /></span><p className="eyebrow">FOR STUDENTS</p><h2>개인용</h2><p className="muted">나의 풀이를 쌓으며 대학별 기준 확인</p><div className="limit">하루 3회 <span>첨삭 완료 기준</span></div><ul><li>풀이 업로드와 누적 첨삭 기록</li><li>같은 대학·시험의 공개 논술 성적 비교</li><li>한국 시간 자정에 이용 횟수 초기화</li><li>실패한 첨삭은 횟수 차감 없이 재요청</li></ul><button className="button secondary" onClick={() => changeMode("personal")}>개인 학습공간</button></section></div><div className="state-callout">현재는 기능 검증 단계입니다. AI 연결과 요금 금액은 설정 전이며 결제는 제공되지 않습니다.</div></>}
    </main></div>
    {modal && <Modal title={modal === "academy" ? "학원 만들기" : modal === "join" ? "학원 참여하기" : modal === "question" ? editing ? "문항 · 채점기준 수정" : "새 문항 등록" : modal === "assignment" ? "새 과제 배정" : admissionEdit ? "입시 기준 자료 수정" : "입시 기준 자료 등록"} onClose={closeModal} narrow={modal === "academy" || modal === "join" || modal === "assignment"}>
      {error && <p className="form-error" role="alert" style={{marginBottom:18}}>{error}</p>}
      {modal === "academy" && <form className="form-stack" onSubmit={event=>{event.preventDefault();const name=String(new FormData(event.currentTarget).get("name")||"").trim();void perform(async()=>{if(demo){const academy:Academy={id:makeId(),name,ownerId:data.user!.id,joinCode:"DEMO24",createdAt:new Date().toISOString()};setWorkspace({...data,academies:[academy,...data.academies]});}else{await api("/api/academies",{name});await refresh();}changeMode("teacher");setView("academy");closeModal();notify("학원을 만들었습니다. 참여 코드로 학생을 연결하세요.");});}}><p className="muted">계정에 연결된 학원을 만들고 학생의 답안을 관리합니다.</p><label className="field">학원 이름<input className="text-input" name="name" placeholder="예: 이룸 수학학원" required minLength={2} maxLength={80}/></label><div className="modal-footer"><button className="button primary" disabled={busy||!data.user}>학원 만들기</button></div></form>}
      {modal === "join" && <form className="form-stack" onSubmit={event=>{event.preventDefault();const code=String(new FormData(event.currentTarget).get("code")||"").trim();void perform(async()=>{if(demo){if(code.toUpperCase()!=="DEMO24")throw new Error("예시 학원의 참여 코드는 DEMO24입니다.");}else{await api("/api/join",{code});await refresh();}changeMode("student");closeModal();notify("학원에 참여했습니다. 배정된 과제를 확인해 주세요.");});}}><p className="muted">선생님이 알려준 참여 코드를 입력하세요.</p><label className="field">학원 참여 코드<input className="text-input" name="code" placeholder={demo?"DEMO24":"참여 코드"} required maxLength={30}/></label><div className="modal-footer"><button className="button primary" disabled={busy||!data.user}>학원 참여</button></div></form>}
      {modal === "question" && <QuestionForm question={editing} academyId={mode === "teacher" ? activeAcademy?.id || null : null} busy={busy} onSave={async(input,files)=>{await perform(async()=>{if(demo){const question:Question={...input,id:input.id||makeId(),ownerId:data.user!.id,originSharedId:editing?.originSharedId,rubricPending:false,revision:(editing?.revision||0)+1,createdAt:editing?.createdAt||new Date().toISOString(),references:[...(editing?.references||[]),...files.map(({file,kind})=>({id:makeId(),name:file.name,type:file.type,size:file.size,url:URL.createObjectURL(file),kind}))]};setWorkspace({...data,questions:[question,...data.questions.filter(q=>q.id!==question.id)]});}else{let {question}=await api<{question:Question}>("/api/questions",input);setEditing(question);for(const {file,kind} of files){const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());const fingerprint=`${question.id}:${kind}:${Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("")}`;if(completedReferences.current.has(fingerprint))continue;const form=new FormData();form.set("file",file);form.set("kind",kind);form.set("revision",String(question.revision));({question}=await api<{question:Question}>(`/api/questions/${question.id}/references`,form));completedReferences.current.add(fingerprint);setEditing(question);}await refresh();}closeModal();notify("문항과 채점기준을 저장했습니다.");});}} />}
      {modal === "assignment" && <AssignmentForm questions={data.questions.filter(question=>question.ownerId===data.user?.id && question.criteria.length>0)} initial={assignmentQuestion} busy={busy} onSave={async(input)=>{await perform(async()=>{if(!activeAcademy)throw new Error("학원을 먼저 만들어 주세요.");if(demo){const question=data.questions.find(q=>q.id===input.questionId);if(!question)throw new Error("문항을 선택해 주세요.");const assignment:Assignment={id:makeId(),academyId:activeAcademy.id,title:input.title,question:structuredClone(question),dueAt:input.dueAt||null,createdAt:new Date().toISOString()};setWorkspace({...data,assignments:[assignment,...data.assignments]});}else{await api("/api/assignments",{...input,academyId:activeAcademy.id});await refresh();}closeModal();setView("academy");notify("과제를 배정했습니다.");});}} />}
      {modal === "admission" && <AdmissionForm record={admissionEdit} busy={busy} onSave={async(input)=>{await perform(async()=>{if(demo){const record:AdmissionRecord={...input,id:input.id||makeId(),ownerId:data.user!.id,revision:(admissionEdit?.revision||0)+1,createdAt:admissionEdit?.createdAt||new Date().toISOString()};setWorkspace({...data,admissions:[record,...data.admissions.filter(entry=>entry.id!==record.id)]});}else{await api("/api/admissions",input);await refresh();}closeModal();notify("입시 기준 자료를 저장했습니다.");});}} />}
    </Modal>}
    {message && <div className="toast" role="status"><Check size={17}/>{message}</div>}
  </div>;
}

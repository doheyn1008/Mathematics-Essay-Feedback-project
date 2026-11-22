"use client";
import { useEffect, useId, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, FileText, Image as ImageIcon, Plus, Trash2, UploadCloud } from "lucide-react";
import type { Contribution, Exam, ExamFileRole, ExamItem, ProductState, ReleaseMode } from "@/lib/product-types";

export type DraftFile = { key: string; file: File; role: ExamFileRole; preview: string; itemId: string };
export type ProductAction = (path: string, payload?: unknown) => Promise<Record<string, any>>;
export const roleNames: Record<ExamFileRole, string> = { problem: "문제지", answer: "학생 답안", mixed: "문제 + 학생 답안", solution: "답지 · 해설", rubric: "채점기준" };
export const releaseNames: Record<ReleaseMode, string> = { teacher_review: "선생님 검토 후 공개", ai_immediate: "AI 완료 즉시 공개" };
export const fileTypes = "image/jpeg,image/png,image/webp,application/pdf";
const errorText = (error: unknown) => error instanceof Error ? error.message : "입력 내용을 확인하고 다시 시도해 주세요.";

export function packFiles(payload: Record<string, unknown>, files: DraftFile[]) {
  const form = new FormData();
  form.set("payload", JSON.stringify({ ...payload, fileMeta: files.map((f, order) => ({ role: f.role, order, itemId: f.itemId || undefined })) }));
  files.forEach(f => form.append("files", f.file));
  return form;
}

export function FilePicker({ files, onChange, roles, items = [], material = false }: { files: DraftFile[]; onChange: (files: DraftFile[]) => void; roles: ExamFileRole[]; items?: ExamItem[]; material?: boolean }) {
  const fieldId = useId();
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  function add(values: FileList | null, replace?: number) {
    if (!values) return;
    const incoming = Array.from(values);
    if (incoming.some(f => !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(f.type))) { setError("JPG, PNG, WEBP, PDF 파일만 올릴 수 있습니다."); return; }
    if (incoming.some(f => !f.size || f.size > 15 * 1024 * 1024)) { setError("빈 파일은 제외하고, 파일당 15MB 이하로 올려 주세요."); return; }
    const next = replace === undefined ? [...files] : files.filter((_, i) => i !== replace);
    if (next.length + incoming.length > 12 || next.reduce((sum, f) => sum + f.file.size, 0) + incoming.reduce((sum, f) => sum + f.size, 0) > 60 * 1024 * 1024) { setError("한 번에 최대 12개, 전체 60MB까지 올릴 수 있습니다."); return; }
    const additions = incoming.map(file => ({ key: crypto.randomUUID(), file, role: replace === undefined ? roles[0] : files[replace].role, preview: URL.createObjectURL(file), itemId: replace === undefined ? "" : files[replace].itemId }));
    if (replace === undefined) next.push(...additions); else next.splice(replace, 0, ...additions);
    onChange(next); setError("");
  }
  function move(index: number, offset: number) { const next = [...files]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; onChange(next); }
  const active = files.find(f => f.key === preview);
  return <div className="p-file-picker">
    <label className="p-dropzone" htmlFor={fieldId}><UploadCloud size={29} /><strong>사진 또는 PDF를 선택하세요</strong><span>{material ? "문제지·해설·채점기준 · 여러 파일 선택 · 파일당 15MB" : "종이에 푼 그대로 · 여러 장 동시 선택 · 파일당 15MB"}</span><input id={fieldId} type="file" multiple accept={fileTypes} onChange={e => { add(e.target.files); e.target.value = ""; }} /></label>
    {error && <p className="p-error" role="alert">{error}</p>}
    {!!files.length && <p className="p-help">위에서부터 페이지 순서입니다. 각 파일의 종류와 관련 문항을 확인하세요.</p>}
    <div className="p-files">{files.map((entry, index) => <div className="p-file-row" key={entry.key}>
      <button type="button" className="p-file-thumb" aria-label={`${entry.file.name} 미리보기`} onClick={() => setPreview(active?.key === entry.key ? null : entry.key)}>{entry.file.type.startsWith("image/") ? <img src={entry.preview} alt="첨부 미리보기" /> : <FileText size={24} />}</button>
      <div className="p-file-info"><strong>{index + 1}. {entry.file.name}</strong><span>{(entry.file.size / 1024 / 1024).toFixed(2)} MB</span><div className="p-file-selects"><select aria-label={`${entry.file.name} 파일 종류`} value={entry.role} onChange={e => onChange(files.map(f => f.key === entry.key ? { ...f, role: e.target.value as ExamFileRole } : f))}>{roles.map(role => <option key={role} value={role}>{roleNames[role]}</option>)}</select>{items.length > 0 && <select aria-label={`${entry.file.name} 관련 문항`} value={entry.itemId} onChange={e => onChange(files.map(f => f.key === entry.key ? { ...f, itemId: e.target.value } : f))}><option value="">시험 전체</option>{items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>}</div></div>
      <div className="p-file-tools"><button type="button" className="icon-button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`${entry.file.name} 위로`}><ArrowUp size={15} /></button><button type="button" className="icon-button" disabled={index === files.length - 1} onClick={() => move(index, 1)} aria-label={`${entry.file.name} 아래로`}><ArrowDown size={15} /></button><label className="button secondary small">교체<input type="file" accept={fileTypes} className="p-sr-only" onChange={e => add(e.target.files, index)} /></label><button type="button" className="icon-button" aria-label={`${entry.file.name} 삭제`} onClick={() => { URL.revokeObjectURL(entry.preview); onChange(files.filter(f => f.key !== entry.key)); }}><Trash2 size={15} /></button></div>
    </div>)}</div>
    {active && <div className="p-preview"><div className="p-section-line"><strong>{active.file.name}</strong><button type="button" className="button ghost small" onClick={() => setPreview(null)}>닫기</button></div>{active.file.type.startsWith("image/") ? <img src={active.preview} alt={active.file.name} /> : <object data={active.preview} type="application/pdf" aria-label={active.file.name}><a href={active.preview} target="_blank" rel="noreferrer">PDF 열기</a></object>}</div>}
  </div>;
}

type ConsentDraft = { contributorName:string; sourceLabel:string; sourceUrl:string; rightsBasis:string; rightsNote:string; rightsConfirmed:boolean; premiumConfirmed:boolean };
const newConsent = (name:string,exam?:Exam):ConsentDraft => ({contributorName:name,sourceLabel:exam?.sourceLabel??"",sourceUrl:exam?.sourceUrl??"",rightsBasis:"own",rightsNote:"",rightsConfirmed:false,premiumConfirmed:false});
function ContributionFields({ value,setValue,disabled=false }: {value:ConsentDraft;setValue:(value:ConsentDraft)=>void;disabled?:boolean}) {
  function change(key:keyof ConsentDraft,next:string|boolean){setValue({...value,[key]:next});}
  return <fieldset className="p-contribution-fields" disabled={disabled}><legend>프리미엄 문제 기여 동의</legend><p className="p-note">개인용 유료 프리미엄 회원에게 문제지와 문항 번호·배점만 제공합니다. 답지·해설·채점기준·학생 답안·대화와 반 정보는 제외합니다. 문제지 자체에 개인정보나 비공개 해설이 없는지도 확인하세요.</p><div className="p-grid-two"><label>문제 출처<input required maxLength={500} value={value.sourceLabel} onChange={e=>change("sourceLabel",e.target.value)} placeholder="자체 제작 또는 권리자·자료명" /></label><label>출처 링크 <span className="p-optional">선택</span><input type="url" maxLength={2000} value={value.sourceUrl} onChange={e=>change("sourceUrl",e.target.value)} /></label></div><label>공개 기여자 이름<input required maxLength={80} value={value.contributorName} onChange={e=>change("contributorName",e.target.value)} /></label><label>제공 권한 근거<select value={value.rightsBasis} onChange={e=>change("rightsBasis",e.target.value)}><option value="own">본인에게 저작권이 있는 자체 제작 문제</option><option value="permission">권리자에게 유료 서비스 제공 허락을 받은 문제</option></select></label><label>권한 근거 · 허락 범위<textarea required={value.rightsBasis==="permission"} maxLength={2000} rows={3} value={value.rightsNote} onChange={e=>change("rightsNote",e.target.value)} /></label><label className="p-check"><input type="checkbox" required checked={value.rightsConfirmed} onChange={e=>change("rightsConfirmed",e.target.checked)} /><span>기여할 문제지 전체를 제공할 권리가 있습니다. 출처 표시만으로 이용 허락을 대신할 수 없음을 확인합니다.</span></label><label className="p-check"><input type="checkbox" required checked={value.premiumConfirmed} onChange={e=>change("premiumConfirmed",e.target.checked)} /><span>문제지와 문항 번호·배점이 다른 학생의 학습과 개인용 유료 프리미엄 서비스에 제공되는 데 동의합니다.</span></label><p className="p-help">동의 범위·시각·자료 버전을 기록합니다. 기여 적립과 사용 적립의 수량은 별도 정책으로 확정합니다. 유효 사용의 정의·지급량은 최종 사업 정책으로 확정되지 않았으며 별도 검토 후 안내합니다.</p></fieldset>;
}
function leafDraft(exam?:Exam) {const parents=new Set(exam?.items.map(i=>i.parentId).filter(Boolean));return (exam?.items??[]).filter(i=>!parents.has(i.id)).map(i=>({id:i.id,label:i.label,max:String(i.maxScore),criteria:i.criteria}));}
export function ExamForm({ data, classId, action, onDone, initialExam }: { data: ProductState; classId: string; action: ProductAction; onDone: () => void; initialExam?: Exam }) {
  const [baseRevision,setBaseRevision]=useState(initialExam?.revision);
  const [title,setTitle]=useState(initialExam?.title??""), [files,setFiles]=useState<DraftFile[]>([]), [mode,setMode]=useState<ReleaseMode>(initialExam?.releaseMode??data.classes.find(c=>c.id===classId)?.releaseMode??"teacher_review");
  const [items,setItems]=useState(leafDraft(initialExam)), [retainedIds,setRetainedIds]=useState(initialExam?.files.map(f=>f.id)??[]);
  const [contribute,setContribute]=useState(false), [consent,setConsent]=useState(newConsent(data.profile?.displayName??"",initialExam));
  const [saved,setSaved]=useState<Exam|null>(null), [requestId]=useState(()=>crypto.randomUUID()), [error,setError]=useState(""), [busy,setBusy]=useState(false);
  const parsedItems=items.map(({max,...item})=>({...item,maxScore:Number(max)}));
  async function submit(event:FormEvent){event.preventDefault();setError("");setBusy(true);try{
    let exam=saved;
    if(!exam){
      if(![...files,...(initialExam?.files.filter(f=>retainedIds.includes(f.id))??[])].some(f=>f.role==="problem"||f.role==="mixed"))throw new Error("문제지를 한 개 이상 첨부하세요.");
      if(parsedItems.some(i=>!i.label.trim()||!Number.isFinite(i.maxScore)||i.maxScore<=0))throw new Error("문항 번호와 배점을 확인하세요.");
      if(new Set(parsedItems.map(i=>i.label)).size!==parsedItems.length)throw new Error("문항 번호가 중복됩니다.");
      if(contribute&&!files.some(f=>f.role==="problem")&&!initialExam?.files.some(f=>retainedIds.includes(f.id)&&f.role==="problem"))throw new Error("기여하려면 문제지로 분류한 파일이 필요합니다.");
      const result=await action("exams",packFiles({id:initialExam?.id,revision:baseRevision,createRequestId:initialExam?undefined:requestId,retainedFileIds:retainedIds,title,classId:initialExam?initialExam.classId:classId||null,items:parsedItems,releaseMode:mode},files));
      exam=result.exam;setSaved(exam);
    }
    if(!exam)throw new Error("시험 저장 결과를 확인할 수 없습니다.");
    if(contribute)await action("contributions",{examId:exam.id,revision:exam.revision,...consent});
    onDone();
  }catch(error){setError(errorText(error));}finally{setBusy(false);}}
  return <form className="p-form" onSubmit={submit}><fieldset disabled={busy||!!saved} className="p-exam-fields"><legend className="p-sr-only">시험 자료</legend><p className="p-note">문제지를 먼저 올려 주세요. 답지·해설·채점기준과 문항 정보는 있는 만큼만 등록하세요.</p><label>시험 이름<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} placeholder="예: A대 대비 3회 실전 논술" /></label>{initialExam&&<div className="p-retained-files"><h3>기존 자료 · v{initialExam.revision}</h3><p className="p-help">기존 과제와 첨삭 기록의 자료는 보존됩니다.</p>{initialExam.files.filter(f=>retainedIds.includes(f.id)).map(f=><div className="p-file-row" key={f.id}><a href={f.url} target="_blank" rel="noreferrer">{f.name}</a><button type="button" className="button secondary small" onClick={()=>setRetainedIds(retainedIds.filter(id=>id!==f.id))}>이번 버전에서 제외</button></div>)}</div>}<FilePicker files={files} onChange={setFiles} roles={["problem","solution","rubric"]} items={parsedItems} material /><div className="p-section-line"><h3>문항 <span className="p-optional">선택</span></h3><button type="button" className="button secondary small" onClick={()=>setItems([...items,{id:crypto.randomUUID(),label:String(items.length+1),max:"",criteria:""}])}><Plus/> 문항 추가</button></div>{!items.length&&<p className="p-help">문항 번호와 배점은 아는 만큼만 입력하세요.</p>}{items.map(item=>{const match=item.label.match(/^(\d+)(?:-(\d+))?(?:번)?$/);return <div className="p-item-edit" key={item.id}><div className="p-grid-two"><label>문항 번호<div className="p-number-picker"><input aria-label="문항 번호" type="number" min={1} max={100} required value={match?.[1]??""} onChange={e=>setItems(items.map(i=>i.id===item.id?{...i,label:`${e.target.value}${match?.[2]?`-${match[2]}`:""}`}:i))}/><span> - </span><select aria-label="문항 번호 뒤 숫자" value={match?.[2]??""} onChange={e=>setItems(items.map(i=>i.id===item.id?{...i,label:`${match?.[1]??1}${e.target.value?`-${e.target.value}`:""}`}:i))}><option value="">없음</option>{Array.from({length:30},(_,i)=><option key={i+1}>{i+1}</option>)}</select></div>{!match&&<span className="p-help">기존 이름: {item.label} · 번호를 선택해 주세요.</span>}</label><label>배점<input required type="number" min="0.1" step="0.1" value={item.max} onChange={e=>setItems(items.map(i=>i.id===item.id?{...i,max:e.target.value}:i))}/></label></div><label>평가 기준 <span className="p-optional">선택 · 외부 기여 제외</span><textarea rows={2} value={item.criteria} onChange={e=>setItems(items.map(i=>i.id===item.id?{...i,criteria:e.target.value}:i))}/></label><button type="button" className="button ghost small" onClick={()=>setItems(items.filter(i=>i.id!==item.id))}>문항 삭제</button></div>;})}<label>시험 결과 공개 방식<select value={mode} onChange={e=>setMode(e.target.value as ReleaseMode)}>{Object.entries(releaseNames).map(([key,value])=><option value={key} key={key}>{value}</option>)}</select></label><label className="p-check"><input type="checkbox" checked={contribute} onChange={e=>setContribute(e.target.checked)}/><span>이 시험의 문제지를 개인용 프리미엄 학습 자료로 기여하겠습니다.</span></label><p className="p-help">선택하지 않으면 비공개 시험으로 등록됩니다. 문제 출처나 기여 동의는 필요하지 않습니다.</p></fieldset>{contribute&&<ContributionFields value={consent} setValue={setConsent} disabled={busy}/ >}{saved&&<p className="p-note">시험은 저장되었습니다. 기여 등록을 다시 시도해도 같은 시험을 사용합니다. 동의 내용과 출처를 확인한 뒤 다시 시도하거나 비공개 시험으로 남길 수 있습니다.</p>}{error&&<p className="p-error" role="alert">{error}</p>}{initialExam&&baseRevision!==initialExam.revision&&<button type="button" className="button secondary" onClick={()=>{if(window.confirm("작성 중인 변경을 버리고 최신 시험으로 다시 시작할까요?")){setBaseRevision(initialExam.revision);setTitle(initialExam.title);setItems(leafDraft(initialExam));setRetainedIds(initialExam.files.map(f=>f.id));setFiles([]);setError("");}}}>최신 시험으로 편집 다시 시작</button>}<button className="button primary" disabled={busy}>{busy?"저장 중…":saved?"기여 등록 다시 시도":contribute?"시험 등록 · 동의한 문제 기여":initialExam?"시험 변경 저장":"시험 등록"}</button>{saved&&<button type="button" className="button secondary" onClick={onDone}>기여 없이 저장한 시험으로 돌아가기</button>}</form>;
}

export function SubmissionForm({ data, classId, action, onDone, selectedExam, trial = false }: { data: ProductState; classId: string; action: ProductAction; onDone: (id: string) => void; selectedExam?: Exam | null; trial?: boolean }) {
  const teacher = !trial && data.profile?.accountType === "teacher"; const personal = trial || data.profile?.accountType === "personal";
  const options = data.assignments.filter(a => a.classId === classId && !a.cancelledAt && !data.classes.find(c=>c.id===a.classId)?.archivedAt);
  const [selection, setSelection] = useState(""); const assignment = options.find(a => a.id === selection) ?? options[0];
  const members = data.members.filter(m => m.classId === classId && m.role === "student");
  const [studentId, setStudentId] = useState(""); const student = members.find(m => m.userId === studentId) ?? members[0];
  const [title, setTitle] = useState(selectedExam?.title ?? ""); const [source, setSource] = useState(selectedExam?.sourceLabel ?? "");
  const [question, setQuestion] = useState(""); const [files, setFiles] = useState<DraftFile[]>([]);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [requestId] = useState(() => crypto.randomUUID());
  async function submit(e: FormEvent) { e.preventDefault(); setError(""); setBusy(true); try {
    if (!files.some(f => f.role === "answer" || f.role === "mixed")) throw new Error("손글씨 답안 파일을 한 개 이상 첨부하세요.");
    if (personal && !files.some(f => f.role === "problem" || f.role === "mixed") && !selectedExam) throw new Error("문제 파일도 함께 첨부해 주세요. 문제와 풀이가 한 파일이면 ‘문제 + 학생 답안’을 선택하세요.");
    if (!personal && !assignment) throw new Error("선생님이 배정한 시험을 먼저 선택하세요.");
    if (teacher && !student) throw new Error("답안을 올릴 학생을 선택하세요.");
    const payload = personal ? { usePhoneTrial:trial, title, sourceLabel: source, sourceUrl: selectedExam?.sourceUrl ?? "", examId: selectedExam?.id, question, clientRequestId: requestId } : { assignmentId: assignment!.id, classId, studentId: teacher ? student!.userId : undefined, question, clientRequestId: requestId };
    const result = await action("submissions", packFiles(payload, files)); onDone(result.submission.id);
  } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }
  return <form className="p-form" onSubmit={submit}>
    {trial&&<p className="p-note">전화번호 인증으로 받은 무료 첨삭 1회를 이용합니다. AI 첨삭 성공 시 차감되며 유료 이용권 횟수는 사용하지 않습니다.</p>}
    <div className="p-note"><ImageIcon size={19} /><span>풀이를 타자로 옮기지 않아도 됩니다. 종이에 풀고 사진이나 스캔 PDF를 올려 주세요.</span></div>
    {!personal && <div className="p-grid-two"><label>배정된 시험<select required value={assignment?.id ?? ""} onChange={e => setSelection(e.target.value)}><option value="" disabled>시험 선택</option>{options.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label>{teacher && <label>대상 학생<select required value={student?.userId ?? ""} onChange={e => setStudentId(e.target.value)}><option value="" disabled>학생 선택</option>{members.map(m => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}</select></label>}</div>}
    {!personal && assignment && <div className="p-assignment-summary"><strong>{assignment.title}</strong><span>문제 자료는 과제에서 자동으로 연결됩니다.</span><span>{assignment.exam.files.filter(f => f.role === "problem" || f.role === "mixed").map(f => <a key={f.id} href={f.url} target="_blank" rel="noreferrer">{f.name} ↗</a>)}</span></div>}
    {personal && <div className="p-grid-two"><label>시험 이름<input required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 2027학년도 모의논술" /></label><label>문제 출처 <span className="p-optional">선택</span><input maxLength={500} value={source} onChange={e => setSource(e.target.value)} placeholder="학교 · 시험명 또는 교재명" /></label></div>}
    {selectedExam && <p className="p-note">선택한 프리미엄 시험 자료를 연결합니다: {selectedExam.title}</p>}
    <FilePicker files={files} onChange={setFiles} roles={personal && !selectedExam ? ["answer", "problem", "mixed"] : ["answer", "mixed"]} items={assignment?.exam.items ?? selectedExam?.items ?? []} />
    <label>궁금한 점 / 집중해서 봐줬으면 하는 점 <span className="p-optional">선택</span><textarea value={question} rows={3} maxLength={10000} onChange={e => setQuestion(e.target.value)} placeholder="예: 2번에서 구간을 나눈 이유가 적절한지 봐주세요." /></label>
    <p className="p-help">{teacher ? "대상 학생의 기록으로 저장되며 실제 제출자는 선생님으로 남습니다." : personal ? "문제·풀이·질문을 같은 시험 기록으로 비공개 저장합니다." : "로그인 계정으로 자동 연결됩니다. 별도 학생 코드나 결제는 필요하지 않습니다."}</p>
    {!data.capabilities.aiConfigured && <p className="p-note p-warning">현재 AI 미연결 · 제출 파일은 저장되며 AI 첨삭은 실행되지 않고 사용량도 차감되지 않습니다.</p>}
    {error && <p className="p-error" role="alert">{error}</p>}<button className="button primary" disabled={busy || (!personal && !assignment)}>{busy ? "파일 저장 중…" : teacher ? "학생 대신 제출" : "시험 답안 제출"}</button>
  </form>;
}

export function ContributionForm({ exams, name, action, onDone }: { exams: Exam[]; name: string; action: ProductAction; onDone: () => void }) {
  const options=exams.filter(e=>!e.originContributionId&&!e.legacyId), [selected,setSelected]=useState(""); const exam=options.find(e=>e.id===selected)??options[0];
  const [consent,setConsent]=useState(newConsent(name,exam)), [error,setError]=useState(""), [busy,setBusy]=useState(false);
  useEffect(()=>{setConsent(newConsent(name,exam));},[exam?.id,exam?.revision]);
  async function submit(event:FormEvent){event.preventDefault();setError("");setBusy(true);try{if(!exam)throw new Error("시험을 먼저 등록하세요.");await action("contributions",{examId:exam.id,revision:exam.revision,...consent});onDone();}catch(error){setError(errorText(error));}finally{setBusy(false);}}
  return <form className="p-form" onSubmit={submit}><label>기여할 시험<select value={exam?.id??""} onChange={e=>setSelected(e.target.value)}><option value="" disabled>시험 선택</option>{options.map(e=><option key={e.id} value={e.id}>{e.title}</option>)}</select></label>{exam&&<div className="p-contribution-preview"><strong>{exam.title} · v{exam.revision}</strong>{exam.files.filter(f=>f.role==="problem").map(f=><a key={f.id} href={f.url} target="_blank" rel="noreferrer">{f.name} ↗</a>)}</div>}<ContributionFields value={consent} setValue={setConsent} disabled={busy}/>{error&&<p className="p-error" role="alert">{error}</p>}<button className="button primary" disabled={busy||!exam}>{busy?"등록 중…":"동의한 자료 기여 등록"}</button></form>;
}

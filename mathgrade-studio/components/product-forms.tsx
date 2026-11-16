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

export function FilePicker({ files, onChange, roles, items = [] }: { files: DraftFile[]; onChange: (files: DraftFile[]) => void; roles: ExamFileRole[]; items?: ExamItem[] }) {
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
    <label className="p-dropzone" htmlFor={fieldId}><UploadCloud size={29} /><strong>사진 또는 PDF를 선택하세요</strong><span>종이에 푼 그대로 · 여러 장 동시 선택 · 파일당 15MB</span><input id={fieldId} type="file" multiple accept={fileTypes} onChange={e => { add(e.target.files); e.target.value = ""; }} /></label>
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

export function ExamForm({ data, classId, action, onDone, initialExam }: { data: ProductState; classId: string; action: ProductAction; onDone: () => void; initialExam?: Exam }) {
  const [title, setTitle] = useState(initialExam?.title ?? ""); const [source, setSource] = useState(initialExam?.sourceLabel ?? ""); const [sourceUrl, setSourceUrl] = useState(initialExam?.sourceUrl ?? "");
  const [files, setFiles] = useState<DraftFile[]>([]); const [mode, setMode] = useState<ReleaseMode>(initialExam?.releaseMode ?? data.classes.find(c => c.id === classId)?.releaseMode ?? "teacher_review");
  const [items, setItems] = useState<{ id: string; label: string; max: string; criteria: string; parentId: string }[]>((initialExam?.items ?? []).map(i => ({ id: i.id, label: i.label, max: String(i.maxScore), criteria: i.criteria, parentId: i.parentId ?? "" })));
  const [retainedIds, setRetainedIds] = useState(initialExam?.files.map(f => f.id) ?? []);
  useEffect(() => { if (!initialExam) return; setTitle(initialExam.title); setSource(initialExam.sourceLabel); setSourceUrl(initialExam.sourceUrl); setMode(initialExam.releaseMode); setItems(initialExam.items.map(i => ({ id: i.id, label: i.label, max: String(i.maxScore), criteria: i.criteria, parentId: i.parentId ?? "" }))); setRetainedIds(initialExam.files.map(f => f.id)); setFiles([]); }, [initialExam?.id, initialExam?.revision]);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const parsedItems = items.map(({ max, parentId, ...item }) => ({ ...item, maxScore: Number(max), parentId: parentId || undefined }));
  async function submit(e: FormEvent) { e.preventDefault(); setError(""); setBusy(true); try {
    if (![...files, ...(initialExam?.files.filter(f => retainedIds.includes(f.id)) ?? [])].some(f => f.role === "problem" || f.role === "mixed")) throw new Error("문제지 파일을 한 개 이상 첨부하세요.");
    if (parsedItems.some(i => !i.label.trim() || !Number.isFinite(i.maxScore) || i.maxScore <= 0)) throw new Error("문항 이름과 0보다 큰 배점을 확인하세요.");
    await action("exams", packFiles({ id: initialExam?.id, revision: initialExam?.revision, retainedFileIds: retainedIds, title, sourceLabel: source, sourceUrl, classId: initialExam ? initialExam.classId : classId || null, items: parsedItems, releaseMode: mode }, files)); onDone();
  } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }
  return <form onSubmit={submit} className="p-form">
    <p className="p-note">문제지를 먼저 올려 주세요. 답지·해설·채점기준과 문항 구조는 있는 만큼만 등록하면 됩니다.</p>
    <label>시험 이름<input required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="예: A대 대비 3회 실전 논술" /></label>
    <div className="p-grid-two"><label>문제 출처<input required maxLength={500} value={source} onChange={e => setSource(e.target.value)} placeholder="학교 · 시행 연도 또는 자체 제작" /></label><label>출처 링크 <span className="p-optional">선택</span><input type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://" /></label></div>
    {initialExam && <div className="p-retained-files"><h3>기존 자료 · v{initialExam.revision}</h3><p className="p-help">교체할 파일은 목록에서 제외한 뒤 새 파일을 올리세요. 이미 배정한 과제와 제출 기록의 원본은 유지됩니다.</p>{initialExam.files.filter(f => retainedIds.includes(f.id)).sort((a, b) => retainedIds.indexOf(a.id) - retainedIds.indexOf(b.id)).map((file, index) => <div className="p-file-row" key={file.id}><div className="p-file-info"><a href={file.url} target="_blank" rel="noreferrer">{file.name} ↗</a><span>{roleNames[file.role]}</span></div><button type="button" className="icon-button" disabled={index === 0} aria-label={`${file.name} 기존 파일 위로`} onClick={() => { const next = [...retainedIds]; [next[index], next[index - 1]] = [next[index - 1], next[index]]; setRetainedIds(next); }}><ArrowUp size={15} /></button><button type="button" className="button secondary small" onClick={() => setRetainedIds(retainedIds.filter(id => id !== file.id))}>이번 버전에서 제외</button></div>)}</div>}<FilePicker files={files} onChange={setFiles} roles={["problem", "solution", "rubric"]} items={parsedItems} />
    <div className="p-section-line"><h3>문항 · 소문항 구조 <span className="p-optional">선택</span></h3><button type="button" className="button secondary small" onClick={() => setItems([...items, { id: crypto.randomUUID(), label: `${items.length + 1}번`, max: "", criteria: "", parentId: "" }])}><Plus /> 문항 추가</button></div>
    {!items.length && <p className="p-help">모르는 문항 구조나 채점기준을 억지로 입력할 필요가 없습니다. AI 연결 후 판독·일반 평가 기준을 이용합니다.</p>}
    {items.map((item, index) => <div className="p-item-edit" key={item.id}><div className="p-grid-two"><label>문항명<input required value={item.label} onChange={e => setItems(items.map(i => i.id === item.id ? { ...i, label: e.target.value } : i))} /></label><label>배점<input required type="number" min="0.1" step="0.1" value={item.max} onChange={e => setItems(items.map(i => i.id === item.id ? { ...i, max: e.target.value } : i))} /></label></div><label>소문항 소속<select value={item.parentId} onChange={e => setItems(items.map(i => i.id === item.id ? { ...i, parentId: e.target.value } : i))}><option value="">독립 문항</option>{items.slice(0, index).map(i => <option key={i.id} value={i.id}>{i.label}</option>)}</select></label><label>평가 항목 · 유의사항 <span className="p-optional">선택</span><textarea rows={2} value={item.criteria} onChange={e => setItems(items.map(i => i.id === item.id ? { ...i, criteria: e.target.value } : i))} /></label><button type="button" className="button ghost small" onClick={() => setItems(items.filter(i => i.id !== item.id).map(i => i.parentId === item.id ? { ...i, parentId: "" } : i))}>문항 삭제</button></div>)}
    <label>시험 결과 공개 방식<select value={mode} onChange={e => setMode(e.target.value as ReleaseMode)}><option value="teacher_review">선생님 검토 후 공개</option><option value="ai_immediate">AI 첨삭 완료 즉시 공개 · 선생님 검토 전 표시</option></select></label>
    <p className="p-help">문제와 자료는 담당 반 안에서만 사용됩니다. 프리미엄 제공 동의는 별도로 받습니다.</p>
    {error && <p className="p-error" role="alert">{error}</p>}<button className="button primary" disabled={busy}>{busy ? "시험 저장 중…" : initialExam ? "시험 변경 저장" : "시험 등록"}</button>
  </form>;
}

export function SubmissionForm({ data, classId, action, onDone, selectedExam }: { data: ProductState; classId: string; action: ProductAction; onDone: (id: string) => void; selectedExam?: Exam | null }) {
  const teacher = data.profile?.accountType === "teacher"; const personal = data.profile?.accountType === "personal";
  const options = data.assignments.filter(a => a.classId === classId);
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
    if (teacher && !student) throw new Error("대리 제출할 반의 학생을 선택하세요.");
    const payload = personal ? { title, sourceLabel: source, sourceUrl: selectedExam?.sourceUrl ?? "", examId: selectedExam?.id, question, clientRequestId: requestId } : { assignmentId: assignment!.id, classId, studentId: teacher ? student!.userId : undefined, question, clientRequestId: requestId };
    const result = await action("submissions", packFiles(payload, files)); onDone(result.submission.id);
  } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }
  return <form className="p-form" onSubmit={submit}>
    <div className="p-note"><ImageIcon size={19} /><span>풀이를 타자로 옮기지 않아도 됩니다. 종이에 풀고 사진이나 스캔 PDF를 올려 주세요.</span></div>
    {!personal && <div className="p-grid-two"><label>배정된 시험<select required value={assignment?.id ?? ""} onChange={e => setSelection(e.target.value)}><option value="" disabled>시험 선택</option>{options.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label>{teacher && <label>대상 학생<select required value={student?.userId ?? ""} onChange={e => setStudentId(e.target.value)}><option value="" disabled>학생 선택</option>{members.map(m => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}</select></label>}</div>}
    {!personal && assignment && <div className="p-assignment-summary"><strong>{assignment.title}</strong><span>문제 자료는 과제에서 자동으로 연결됩니다.</span><span>{assignment.exam.files.filter(f => f.role === "problem" || f.role === "mixed").map(f => <a key={f.id} href={f.url} target="_blank" rel="noreferrer">{f.name} ↗</a>)}</span></div>}
    {personal && <div className="p-grid-two"><label>시험 이름<input required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 2027학년도 모의논술" /></label><label>문제 출처<input required maxLength={500} value={source} onChange={e => setSource(e.target.value)} placeholder="학교 · 시험명 또는 교재명" /></label></div>}
    {selectedExam && <p className="p-note">선택한 프리미엄 시험 자료를 연결합니다: {selectedExam.title}</p>}
    <FilePicker files={files} onChange={setFiles} roles={personal && !selectedExam ? ["answer", "problem", "mixed"] : ["answer", "mixed"]} items={assignment?.exam.items ?? selectedExam?.items ?? []} />
    <label>궁금한 점 / 집중해서 봐줬으면 하는 점 <span className="p-optional">선택</span><textarea value={question} rows={3} maxLength={10000} onChange={e => setQuestion(e.target.value)} placeholder="예: 2번에서 구간을 나눈 이유가 적절한지 봐주세요." /></label>
    <p className="p-help">{teacher ? "대상 학생의 기록으로 저장되며 실제 제출자는 선생님으로 남습니다." : personal ? "문제·풀이·질문을 같은 시험 기록으로 비공개 저장합니다." : "로그인 계정으로 자동 연결됩니다. 별도 학생 코드나 결제는 필요하지 않습니다."}</p>
    {!data.capabilities.aiConfigured && <p className="p-note p-warning">현재 AI 미연결 · 제출 파일은 저장되며 AI 첨삭은 실행되지 않고 사용량도 차감되지 않습니다.</p>}
    {error && <p className="p-error" role="alert">{error}</p>}<button className="button primary" disabled={busy || (!personal && !assignment)}>{busy ? "파일 저장 중…" : teacher ? "학생 대신 제출" : "시험 답안 제출"}</button>
  </form>;
}

export function ContributionForm({ exams, name, action, onDone }: { exams: Exam[]; name: string; action: ProductAction; onDone: () => void }) {
  const options = exams.filter(e => !e.originContributionId && !e.legacyId);
  const [selected, setSelected] = useState(""); const exam = options.find(e => e.id === selected) ?? options[0];
  const [contributor, setContributor] = useState(name); const [basis, setBasis] = useState("own"); const [note, setNote] = useState("");
  const [rights, setRights] = useState(false); const [consent, setConsent] = useState(false); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { setRights(false); setConsent(false); }, [exam?.id, exam?.revision]);
  async function submit(e: FormEvent) { e.preventDefault(); setError(""); setBusy(true); try { if (!exam) throw new Error("기여할 시험을 먼저 등록하세요."); await action("contributions", { examId: exam.id, revision: exam.revision, contributorName: contributor, rightsBasis: basis, rightsNote: note, rightsConfirmed: rights, premiumConfirmed: consent }); onDone(); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }
  return <form className="p-form" onSubmit={submit}><p className="p-note">학원 내부 등록과 별개입니다. 동의한 자료만 개인용 유료 프리미엄 학습자에게 제공됩니다.</p><label>기여할 시험<select value={exam?.id ?? ""} onChange={e => { setSelected(e.target.value); setConsent(false); setRights(false); }}><option value="" disabled>시험 선택</option>{options.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>{exam && <div className="p-contribution-preview"><strong>{exam.title} · v{exam.revision}</strong><p>{exam.sourceLabel}</p>{exam.files.filter(f => f.role === "problem").map(f => <a key={f.id} href={f.url} target="_blank" rel="noreferrer">{f.name} ↗</a>)}<p>{exam.items.length}개 문항 · 문제지 파일과 문항 구조만 제공합니다. 답지·채점기준·학생 답안·대화는 포함되지 않습니다.</p></div>}<label>공개 기여자 이름<input required value={contributor} maxLength={80} onChange={e => setContributor(e.target.value)} /></label><label>제공 권한 근거<select value={basis} onChange={e => setBasis(e.target.value)}><option value="own">본인에게 저작권이 있는 자체 제작 자료</option><option value="permission">권리자에게 유료 서비스 제공 허락을 받은 자료</option></select></label><label>권한 근거 · 허락 범위<textarea required={basis === "permission"} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} rows={3} /></label><label className="p-check"><input type="checkbox" required checked={rights} onChange={e => setRights(e.target.checked)} /><span>등록 자료를 제공할 권리가 있음을 확인합니다. 출처 표시만으로 이용 허락을 대신할 수 없음을 확인했습니다.</span></label><label className="p-check"><input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} /><span>이 자료가 다른 학생의 학습에 사용되며, 개인용 유료 프리미엄 회원에게 제공되는 데 별도로 동의합니다.</span></label><p className="p-help">동의 내용·범위·시각·자료 버전을 보관합니다. 포인트 정책이 확정되기 전에는 적립 대기로 기록하며 금액이나 사용처를 보장하지 않습니다.</p>{error && <p className="p-error" role="alert">{error}</p>}<button className="button primary" disabled={busy || !exam}>{busy ? "등록 중…" : "동의한 자료 기여 등록"}</button></form>;
}

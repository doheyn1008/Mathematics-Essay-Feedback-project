import type { AccountType, ClassRoom, Contribution, Exam, ExamFile, ExamFileRole, ExamItem, ExamResult, ExamSubmission, FeedbackVersion, ProductState, ReleaseMode, SubmissionDetail } from "../product-types";
import { ApiError } from "./api";
import { validateExamResult } from "../server/product-analysis";

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
function fail(message: string, status = 400, code?: string): never { throw new ApiError(message, status, code); }
function text(value: unknown, label: string, maximum: number, required = false): string {
  if (value == null && !required) return "";
  if (typeof value !== "string" || value.trim().length > maximum || (required && !value.trim())) return fail(`${label}을 확인하세요.`);
  return value.trim();
}
function checkRevision(value: unknown, expected: number) {
  if (value !== expected) fail("다른 창에서 수정되었습니다. 최신 기록을 다시 불러오세요.", 409, "REVISION_CONFLICT");
}
function studentExam(exam: Exam): Exam { return { ...structuredClone(exam), items: exam.items.map(item => ({ ...item, criteria: "" })), files: exam.files.filter(file => file.role === "problem" || file.role === "mixed").map(file => ({ ...file })) }; }
function release(value: unknown, fallback: ReleaseMode): ReleaseMode { if (value === undefined) return fallback; if (value !== "teacher_review" && value !== "ai_immediate") fail("공개 방식을 확인하세요."); return value; }
function sourceUrl(value: unknown): string {
  const url = text(value, "출처 주소", 2000);
  if (url) { try { if (!["http:", "https:"].includes(new URL(url).protocol)) fail("출처 주소를 확인하세요."); } catch { fail("출처 주소를 확인하세요."); } }
  return url;
}
function itemsInput(value: unknown): ExamItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) fail("문항은 100개까지 등록할 수 있습니다.");
  const items = value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail("문항 구조를 확인하세요.");
    if (typeof item.maxScore !== "number" || !Number.isFinite(item.maxScore) || item.maxScore < 0.01 || item.maxScore > 1000) fail("문항 배점을 확인하세요.");
    return { id: text(item.id, "문항 ID", 100) || id(), label: text(item.label, "문항명", 150, true), maxScore: item.maxScore, criteria: text(item.criteria, "평가 기준", 10000), ...(item.parentId ? { parentId: text(item.parentId, "상위 문항", 100, true) } : {}) };
  });
  if (new Set(items.map(item => item.id)).size !== items.length) fail("문항 ID가 중복됩니다.");
  for (const item of items) { const seen = new Set([item.id]); let parent = item.parentId; while (parent) { if (seen.has(parent)) fail("소문항 구조에 순환이 있습니다."); seen.add(parent); const entry = items.find(part => part.id === parent); if (!entry) fail("상위 문항이 없습니다."); parent = entry.parentId; } }
  return items;
}
export type DemoPersona = "teacher" | "academy_student" | "personal" | "premium";
const personas: Record<DemoPersona, { id: string; name: string; role: AccountType }> = {
  teacher: { id: "demo-teacher", name: "유지민 선생님", role: "teacher" },
  academy_student: { id: "demo-student", name: "김서연", role: "academy_student" },
  personal: { id: "demo-personal", name: "개인 학습자", role: "personal" },
  premium: { id: "demo-personal", name: "개인 학습자", role: "personal" },
};

/** Isolated synthetic workspace. Never calls a production endpoint or generates AI results. */
export class ProductDemo {
  persona: DemoPersona = "teacher";
  state: ProductState;
  details: Record<string, SubmissionDetail> = {};
  private requests = new Map<string, string>();
  private originalFiles = new Map<string, File>();
  private contributionHashes = new Map<string, string>();
  constructor() {
    const createdAt = now();
    const classes: ClassRoom[] = [
      { id: "class-a", name: "A대 수리논술 심화반", createdBy: "demo-teacher", billingTeacherId: "demo-teacher", releaseMode: "teacher_review", studentCode: "DEMO-A-STUDENT", teacherCode: "DEMO-A-TEACHER", createdAt },
      { id: "class-b", name: "B대 수리논술 실전반", createdBy: "demo-teacher", billingTeacherId: "demo-teacher", releaseMode: "ai_immediate", studentCode: "DEMO-B-STUDENT", teacherCode: "DEMO-B-TEACHER", createdAt },
    ];
    const exam: Exam = { id: "exam-a", ownerId: "demo-teacher", classId: "class-a", title: "미분과 적분 · 주간 논술 3회", sourceLabel: "수식채점실 자체 작성 · 체험용 가상 시험", sourceUrl: "", items: [{ id: "q1", label: "1번 · 극값의 존재", maxScore: 40, criteria: "도함수의 부호와 극값의 존재 조건을 논리적으로 설명" }, { id: "q2", label: "2번 · 정적분의 활용", maxScore: 60, criteria: "구간 분할, 식의 구성과 계산 과정 평가" }], files: [], releaseMode: "teacher_review", revision: 1, createdAt };
    const examB: Exam = { ...structuredClone(exam), id: "exam-b", classId: "class-b", title: "함수의 추론 · 실전 논술 1회", releaseMode: "ai_immediate" };
    const result: ExamResult = { items: [{ itemId: "q1", label: "1번 · 극값의 존재", score: 32, maxScore: 40, evidence: "도함수의 영점을 찾았으나 부호 변화의 근거가 한 단계 생략되었습니다.", feedback: "증가·감소 표를 제시한 뒤 극값을 결론 내리세요.", solution: "정의역을 먼저 확인하고, 도함수의 부호가 바뀌는지 구간별로 판단합니다.", uncertainty: "" }, { itemId: "q2", label: "2번 · 정적분의 활용", score: 48, maxScore: 60, evidence: "적분식과 계산은 적절하며, 넓이에 대한 절댓값 처리가 부족합니다.", feedback: "그래프가 x축 아래에 놓이는 구간의 부호를 확인하세요.", solution: "교점을 기준으로 적분 구간을 나누고 각 구간 넓이를 더합니다.", uncertainty: "" }], total: 80, maximum: 100, summary: "핵심 아이디어를 잘 잡았습니다. 결론을 쓰기 전에 조건을 확인하는 문장을 한 줄씩 보강하면 풀이의 완성도가 높아집니다.", questionResponse: "극값의 존재는 도함수가 0인 것만으로 충분하지 않습니다. 그 점의 좌우에서 도함수의 부호가 바뀌는지도 확인해야 합니다.", basis: "provided", uncertainties: [] };
    const aiVersion: FeedbackVersion = { id: "v-ai", submissionId: "sub-a", version: 1, authorId: "demo-ai", authorName: "AI 예시 결과", authorType: "ai", createdAt, result, teacherReviewed: false, published: false };
    const teacherVersion: FeedbackVersion = { ...structuredClone(aiVersion), id: "v-teacher", version: 2, authorId: "demo-teacher", authorName: "유지민 선생님", authorType: "teacher", teacherReviewed: true, published: true };
    const a: ExamSubmission = { id: "sub-a", studentId: "demo-student", studentName: "김서연", submittedBy: "demo-student", classId: "class-a", assignmentId: "assignment-a", billingUserId: "demo-teacher", exam, files: [], question: "도함수가 0이 되는 점을 모두 극값이라고 써도 되나요?", processing: "completed", visibility: "visible", reviewStatus: "reviewed", releaseMode: "teacher_review", latestVersion: teacherVersion, revision: 2, createdAt, updatedAt: createdAt };
    const b: ExamSubmission = { ...structuredClone(a), id: "sub-b", studentId: "demo-student-2", studentName: "이준호", submittedBy: "demo-teacher", latestVersion: null, visibility: "private", reviewStatus: "unreviewed", processing: "not_configured", revision: 1, question: "2번 풀이의 흐름을 집중해서 봐주세요." };
    const c: ExamSubmission = { ...structuredClone(a), id: "sub-c", classId: "class-b", assignmentId: "assignment-b", exam: examB, releaseMode: "ai_immediate", reviewStatus: "unreviewed", latestVersion: { ...structuredClone(aiVersion), id: "v-ai-b", submissionId: "sub-c", published: true }, revision: 1 };
    this.details = { "sub-a": { submission: a, versions: [aiVersion, teacherVersion], messages: [{ id: "message-a", submissionId: "sub-a", authorId: "demo-student", authorName: "김서연", authorRole: "student", itemId: "q1", text: "부호 변화 표를 추가해서 다시 풀어 보겠습니다!", createdAt }] }, "sub-b": { submission: b, versions: [], messages: [] }, "sub-c": { submission: c, versions: [c.latestVersion!], messages: [] } };
    this.state = { user: null, profile: null, entitlement: null, classes, members: classes.flatMap(c => [{ classId: c.id, userId: "demo-teacher", role: "teacher" as const, displayName: "유지민 선생님", joinedAt: createdAt }, { classId: c.id, userId: "demo-student", role: "student" as const, displayName: "김서연", joinedAt: createdAt }, { classId: c.id, userId: "demo-student-2", role: "student" as const, displayName: "이준호", joinedAt: createdAt }]), exams: [exam, examB], assignments: [{ id: "assignment-a", classId: "class-a", title: exam.title, exam, dueAt: null, createdAt }, { id: "assignment-b", classId: "class-b", title: examB.title, exam: examB, dueAt: null, createdAt }], submissions: [a, b, c], contributions: [], points: [], capabilities: { storageReady: true, aiConfigured: false, billingConfigured: false }, policy: { pricesConfigured: false, contributionPoints: null, contributionPolicyVersion: null } };
  }
  private teacherFor(classId: string | null): boolean {
    const person = personas[this.persona];
    return person.role === "teacher" && !!classId && this.state.members.some(member => member.classId === classId && member.userId === person.id && member.role === "teacher");
  }
  private requireTeacher(classId?: string | null): void {
    if (personas[this.persona].role !== "teacher" || (classId !== undefined && !this.teacherFor(classId))) fail("담당 반의 선생님만 이용할 수 있습니다.", 403);
  }
  private requirePremium(): void { if (this.persona !== "premium") fail("개인용 프리미엄 이용권이 필요합니다.", 402, "ENTITLEMENT_REQUIRED"); }
  private classroom(classId: string): ClassRoom { const classroom = this.state.classes.find(item => item.id === classId); if (!classroom) fail("반을 찾을 수 없습니다.", 404); return classroom; }
  private access(submissionId: string): SubmissionDetail {
    const detail = this.details[submissionId];
    if (!detail) fail("시험 기록을 찾을 수 없습니다.", 404);
    if (!this.teacherFor(detail.submission.classId) && detail.submission.studentId !== personas[this.persona].id) fail("본인 또는 담당 반 학생의 기록만 볼 수 있습니다.", 403);
    return detail;
  }
  getState(): ProductState {
    const person = personas[this.persona];
    const data = structuredClone(this.state);
    const memberships = data.members.filter(member => member.userId === person.id);
    const classIds = new Set(memberships.map(member => member.classId));
    const teacherClasses = new Set(memberships.filter(member => member.role === "teacher" && person.role === "teacher").map(member => member.classId));
    data.user = { id: person.id, name: person.name, email: "demo@example.test" };
    data.profile = { userId: person.id, accountType: person.role, displayName: person.name, createdAt: now() };
    data.entitlement = person.role === "academy_student" ? null : { userId: person.id, plan: person.role === "teacher" ? "teacher" : this.persona === "premium" ? "personal_premium" : "personal_basic", status: "active", expiresAt: null, analysisLimit: null, used: 0 };
    data.classes = data.classes.filter(classroom => classIds.has(classroom.id)).map(classroom => teacherClasses.has(classroom.id) ? classroom : { ...classroom, teacherCode: undefined, studentCode: undefined });
    data.members = data.members.filter(member => member.userId === person.id || teacherClasses.has(member.classId));
    data.assignments = data.assignments.filter(assignment => classIds.has(assignment.classId)).map(assignment => teacherClasses.has(assignment.classId) ? assignment : { ...assignment, exam: studentExam(assignment.exam) });
    data.submissions = data.submissions.filter(submission => submission.studentId === person.id || (!!submission.classId && teacherClasses.has(submission.classId))).map(submission => this.detail(submission.id).submission);
    data.exams = data.exams.filter(exam => exam.ownerId === person.id || (!!exam.classId && teacherClasses.has(exam.classId)));
    data.contributions = person.role === "teacher" ? data.contributions.filter(contribution => contribution.contributorId === person.id) : [];
    data.points = person.role === "teacher" ? data.points.filter(point => data.contributions.some(contribution => contribution.id === point.contributionId)) : [];
    return data;
  }
  detail(submissionId: string): SubmissionDetail {
    const detail = structuredClone(this.access(submissionId));
    if (!this.teacherFor(detail.submission.classId)) {
      detail.versions = detail.versions.filter(version => version.published);
      const latest = [...detail.versions].sort((a, b) => b.version - a.version)[0] ?? null;
      detail.submission = { ...detail.submission, exam: studentExam(detail.submission.exam), latestVersion: latest, visibility: latest ? "visible" : "private", reviewStatus: latest?.teacherReviewed ? "reviewed" : "unreviewed" };
    }
    detail.versions.sort((a, b) => b.version - a.version);
    return detail;
  }
  premiumCatalog(): Contribution[] {
    this.requirePremium();
    return this.state.contributions.filter(contribution => contribution.status === "published").map(contribution => ({ ...structuredClone(contribution), rightsNote: "" }));
  }
  async request(path: string, payload: unknown = {}): Promise<Record<string, unknown>> {
    const person = personas[this.persona];
    const form = payload instanceof FormData ? payload : null;
    let body: Record<string, any>;
    try { body = form ? JSON.parse(String(form.get("payload"))) : payload; } catch { fail("제출 정보를 확인하세요."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) fail("입력 내용을 확인하세요.");
    const uploaded = async (): Promise<ExamFile[]> => {
      if (!form) return [];
      const raw = form.getAll("files");
      if (!Array.isArray(body.fileMeta) || body.fileMeta.length !== raw.length || raw.length > 12) fail("파일 분류를 확인하세요. 한 번에 12개까지 가능합니다.");
      let total = 0;
      const result: ExamFile[] = [];
      for (let index = 0; index < raw.length; index++) {
        const file = raw[index]; const meta = body.fileMeta[index];
        if (!(file instanceof File) || !file.size || file.size > 15 * 1024 * 1024) fail("파일별 15MB 이하의 원본을 첨부하세요.");
        total += file.size; if (total > 60 * 1024 * 1024) fail("전체 파일은 60MB까지 가능합니다.");
        if (!meta || !["problem", "answer", "mixed", "solution", "rubric"].includes(meta.role) || !Number.isInteger(meta.order) || meta.order < 0 || meta.order >= 12) fail("파일 종류와 순서를 확인하세요.");
        const head = new Uint8Array(await file.slice(0, 16).arrayBuffer()); const ascii = new TextDecoder().decode(head);
        const signatures: Record<string, boolean> = { "application/pdf": ascii.startsWith("%PDF-"), "image/jpeg": head[0] === 255 && head[1] === 216 && head[2] === 255, "image/png": head[0] === 137 && head[1] === 80 && head[2] === 78 && head[3] === 71 && head[4] === 13 && head[5] === 10 && head[6] === 26 && head[7] === 10, "image/webp": ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP" };
        if (!Object.hasOwn(signatures, file.type) || signatures[file.type] !== true) fail("유효한 JPG, PNG, WEBP 또는 PDF 파일을 첨부하세요.");
        const item: ExamFile = { id: id(), name: text(file.name, "파일 이름", 250, true), type: file.type, size: file.size, url: URL.createObjectURL(file), role: meta.role as ExamFileRole, order: meta.order, ...(meta.itemId ? { itemId: text(meta.itemId, "연결 문항", 100, true) } : {}) };
        this.originalFiles.set(item.id, file); result.push(item);
      }
      if (new Set(result.map(file => file.order)).size !== result.length) fail("파일 순서가 중복됩니다.");
      return result.sort((a, b) => a.order - b.order);
    };
    const matchItems = (files: ExamFile[], items: ExamItem[]) => { if (files.some(file => file.itemId && !items.some(item => item.id === file.itemId))) fail("파일의 연결 문항을 확인하세요."); };
    if (path === "classes") {
      this.requireTeacher();
      if (body.billingTeacherId !== person.id) fail("이용권 담당자로 본인을 명시적으로 선택하세요.");
      const classroom: ClassRoom = { id: id(), name: text(body.name, "반 이름", 100, true), createdBy: person.id, billingTeacherId: person.id, releaseMode: release(body.releaseMode, "teacher_review"), studentCode: `S${id().replaceAll("-", "").slice(0, 16).toUpperCase()}`, teacherCode: `T${id().replaceAll("-", "").slice(0, 16).toUpperCase()}`, createdAt: now() };
      this.state.classes.push(classroom); this.state.members.push({ classId: classroom.id, userId: person.id, role: "teacher", displayName: person.name, joinedAt: now() }); return { classroom: structuredClone(classroom) };
    }
    if (path === "classes/join") {
      if (person.role === "personal") fail("개인 계정에서는 반에 참여할 수 없습니다.", 403);
      const code = text(body.code, "참여 코드", 40, true).toUpperCase();
      const classroom = this.state.classes.find(entry => (person.role === "teacher" ? entry.teacherCode : entry.studentCode) === code);
      if (!classroom) fail("계정 유형에 맞는 반 참여 코드를 확인하세요.", 404);
      if (!this.state.members.some(member => member.classId === classroom.id && member.userId === person.id)) this.state.members.push({ classId: classroom.id, userId: person.id, role: person.role === "teacher" ? "teacher" : "student", displayName: person.name, joinedAt: now() });
      return { classroom: person.role === "teacher" ? structuredClone(classroom) : { ...structuredClone(classroom), teacherCode: undefined, studentCode: undefined } };
    }
    if (/^classes\/[^/]+\/settings$/.test(path)) {
      const classroom = this.classroom(path.split("/")[1]); this.requireTeacher(classroom.id);
      const payer = text(body.billingTeacherId, "이용권 담당자", 100, true);
      if (payer !== classroom.billingTeacherId && payer !== person.id) fail("비용을 부담할 선생님이 직접 수락해야 합니다.", 403);
      if (!this.state.members.some(member => member.classId === classroom.id && member.userId === payer && member.role === "teacher")) fail("담당 반의 선생님을 지정하세요.", 403);
      Object.assign(classroom, { billingTeacherId: payer, releaseMode: release(body.releaseMode, classroom.releaseMode) }); return { classroom: structuredClone(classroom) };
    }
    if (path === "exams") {
      if (person.role === "academy_student") fail("학생은 시험 자료를 등록할 수 없습니다.", 403);
      const examId = text(body.id, "시험 ID", 100) || id();
      const previous = this.state.exams.find(exam => exam.id === examId);
      if (previous && previous.ownerId !== person.id) fail("본인이 등록한 시험만 변경할 수 있습니다.", 403);
      if (previous) checkRevision(body.revision, previous.revision);
      const classId = text(body.classId, "반 ID", 100) || null; if (classId) this.requireTeacher(classId);
      const items = itemsInput(body.items); const files = await uploaded(); matchItems(files, items);
      if (files.some(file => file.role === "answer")) fail("학생 답안은 제출 메뉴에 올리세요.");
      const retainedIds = body.retainedFileIds ?? previous?.files.map(file => file.id) ?? [];
      if (!Array.isArray(retainedIds) || retainedIds.some(value => typeof value !== "string" || !previous?.files.some(file => file.id === value))) fail("기존 파일 목록을 확인하세요.");
      const retained = previous?.files.filter(file => retainedIds.includes(file.id)) ?? []; matchItems(retained, items);
      if (![...retained, ...files].some(file => file.role === "problem" || file.role === "mixed")) fail("문제지 파일을 한 개 이상 등록하세요.");
      if (retained.length + files.length > 12) fail("시험 자료는 12개까지 등록할 수 있습니다.");
      const exam: Exam = { id: examId, ownerId: person.id, classId, title: text(body.title, "시험 이름", 200, true), sourceLabel: body.sourceLabel === undefined ? previous?.sourceLabel ?? "" : text(body.sourceLabel, "문제 출처", 500), sourceUrl: body.sourceUrl === undefined ? previous?.sourceUrl ?? "" : sourceUrl(body.sourceUrl), items, files: [...retained, ...files].map((file, order) => ({ ...file, order })), releaseMode: release(body.releaseMode, classId ? this.classroom(classId).releaseMode : person.role === "personal" ? "ai_immediate" : "teacher_review"), revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? now(), ...(previous?.originContributionId ? { originContributionId: previous.originContributionId } : {}) };
      this.state.exams = [exam, ...this.state.exams.filter(entry => entry.id !== exam.id)]; return { exam: structuredClone(exam) };
    }
    if (path === "assignments") {
      const classId = text(body.classId, "반 ID", 100, true); this.requireTeacher(classId);
      const exam = this.state.exams.find(entry => entry.id === body.examId); if (!exam) fail("시험을 선택하세요.", 404);
      if ((exam.ownerId !== person.id && exam.classId !== classId) || (exam.classId && exam.classId !== classId)) fail("담당 반의 시험만 배정할 수 있습니다.", 403);
      if (!exam.files.some(file => file.role === "problem" || file.role === "mixed")) fail("문제 자료를 등록한 후 배정하세요.");
      const due = text(body.dueAt, "마감일", 100); if (due && !Number.isFinite(Date.parse(due))) fail("마감일을 확인하세요.");
      const assignment = { id: id(), classId, exam: structuredClone(exam), title: text(body.title, "과제 이름", 200, true), dueAt: due ? new Date(due).toISOString() : null, createdAt: now() };
      this.state.assignments.unshift(assignment); return { assignment: structuredClone(assignment) };
    }
    if (path === "submissions") {
      const requestKey = `${person.id}:${text(body.clientRequestId, "제출 요청 ID", 100, true)}`; const duplicate = this.requests.get(requestKey); if (duplicate) return { submission: this.detail(duplicate).submission };
      if (body.assignmentId && body.examId) fail("과제와 개인 시험 중 하나를 선택하세요.");
      const files = await uploaded(); if (!files.some(file => file.role === "answer" || file.role === "mixed")) fail("손글씨 답안 파일을 첨부하세요.");
      if (files.some(file => file.role === "solution" || file.role === "rubric")) fail("답지와 채점기준은 시험 자료 등록에서 추가하세요.");
      const assignment = body.assignmentId ? this.state.assignments.find(entry => entry.id === body.assignmentId) : undefined;
      let exam: Exam; let studentId = person.id; let studentName = person.name; let classId: string | null = null; let billingUserId = person.id; let direct = false;
      if (body.assignmentId) {
        if (!assignment) fail("배정된 시험을 찾을 수 없습니다.", 404);
        if (person.role === "personal") fail("개인 계정에서는 학원 과제를 제출할 수 없습니다.", 403);
        classId = assignment.classId; if (body.classId && body.classId !== classId) fail("선택한 반과 과제가 일치하지 않습니다.");
        const member = this.state.members.find(entry => entry.classId === classId && entry.userId === person.id); if (!member) fail("참여한 반의 시험만 제출할 수 있습니다.", 403);
        if (person.role === "teacher") { this.requireTeacher(classId); studentId = text(body.studentId, "대리 제출할 학생", 100, true); const target = this.state.members.find(entry => entry.classId === classId && entry.userId === studentId && entry.role === "student"); if (!target) fail("반에 소속된 학생을 선택하세요.", 403); studentName = target.displayName; }
        else if (member.role !== "student" || (body.studentId && body.studentId !== person.id)) fail("본인 답안만 제출할 수 있습니다.", 403);
        const classroom = this.classroom(classId); if (!this.state.members.some(member => member.classId === classId && member.userId === classroom.billingTeacherId && member.role === "teacher")) fail("반의 이용권 담당자를 확인하세요.");
        billingUserId = classroom.billingTeacherId; exam = structuredClone(assignment.exam);
        if (files.some(file => file.role === "problem")) fail("과제에는 답안 또는 혼합 파일만 제출하세요.");
      } else {
        if (person.role !== "personal") fail("학원 제출은 배정된 과제를 선택하세요.", 403);
        if (body.classId || (body.studentId && body.studentId !== person.id)) fail("본인 개인 시험만 제출할 수 있습니다.", 403);
        if (body.examId) { const existing = this.state.exams.find(entry => entry.id === body.examId); if (!existing || existing.ownerId !== person.id || existing.classId) fail("본인 개인 학습공간의 시험만 선택하세요.", 403); if (existing.originContributionId) this.requirePremium(); exam = structuredClone(existing); }
        else { if (!files.some(file => file.role === "problem" || file.role === "mixed")) fail("문제와 답안 파일을 함께 첨부하세요."); exam = { id: id(), ownerId: person.id, classId: null, title: text(body.title, "시험 이름", 200, true), sourceLabel: text(body.sourceLabel, "문제 출처", 500, true), sourceUrl: sourceUrl(body.sourceUrl), items: [], files: files.filter(file => file.role === "problem" || file.role === "mixed"), releaseMode: "ai_immediate", revision: 1, createdAt: now() }; direct = true; }
      }
      matchItems(files, exam.items);
      const submission: ExamSubmission = { id: id(), studentId, studentName, submittedBy: person.id, classId, assignmentId: assignment?.id ?? null, billingUserId, exam: structuredClone(exam), files, question: text(body.question, "궁금한 점", 10000), processing: "not_configured", visibility: "private", reviewStatus: "unreviewed", releaseMode: exam.releaseMode, latestVersion: null, revision: 1, createdAt: now(), updatedAt: now() };
      if (direct) this.state.exams.unshift(structuredClone(exam));
      this.state.submissions.unshift(submission); this.details[submission.id] = { submission, versions: [], messages: [] }; this.requests.set(requestKey, submission.id); return { submission: this.detail(submission.id).submission };
    }
    if (/^submissions\/[^/]+\/(analyze|review|messages)$/.test(path)) {
      const submissionId = path.split("/")[1]; const detail = this.access(submissionId);
      if (path.endsWith("/analyze")) { checkRevision(body.revision, detail.submission.revision); fail("AI는 아직 연결되지 않았습니다. 파일은 저장되며 이용 횟수는 차감되지 않습니다. 기존 결과는 가상 예시입니다.", 503, "AI_NOT_CONFIGURED"); }
      if (path.endsWith("/review")) {
        this.requireTeacher(detail.submission.classId); checkRevision(body.revision, detail.submission.revision);
        if (typeof body.publish !== "boolean") fail("공개 여부를 확인하세요.");
        const result = validateExamResult(body.result, detail.submission, body.publish);
        const version: FeedbackVersion = { id: id(), submissionId, version: Math.max(0, ...detail.versions.map(entry => entry.version)) + 1, authorId: person.id, authorName: person.name, authorType: "teacher", result, teacherReviewed: body.publish, published: body.publish, createdAt: now() };
        detail.versions.push(version); Object.assign(detail.submission, { latestVersion: version, revision: detail.submission.revision + 1, visibility: body.publish ? "visible" : detail.submission.visibility, reviewStatus: body.publish ? "reviewed" : detail.submission.reviewStatus, updatedAt: now() }); return { submission: structuredClone(detail.submission) };
      }
      const itemId = text(body.itemId, "관련 문항", 100) || null;
      if (itemId && !detail.submission.exam.items.some(item => item.id === itemId) && !detail.submission.latestVersion?.result.items.some(item => item.itemId === itemId)) fail("해당 시험의 문항을 선택하세요.");
      const message = { id: id(), submissionId, authorId: person.id, authorName: person.name, authorRole: this.teacherFor(detail.submission.classId) ? "teacher" as const : "student" as const, itemId, text: text(body.text, "대화 내용", 10000, true), createdAt: now() }; detail.messages.push(message); return { message: structuredClone(message) };
    }
    if (path === "contributions") {
      this.requireTeacher();
      if (body.rightsConfirmed !== true || body.premiumConfirmed !== true) fail("제공 권한과 유료 프리미엄 제공 동의를 각각 확인하세요.");
      if (body.rightsBasis !== "own" && body.rightsBasis !== "permission") fail("제공 권한 근거를 확인하세요.");
      const exam = this.state.exams.find(entry => entry.id === body.examId); if (!exam || exam.ownerId !== person.id) fail("본인이 등록한 시험만 기여할 수 있습니다.", 403);
      if (exam.originContributionId || exam.legacyId) fail("가져온 시험은 다시 기여할 수 없습니다.", 409, "IMPORTED_EXAM");
      const previous = this.state.contributions.find(contribution => contribution.sourceExamId === exam.id); if (previous) return { contribution: structuredClone(previous), pointsAwarded: 0 };
      checkRevision(body.revision, exam.revision);
      const contributorName = text(body.contributorName, "공개 이름", 80, true); const rightsNote = text(body.rightsNote, "권한 근거", 2000, body.rightsBasis === "permission");
      const sourceFiles = exam.files.filter(file => file.role === "problem").sort((a, b) => a.order - b.order); if (!sourceFiles.length) fail("문제지로 분류한 원본만 기여할 수 있습니다.");
      const hashes = await Promise.all(sourceFiles.map(async file => { const original = this.originalFiles.get(file.id); if (!original) fail("기여할 문제 원본을 찾을 수 없습니다."); const digest = await crypto.subtle.digest("SHA-256", await original.arrayBuffer()); return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""); }));
      // File hashing yields; check both the revision and idempotency again before committing.
      const committed = this.state.contributions.find(contribution => contribution.sourceExamId === exam.id);
      if (committed) return { contribution: structuredClone(committed), pointsAwarded: 0 };
      const currentExam = this.state.exams.find(entry => entry.id === exam.id);
      if (!currentExam) fail("시험을 찾을 수 없습니다.", 404);
      checkRevision(body.revision, currentExam.revision);
      const hash = JSON.stringify([...new Set(hashes)].sort());
      if ([...this.contributionHashes.values()].includes(hash)) fail("같은 문제 원본이 이미 기여되었습니다.", 409, "DUPLICATE_CONTRIBUTION");
      const contributionId = id(); const timestamp = now();
      const snapshot: Exam = { id: exam.id, ownerId: "", classId: null, title: exam.title, sourceLabel: text(body.sourceLabel ?? exam.sourceLabel,"기여 문제 출처",500,true), sourceUrl: sourceUrl(body.sourceUrl ?? exam.sourceUrl), items: exam.items.map(item=>({...item,criteria:""})), files: sourceFiles.map((file, index) => ({ ...file, name: `문제자료 ${index + 1}.${file.type === "application/pdf" ? "pdf" : file.type.split("/")[1]}`, order: index })), releaseMode: "ai_immediate", revision: exam.revision, createdAt: timestamp };
      const contribution: Contribution = { id: contributionId, sourceExamId: exam.id, sourceRevision: exam.revision, contributorId: person.id, contributorName, exam: snapshot, rightsBasis: body.rightsBasis, rightsNote, consentVersion: "premium-reuse-v1", consentScope: "개인용 유료 프리미엄 회원에게 문제 자료를 제공하고 해당 회원이 학습·첨삭에 이용하는 것에 동의합니다. 학생 답안과 비공개 참고자료는 포함하지 않습니다.", consentAt: timestamp, status: "published", rewardStatus: "policy_pending", createdAt: timestamp };
      this.state.contributions.unshift(contribution); this.contributionHashes.set(contribution.id, hash); return { contribution: structuredClone(contribution), pointsAwarded: 0 };
    }
    if (/^contributions\/[^/]+\/withdraw$/.test(path)) { const contribution = this.state.contributions.find(entry => entry.id === path.split("/")[1] && entry.contributorId === person.id); if (!contribution) fail("본인 기여 기록을 찾을 수 없습니다.", 404); contribution.status = "withdrawn"; return { contribution: structuredClone(contribution) }; }
    if (path === "premium") return { contributions: this.premiumCatalog() };
    if (/^premium\/[^/]+\/import$/.test(path)) {
      this.requirePremium(); const contributionId = path.split("/")[1];
      const existing = this.state.exams.find(exam => exam.originContributionId === contributionId && exam.ownerId === person.id); if (existing) return { exam: structuredClone(existing) };
      const contribution = this.state.contributions.find(entry => entry.id === contributionId && entry.status === "published"); if (!contribution) fail("현재 제공 중인 시험이 없습니다.", 404);
      const exam = { ...structuredClone(contribution.exam), id: id(), ownerId: person.id, classId: null, originContributionId: contribution.id, revision: 1, createdAt: now() }; this.state.exams.unshift(exam); return { exam: structuredClone(exam) };
    }
    fail("체험에서 지원하지 않는 요청입니다.", 404);
  }
}

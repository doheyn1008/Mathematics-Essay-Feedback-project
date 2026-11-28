// Product account, class and exam contracts. Legacy records remain readable.
import type { ExamDifficulty } from "./exam-difficulty";

export type AccountType = "teacher" | "academy_student" | "personal";
export type Plan = "teacher" | "personal_basic" | "personal_premium";
export type AccountMode = Plan | "academy_student";
export type OwnerAccess = { mode: AccountMode };
export type Profile = { userId: string; accountType: AccountType; displayName: string; createdAt: string };
export type Entitlement = { userId: string; plan: Plan; status: "active" | "inactive"; expiresAt: string | null; analysisLimit: number | null; used: number; source?: "owner" };
export type ReleaseMode = "teacher_review" | "ai_immediate";
export type ClassRoom = { archivedAt?: string; id: string; name: string; createdBy: string; billingTeacherId: string; releaseMode: ReleaseMode; studentCode?: string; teacherCode?: string; createdAt: string };
export type ClassMember = { classId: string; userId: string; role: "teacher" | "student"; displayName: string; joinedAt: string };
export type ExamFileRole = "problem" | "answer" | "mixed" | "solution" | "rubric";
export type ExamFile = { id: string; name: string; type: string; size: number; url: string; role: ExamFileRole; order: number; itemId?: string };
export type ExamItem = { id: string; label: string; parentId?: string; maxScore: number; criteria: string };
export type Exam = { archivedAt?: string; deletedAt?: string; id: string; ownerId: string; classId: string | null; title: string; difficulty?: ExamDifficulty; sourceLabel: string; sourceUrl: string; items: ExamItem[]; files: ExamFile[]; releaseMode: ReleaseMode; revision: number; createdAt: string; originContributionId?: string; legacyId?: string; legacyPrompt?: string };
export type ExamAssignment = { revision?: number; cancelledAt?: string; id: string; classId: string; exam: Exam; title: string; dueAt: string | null; createdAt: string };
export type ItemFeedback = { itemId: string; label: string; score: number; maxScore: number; evidence: string; feedback: string; solution: string; uncertainty: string };
export type ExamResult = { items: ItemFeedback[]; total: number; maximum: number; summary: string; questionResponse: string; basis: "general" | "provided"; uncertainties: string[] };
export type FeedbackVersion = { materialVersion?: number; id: string; submissionId: string; version: number; authorId: string; authorName: string; authorType: "ai" | "teacher"; createdAt: string; result: ExamResult; teacherReviewed: boolean; published: boolean };
export type FeedbackScore = Pick<ExamResult, "total" | "maximum">;
export type ExamSubmission = { firstFeedbackScore?: FeedbackScore | null; materialId?: string; materialVersion?: number; funding?: "phone_trial"; id: string; studentId: string; studentName: string; submittedBy: string; classId: string | null; assignmentId: string | null; billingUserId: string; exam: Exam; files: ExamFile[]; question: string; processing: "not_configured" | "ready" | "processing" | "completed" | "failed"; visibility: "private" | "visible"; reviewStatus: "unreviewed" | "reviewed"; releaseMode: ReleaseMode; latestVersion: FeedbackVersion | null; revision: number; createdAt: string; updatedAt: string; legacyId?: string; legacyAnswer?: string };
export type ExamMessage = { sequence?: number; id: string; submissionId: string; authorId: string; authorName: string; authorRole: "teacher" | "student"; itemId: string | null; text: string; createdAt: string };
export type Contribution = { id: string; sourceExamId: string; sourceRevision: number; contributorId: string; contributorName: string; exam: Exam; rightsBasis: "own" | "permission"; rightsNote: string; consentVersion: string; consentScope: string; consentAt: string; status: "published" | "withdrawn"; rewardStatus: "policy_pending" | "awarded"; createdAt: string };
export type ContributionPoint = { id: string; contributionId: string; amount: number; policyVersion: string; createdAt: string; kind?: "contribution" | "usage_reward" | "purchase" | "spending" };
export type NotificationPreferences = { google: boolean; kakao: boolean; submissions: boolean; feedback: boolean };
export type PhoneTrial = { configured:boolean; verified:boolean; maskedPhone:string|null; remaining:0|1; verifiedAt:string|null };
export type AccountSettings = { security?: { username: string | null; hasPassword: boolean; recoveryConfigured: boolean; withdrawalBlockers: string[] }; phoneTrial?:PhoneTrial; providers: { google: boolean; kakao: boolean }; links: {provider:"google"|"kakao";email:string}[]; preferences:NotificationPreferences; points:ContributionPoint[]; useReward:{amount:number|null;version:string|null}; notifications:{kind:string;channel:string;status:string;createdAt:string}[]; deliveryConfigured:boolean; purchasesConfigured:boolean };
export type ProductState = { ownerAccess?: OwnerAccess; departures?: {classId:string;userId:string;status:string;displayName:string}[]; phoneTrial?:PhoneTrial; user: { id: string; name: string; email: string } | null; profile: Profile | null; entitlement: Entitlement | null; classes: ClassRoom[]; members: ClassMember[]; exams: Exam[]; assignments: ExamAssignment[]; submissions: ExamSubmission[]; contributions: Contribution[]; points: ContributionPoint[]; capabilities: { storageReady: boolean; aiConfigured: boolean; billingConfigured: boolean }; policy: { pricesConfigured: boolean; contributionPoints: number | null; contributionPolicyVersion: string | null } };
export type SubmissionDetail = { materials?: SubmissionMaterial[]; submission: ExamSubmission; versions: FeedbackVersion[]; messages: ExamMessage[] };

export type SubmissionMaterial = { id: string; submissionId: string; version: number; files: ExamFile[]; question: string; authorId: string; createdAt: string };

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const academies = sqliteTable("academies", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  joinCode: text("join_code").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("academy_join_code_unique").on(table.joinCode)]);

export const memberships = sqliteTable("memberships", {
  academyId: text("academy_id").notNull().references(() => academies.id),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.academyId, table.userId] })]);

export const questions = sqliteTable("questions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  academyId: text("academy_id").references(() => academies.id),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
});

export const assignments = sqliteTable("assignments", {
  id: text("id").primaryKey(),
  academyId: text("academy_id").notNull().references(() => academies.id),
  data: text("data").notNull(),
  createdAt: text("created_at").notNull(),
});

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull(),
  academyId: text("academy_id").references(() => academies.id),
  assignmentId: text("assignment_id").references(() => assignments.id),
  mode: text("mode").notNull(),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
  clientRequestId: text("client_request_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("submission_request_unique").on(table.studentId, table.clientRequestId)]);

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").notNull().references(() => submissions.id),
  objectKey: text("object_key").notNull(),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
});

export const admissionRecords = sqliteTable("admission_records", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  data: text("data").notNull(),
  createdAt: text("created_at").notNull(),
});

export const usageEvents = sqliteTable("usage_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  submissionId: text("submission_id").notNull(),
  day: text("day").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("completed_analysis_unique").on(table.submissionId)]);

export const questionAttachments = sqliteTable("question_attachments", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  questionId: text("question_id").notNull().references(() => questions.id),
  objectKey: text("object_key").notNull(),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  kind: text("kind").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sharedQuestions = sqliteTable("shared_questions", {
  id: text("id").primaryKey(),
  sourceQuestionId: text("source_question_id").notNull().references(() => questions.id),
  contributorId: text("contributor_id").notNull(),
  contentHash: text("content_hash").notNull(),
  data: text("data").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("shared_content_unique").on(table.contentHash), uniqueIndex("shared_source_unique").on(table.sourceQuestionId)]);

export const pointEvents = sqliteTable("point_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sharedQuestionId: text("shared_question_id").notNull().references(() => sharedQuestions.id),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("point_shared_award_unique").on(table.sharedQuestionId)]);

export const sharedImports = sqliteTable("shared_imports", {
  sharedQuestionId: text("shared_question_id").notNull().references(() => sharedQuestions.id),
  userId: text("user_id").notNull(),
  questionId: text("question_id").notNull().references(() => questions.id),
}, (table) => [primaryKey({ columns: [table.sharedQuestionId, table.userId] }), uniqueIndex("shared_import_question_unique").on(table.questionId)]);

// Product v4: account rights and exam records are independent from legacy mode buttons.
export const productProfiles = sqliteTable("product_profiles", {
  userId: text("user_id").primaryKey(), accountType: text("account_type").notNull(), displayName: text("display_name").notNull(), createdAt: text("created_at").notNull(),
});
export const productEntitlements = sqliteTable("product_entitlements", {
  userId: text("user_id").primaryKey().references(() => productProfiles.userId), plan: text("plan").notNull(), status: text("status").notNull(), expiresAt: text("expires_at"), analysisLimit: integer("analysis_limit"), used: integer("used").notNull().default(0),
});
export const productClasses = sqliteTable("product_classes", {
  id: text("id").primaryKey(), studentCode: text("student_code").notNull(), teacherCode: text("teacher_code").notNull(), data: text("data").notNull(), createdAt: text("created_at").notNull(),
}, table => [uniqueIndex("product_class_student_code_unique").on(table.studentCode), uniqueIndex("product_class_teacher_code_unique").on(table.teacherCode), index("product_classes_created").on(table.createdAt, table.id)]);
export const productMembers = sqliteTable("product_members", {
  classId: text("class_id").notNull().references(() => productClasses.id), userId: text("user_id").notNull().references(() => productProfiles.userId), role: text("role").notNull(), displayName: text("display_name").notNull(), joinedAt: text("joined_at").notNull(),
}, table => [primaryKey({ columns: [table.classId, table.userId] }), index("product_members_user_joined").on(table.userId, table.joinedAt)]);
export const productExams = sqliteTable("product_exams", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), classId: text("class_id").references(() => productClasses.id), data: text("data").notNull(), revision: integer("revision").notNull().default(1), createdAt: text("created_at").notNull(),
});
export const productAssignments = sqliteTable("product_assignments", {
  id: text("id").primaryKey(), classId: text("class_id").notNull().references(() => productClasses.id), examId: text("exam_id").notNull().references(() => productExams.id), data: text("data").notNull(), createdAt: text("created_at").notNull(),
});
export const productSubmissions = sqliteTable("product_submissions", {
  id: text("id").primaryKey(), studentId: text("student_id").notNull(), submittedBy: text("submitted_by").notNull(), classId: text("class_id").references(() => productClasses.id), assignmentId: text("assignment_id").references(() => productAssignments.id), billingUserId: text("billing_user_id").notNull(), data: text("data").notNull(), revision: integer("revision").notNull().default(1), clientRequestId: text("client_request_id").notNull(), createdAt: text("created_at").notNull(),
}, table => [
  uniqueIndex("product_submission_request_unique").on(table.submittedBy, table.clientRequestId),
  index("product_submissions_created").on(table.createdAt, table.id),
  index("product_submissions_student_created").on(table.studentId, table.createdAt, table.id),
]);
export const productFiles = sqliteTable("product_files", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), examId: text("exam_id").references(() => productExams.id), submissionId: text("submission_id").references(() => productSubmissions.id), objectKey: text("object_key").notNull(), role: text("role").notNull(), data: text("data").notNull(),
});
export const productVersions = sqliteTable("product_versions", {
  id: text("id").primaryKey(), submissionId: text("submission_id").notNull().references(() => productSubmissions.id), version: integer("version").notNull(), published: integer("published").notNull(), data: text("data").notNull(), createdAt: text("created_at").notNull(),
}, table => [uniqueIndex("product_version_unique").on(table.submissionId, table.version)]);
export const productMessages = sqliteTable("product_messages", {
  id: text("id").primaryKey(), submissionId: text("submission_id").notNull().references(() => productSubmissions.id), authorId: text("author_id").notNull(), data: text("data").notNull(), createdAt: text("created_at").notNull(), clientRequestId:text("client_request_id"),
}, table=>[uniqueIndex("product_message_request_unique").on(table.submissionId,table.authorId,table.clientRequestId),index("product_message_timeline").on(table.submissionId,table.createdAt,table.id)]);
export const productUsage = sqliteTable("product_usage", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), submissionId: text("submission_id").notNull().references(() => productSubmissions.id), createdAt: text("created_at").notNull(),
}, table => [uniqueIndex("product_completed_analysis_unique").on(table.submissionId)]);
export const productContributions = sqliteTable("product_contributions", {
  id: text("id").primaryKey(), sourceExamId: text("source_exam_id").notNull().references(() => productExams.id), sourceRevision: integer("source_revision").notNull(), contributorId: text("contributor_id").notNull(), contentHash: text("content_hash").notNull(), data: text("data").notNull(), status: text("status").notNull(), createdAt: text("created_at").notNull(),
}, table => [uniqueIndex("product_contribution_source_unique").on(table.sourceExamId), uniqueIndex("product_contribution_hash_unique").on(table.contentHash)]);
export const productPoints = sqliteTable("product_points", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), contributionId: text("contribution_id").notNull().references(() => productContributions.id), amount: integer("amount").notNull(), policyVersion: text("policy_version").notNull(), createdAt: text("created_at").notNull(),
}, table => [uniqueIndex("product_point_contribution_unique").on(table.contributionId), index("product_points_user").on(table.userId)]);
export const productImports = sqliteTable("product_imports", {
  contributionId: text("contribution_id").notNull().references(() => productContributions.id), userId: text("user_id").notNull(), examId: text("exam_id").notNull().references(() => productExams.id),
}, table => [primaryKey({ columns: [table.contributionId, table.userId] }), uniqueIndex("product_import_exam_unique").on(table.examId)]);

export const productUsers = sqliteTable("product_users", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().default(""), createdAt: text("created_at").notNull(),
});
export const productCredentials = sqliteTable("product_credentials", {
  username: text("username").primaryKey(), userId: text("user_id").notNull().references(() => productUsers.id), passwordHash: text("password_hash").notNull(),
}, table => [uniqueIndex("product_credentials_user_unique").on(table.userId)]);
export const productSessions = sqliteTable("product_sessions", {
  tokenHash: text("token_hash").primaryKey(), userId: text("user_id").notNull().references(() => productUsers.id), expiresAt: text("expires_at").notNull(),
});
export const productAuthAttempts = sqliteTable("product_auth_attempts", {
  key: text("key").primaryKey(), attempts: integer("attempts").notNull(), expiresAt: integer("expires_at").notNull(),
});
export const productLinks = sqliteTable("product_links", {
  provider: text("provider").notNull(), subject: text("subject").notNull(), userId: text("user_id").notNull().references(() => productUsers.id), email: text("email").notNull().default(""),
}, table => [primaryKey({columns:[table.provider,table.subject]}),uniqueIndex("product_link_user_provider_unique").on(table.userId,table.provider)]);
export const productOauth = sqliteTable("product_oauth", {
  stateHash: text("state_hash").primaryKey(), provider: text("provider").notNull(), userId: text("user_id"), verifier: text("verifier").notNull(), expiresAt: text("expires_at").notNull(), purpose:text("purpose").notNull().default("login"),
});
export const productNotificationSettings = sqliteTable("product_notification_settings", {
  userId: text("user_id").primaryKey(), data: text("data").notNull(), updatedAt: text("updated_at").notNull(),
});
export const productNotifications = sqliteTable("product_notifications", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), channel: text("channel").notNull(), eventKey: text("event_key").notNull(), kind: text("kind").notNull(), submissionId: text("submission_id").notNull(), status: text("status").notNull().default("awaiting_provider"), createdAt: text("created_at").notNull(),
}, table => [uniqueIndex("product_notification_event_unique").on(table.userId,table.channel,table.eventKey)]);
export const productPointEvents = sqliteTable("product_point_events", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), contributionId: text("contribution_id"), learnerId: text("learner_id"), kind: text("kind").notNull(), amount: integer("amount").notNull(), policyVersion: text("policy_version").notNull(), createdAt: text("created_at").notNull(),
}, table => [uniqueIndex("product_point_usage_unique").on(table.contributionId,table.learnerId,table.kind), index("product_point_events_user").on(table.userId)]);
export const productExamRequests = sqliteTable("product_exam_requests", {
  userId: text("user_id").notNull(), requestId: text("request_id").notNull(), examId: text("exam_id").notNull().references(() => productExams.id),
}, table => [primaryKey({columns:[table.userId,table.requestId]})]);

export const productPhoneTrials = sqliteTable("product_phone_trials", {
  userId:text("user_id").primaryKey(), phoneHash:text("phone_hash").notNull(), phoneMasked:text("phone_masked").notNull(), verifiedAt:text("verified_at").notNull(), usedSubmissionId:text("used_submission_id"), consumedAt:text("consumed_at"),
}, table=>[uniqueIndex("product_trial_phone_unique").on(table.phoneHash),uniqueIndex("product_trial_submission_unique").on(table.usedSubmissionId)]);
export const productPhoneChallenges = sqliteTable("product_phone_challenges", {
  id:text("id").primaryKey(), userId:text("user_id").notNull(), phoneHash:text("phone_hash").notNull(), phoneMasked:text("phone_masked").notNull(), providerSid:text("provider_sid").notNull(), serviceSid:text("service_sid").notNull(), expiresAt:text("expires_at").notNull(), attempts:integer("attempts").notNull().default(0), status:text("status").notNull().default("pending"),
});
export const productPhoneCooldowns = sqliteTable("product_phone_cooldowns", {
  userId:text("user_id").primaryKey(), expiresAt:integer("expires_at").notNull(),
});

export const productClosedAccounts=sqliteTable("product_closed_accounts",{
  userId:text("user_id").primaryKey(),closedAt:text("closed_at").notNull(),
});
export const productDepartures=sqliteTable("product_departures",{
  classId:text("class_id").notNull().references(()=>productClasses.id),userId:text("user_id").notNull(),status:text("status").notNull(),createdAt:text("created_at").notNull(),
},table=>[primaryKey({columns:[table.classId,table.userId]})]);
export const productSubmissionMaterials=sqliteTable("product_submission_materials",{
  id:text("id").primaryKey(),submissionId:text("submission_id").notNull().references(()=>productSubmissions.id),version:integer("version").notNull(),data:text("data").notNull(),createdAt:text("created_at").notNull(),
},table=>[uniqueIndex("product_material_version_unique").on(table.submissionId,table.version)]);
export const productRecoveryChallenges=sqliteTable("product_recovery_challenges",{
  id:text("id").primaryKey(),userId:text("user_id"),purpose:text("purpose").notNull(),phoneHash:text("phone_hash").notNull(),providerSid:text("provider_sid").notNull(),serviceSid:text("service_sid").notNull(),expiresAt:text("expires_at").notNull(),attempts:integer("attempts").notNull().default(0),status:text("status").notNull().default("pending"),
});
export const productSecurityTokens=sqliteTable("product_security_tokens",{
  tokenHash:text("token_hash").primaryKey(),userId:text("user_id").notNull(),purpose:text("purpose").notNull(),expiresAt:text("expires_at").notNull(),consumedAt:text("consumed_at"),
});
// Management records also support profiles created before the current login system.
export const productAdminCustomers = sqliteTable("product_admin_customers", {
  userId: text("user_id").primaryKey(),
  isAdmin: integer("is_admin").notNull().default(0),
  status: text("status").notNull(),
  note: text("note").notNull(),
  revision: integer("revision").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastEventId: text("last_event_id").notNull(),
}, table => [check("product_admin_customer_status", sql`${table.status} IN ('new', 'active', 'follow_up', 'closed')`), check("product_admin_customer_is_admin", sql`${table.isAdmin} IN (0, 1)`)]);

export const productAdminCustomerEvents = sqliteTable("product_admin_customer_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => productAdminCustomers.userId),
  status: text("status").notNull(),
  revision: integer("revision").notNull(),
  actorId: text("actor_id").notNull(),
  actorName: text("actor_name").notNull(),
  createdAt: text("created_at").notNull(),
  previousRole: text("previous_role"),
  newRole: text("new_role"),
  previousAdmin: integer("previous_admin"),
  newAdmin: integer("new_admin"),
}, table => [uniqueIndex("product_admin_event_customer_revision").on(table.userId, table.revision)]);


export const productOwnerModes = sqliteTable("product_owner_modes", {
  userId: text("user_id").primaryKey().references(() => productProfiles.userId),
  mode: text("mode").notNull(), updatedAt: text("updated_at").notNull(),
});

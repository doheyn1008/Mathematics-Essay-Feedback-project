import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

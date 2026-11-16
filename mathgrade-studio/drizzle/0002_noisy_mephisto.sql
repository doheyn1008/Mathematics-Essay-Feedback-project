CREATE TABLE `point_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`shared_question_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shared_question_id`) REFERENCES `shared_questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `point_shared_award_unique` ON `point_events` (`shared_question_id`);--> statement-breakpoint
CREATE TABLE `shared_imports` (
	`shared_question_id` text NOT NULL,
	`user_id` text NOT NULL,
	`question_id` text NOT NULL,
	PRIMARY KEY(`shared_question_id`, `user_id`),
	FOREIGN KEY (`shared_question_id`) REFERENCES `shared_questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_import_question_unique` ON `shared_imports` (`question_id`);--> statement-breakpoint
CREATE TABLE `shared_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`source_question_id` text NOT NULL,
	`contributor_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`data` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_content_unique` ON `shared_questions` (`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `shared_source_unique` ON `shared_questions` (`source_question_id`);
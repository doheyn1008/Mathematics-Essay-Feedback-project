CREATE TABLE `product_auth_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_credentials` (
	`username` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`password_hash` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `product_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_credentials_user_unique` ON `product_credentials` (`user_id`);--> statement-breakpoint
CREATE TABLE `product_exam_requests` (
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`exam_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `request_id`),
	FOREIGN KEY (`exam_id`) REFERENCES `product_exams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `product_links` (
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`provider`, `subject`),
	FOREIGN KEY (`user_id`) REFERENCES `product_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_link_user_provider_unique` ON `product_links` (`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `product_notification_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`event_key` text NOT NULL,
	`kind` text NOT NULL,
	`submission_id` text NOT NULL,
	`status` text DEFAULT 'awaiting_provider' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_notification_event_unique` ON `product_notifications` (`user_id`,`channel`,`event_key`);--> statement-breakpoint
CREATE TABLE `product_oauth` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`user_id` text,
	`verifier` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_point_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`contribution_id` text,
	`learner_id` text,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`policy_version` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_point_usage_unique` ON `product_point_events` (`contribution_id`,`learner_id`,`kind`);--> statement-breakpoint
CREATE TABLE `product_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `product_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `product_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);

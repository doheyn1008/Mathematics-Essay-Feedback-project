CREATE TABLE `product_contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`source_exam_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`contributor_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`data` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_exam_id`) REFERENCES `product_exams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_contribution_source_unique` ON `product_contributions` (`source_exam_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_contribution_hash_unique` ON `product_contributions` (`content_hash`);--> statement-breakpoint
CREATE TABLE `product_imports` (
	`contribution_id` text NOT NULL,
	`user_id` text NOT NULL,
	`exam_id` text NOT NULL,
	PRIMARY KEY(`contribution_id`, `user_id`),
	FOREIGN KEY (`contribution_id`) REFERENCES `product_contributions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exam_id`) REFERENCES `product_exams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_import_exam_unique` ON `product_imports` (`exam_id`);--> statement-breakpoint
CREATE TABLE `product_points` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`contribution_id` text NOT NULL,
	`amount` integer NOT NULL,
	`policy_version` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`contribution_id`) REFERENCES `product_contributions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_point_contribution_unique` ON `product_points` (`contribution_id`);
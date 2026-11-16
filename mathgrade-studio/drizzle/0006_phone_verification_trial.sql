CREATE TABLE `product_phone_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`phone_hash` text NOT NULL,
	`phone_masked` text NOT NULL,
	`provider_sid` text NOT NULL,
	`service_sid` text NOT NULL,
	`expires_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_phone_cooldowns` (
	`user_id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_phone_trials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`phone_hash` text NOT NULL,
	`phone_masked` text NOT NULL,
	`verified_at` text NOT NULL,
	`used_submission_id` text,
	`consumed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_trial_phone_unique` ON `product_phone_trials` (`phone_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_trial_submission_unique` ON `product_phone_trials` (`used_submission_id`);
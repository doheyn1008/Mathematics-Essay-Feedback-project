CREATE TABLE `product_admin_customer_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `product_admin_customers`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_admin_event_customer_revision` ON `product_admin_customer_events` (`user_id`,`revision`);--> statement-breakpoint
CREATE TABLE `product_admin_customers` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`note` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	`last_event_id` text NOT NULL,
	CONSTRAINT "product_admin_customer_status" CHECK("product_admin_customers"."status" IN ('new', 'active', 'follow_up', 'closed'))
);
--> statement-breakpoint
CREATE INDEX `product_classes_created` ON `product_classes` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `product_members_user_joined` ON `product_members` (`user_id`,`joined_at`);--> statement-breakpoint
CREATE INDEX `product_point_events_user` ON `product_point_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `product_points_user` ON `product_points` (`user_id`);--> statement-breakpoint
CREATE INDEX `product_submissions_created` ON `product_submissions` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `product_submissions_student_created` ON `product_submissions` (`student_id`,`created_at`,`id`);
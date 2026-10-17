CREATE TABLE `activity_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`work_item_id` bigint unsigned NOT NULL,
	`actor_id` bigint unsigned,
	`type` varchar(32) NOT NULL,
	`from_value` varchar(255),
	`to_value` varchar(255),
	`metadata` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `activity_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`work_item_id` bigint unsigned NOT NULL,
	`author_id` bigint unsigned NOT NULL,
	`body` text NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`key` varchar(255) NOT NULL,
	`endpoint` varchar(120) NOT NULL,
	`request_hash` varchar(64) NOT NULL,
	`response_status` int NOT NULL,
	`response_body` json NOT NULL,
	`resource_id` bigint unsigned,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `idempotency_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `idempotency_user_key_uq` UNIQUE(`user_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`team_id` bigint unsigned NOT NULL,
	`role` enum('viewer','member','lead') NOT NULL,
	`email` varchar(255) NOT NULL,
	`code_hash` varchar(64) NOT NULL,
	`max_uses` int NOT NULL DEFAULT 1,
	`uses` int NOT NULL DEFAULT 0,
	`expires_at` datetime(3) NOT NULL,
	`created_by` bigint unsigned NOT NULL,
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `invitations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `membership_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`team_id` bigint unsigned NOT NULL,
	`actor_id` bigint unsigned NOT NULL,
	`subject_user_id` bigint unsigned NOT NULL,
	`action` enum('joined','role_changed','removed') NOT NULL,
	`from_role` enum('viewer','member','lead'),
	`to_role` enum('viewer','member','lead'),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `membership_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`team_id` bigint unsigned NOT NULL,
	`role` enum('viewer','member','lead') NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `memberships_user_team_uq` UNIQUE(`user_id`,`team_id`)
);
--> statement-breakpoint
CREATE TABLE `outbox_jobs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`type` enum('email.reset','email.invite','email.assigned') NOT NULL,
	`payload` json,
	`status` enum('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL DEFAULT 5,
	`available_at` datetime(3) NOT NULL,
	`locked_at` datetime(3),
	`locked_by` varchar(120),
	`last_error` text,
	`dedupe_key` varchar(200) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `outbox_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `outbox_jobs_dedupe_key_unique` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`consumed_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `password_reset_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `password_reset_tokens_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`family_id` varchar(36) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`replaced_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`last_used_at` datetime(3),
	`user_agent` varchar(255),
	`ip` varchar(45),
	CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `refresh_tokens_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`slug` varchar(80) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `teams_id` PRIMARY KEY(`id`),
	CONSTRAINT `teams_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`display_name` varchar(120) NOT NULL,
	`is_admin` boolean NOT NULL DEFAULT false,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `work_items` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`team_id` bigint unsigned NOT NULL,
	`title` varchar(200) NOT NULL,
	`description` text,
	`type` enum('incident','customer_issue','payment','compliance','task') NOT NULL,
	`priority` enum('low','medium','high','urgent') NOT NULL,
	`status` enum('open','in_progress','awaiting_approval','resolved','closed','cancelled') NOT NULL DEFAULT 'open',
	`assignee_id` bigint unsigned,
	`created_by` bigint unsigned NOT NULL,
	`due_at` datetime(3),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `work_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `activity_events` ADD CONSTRAINT `activity_events_work_item_id_work_items_id_fk` FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_events` ADD CONSTRAINT `activity_events_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_work_item_id_work_items_id_fk` FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `idempotency_keys` ADD CONSTRAINT `idempotency_keys_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `membership_events` ADD CONSTRAINT `membership_events_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `membership_events` ADD CONSTRAINT `membership_events_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `membership_events` ADD CONSTRAINT `membership_events_subject_user_id_users_id_fk` FOREIGN KEY (`subject_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_items` ADD CONSTRAINT `work_items_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_items` ADD CONSTRAINT `work_items_assignee_id_users_id_fk` FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_items` ADD CONSTRAINT `work_items_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `activity_events_item_ix` ON `activity_events` (`work_item_id`,`id`);--> statement-breakpoint
CREATE INDEX `comments_item_ix` ON `comments` (`work_item_id`,`id`);--> statement-breakpoint
CREATE INDEX `invitations_team_ix` ON `invitations` (`team_id`);--> statement-breakpoint
CREATE INDEX `invitations_code_hash_ix` ON `invitations` (`code_hash`);--> statement-breakpoint
CREATE INDEX `membership_events_team_id_ix` ON `membership_events` (`team_id`,`id`);--> statement-breakpoint
CREATE INDEX `memberships_team_role_ix` ON `memberships` (`team_id`,`role`);--> statement-breakpoint
CREATE INDEX `outbox_status_available_ix` ON `outbox_jobs` (`status`,`available_at`,`id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_ix` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_family_ix` ON `refresh_tokens` (`family_id`);--> statement-breakpoint
CREATE INDEX `work_items_team_status_priority_ix` ON `work_items` (`team_id`,`status`,`priority`);--> statement-breakpoint
CREATE INDEX `work_items_team_created_id_ix` ON `work_items` (`team_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `work_items_assignee_status_ix` ON `work_items` (`assignee_id`,`status`);--> statement-breakpoint
CREATE INDEX `work_items_team_assignee_ix` ON `work_items` (`team_id`,`assignee_id`);
CREATE TABLE `admin_audit_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`actor_id` bigint unsigned NOT NULL,
	`action` enum('user_created','user_status_changed','team_created','membership_added','membership_role_changed','membership_removed','job_retried') NOT NULL,
	`target_type` enum('user','team','membership','job') NOT NULL,
	`target_id` bigint unsigned NOT NULL,
	`metadata` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `admin_audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `admin_audit_events` ADD CONSTRAINT `admin_audit_events_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `admin_audit_action_id_ix` ON `admin_audit_events` (`action`,`id`);--> statement-breakpoint
CREATE INDEX `admin_audit_actor_id_ix` ON `admin_audit_events` (`actor_id`,`id`);--> statement-breakpoint
CREATE INDEX `admin_audit_target_id_ix` ON `admin_audit_events` (`target_type`,`target_id`,`id`);
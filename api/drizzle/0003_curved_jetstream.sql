CREATE TABLE `notifications` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`recipient_user_id` bigint unsigned NOT NULL,
	`activity_event_id` bigint unsigned NOT NULL,
	`type` enum('assigned','comment_added','approval_requested','workflow_decision') NOT NULL,
	`read_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `notifications_recipient_event_uq` UNIQUE(`recipient_user_id`,`activity_event_id`)
);
--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_recipient_user_id_users_id_fk` FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_activity_event_id_activity_events_id_fk` FOREIGN KEY (`activity_event_id`) REFERENCES `activity_events`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `notifications_recipient_id_ix` ON `notifications` (`recipient_user_id`,`id`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_read_id_ix` ON `notifications` (`recipient_user_id`,`read_at`,`id`);
-- Project-root terminals: terminals.task_id becomes nullable (rows scoped by the new
-- workspace_id column instead of a task). SQLite cannot drop NOT NULL in place, so the
-- table is recreated; drizzle-kit does not emit this rebuild itself. The migration runner
-- disables foreign_keys around the transaction, so the DROP TABLE does not cascade.
CREATE TABLE `__new_terminals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text,
	`workspace_id` text,
	`ssh` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`shell_id` text DEFAULT 'system' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_terminals` (`id`, `project_id`, `task_id`, `ssh`, `name`, `shell_id`, `created_at`, `updated_at`)
SELECT `id`, `project_id`, `task_id`, `ssh`, `name`, `shell_id`, `created_at`, `updated_at`
FROM `terminals`;--> statement-breakpoint
DROP TABLE `terminals`;--> statement-breakpoint
ALTER TABLE `__new_terminals` RENAME TO `terminals`;--> statement-breakpoint
CREATE INDEX `idx_terminals_task_id` ON `terminals` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_terminals_workspace_id` ON `terminals` (`workspace_id`);

CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`last_sync_at` text,
	`last_error` text
);

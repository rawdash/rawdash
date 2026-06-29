CREATE TABLE `connector_sync_state` (
	`connector_id` text PRIMARY KEY NOT NULL,
	`last_sync_at` text,
	`last_backfill_at` text
);

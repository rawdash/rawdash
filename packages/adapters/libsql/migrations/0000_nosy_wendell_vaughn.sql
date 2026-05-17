CREATE TABLE `distributions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connector_id` text NOT NULL,
	`name` text NOT NULL,
	`ts` integer NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`attributes` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `distributions_conn_name_ts` ON `distributions` (`connector_id`,`name`,`ts`);--> statement-breakpoint
CREATE TABLE `edges` (
	`connector_id` text NOT NULL,
	`from_type` text NOT NULL,
	`from_id` text NOT NULL,
	`kind` text NOT NULL,
	`to_type` text NOT NULL,
	`to_id` text NOT NULL,
	`attributes` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`connector_id`, `from_type`, `from_id`, `kind`, `to_type`, `to_id`)
);
--> statement-breakpoint
CREATE INDEX `edges_conn_kind` ON `edges` (`connector_id`,`kind`);--> statement-breakpoint
CREATE INDEX `edges_conn_from` ON `edges` (`connector_id`,`from_type`,`from_id`);--> statement-breakpoint
CREATE TABLE `entities` (
	`connector_id` text NOT NULL,
	`type` text NOT NULL,
	`id` text NOT NULL,
	`attributes` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`connector_id`, `type`, `id`)
);
--> statement-breakpoint
CREATE INDEX `entities_conn_type` ON `entities` (`connector_id`,`type`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connector_id` text NOT NULL,
	`name` text NOT NULL,
	`start_ts` integer NOT NULL,
	`end_ts` integer,
	`attributes` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_conn_name_start` ON `events` (`connector_id`,`name`,`start_ts`);--> statement-breakpoint
CREATE TABLE `metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connector_id` text NOT NULL,
	`name` text NOT NULL,
	`ts` integer NOT NULL,
	`value` real NOT NULL,
	`attributes` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metrics_conn_name_ts` ON `metrics` (`connector_id`,`name`,`ts`);
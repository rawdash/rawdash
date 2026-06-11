CREATE TABLE `rollup_watermarks` (
	`connector_id` text NOT NULL,
	`resource` text NOT NULL,
	`watermark` integer NOT NULL,
	PRIMARY KEY(`connector_id`, `resource`)
);
--> statement-breakpoint
CREATE TABLE `rollups` (
	`connector_id` text NOT NULL,
	`resource` text NOT NULL,
	`field` text DEFAULT '' NOT NULL,
	`granularity` text NOT NULL,
	`dims_key` text DEFAULT '' NOT NULL,
	`dims` text DEFAULT '{}' NOT NULL,
	`bucket_start` integer NOT NULL,
	`partials` text NOT NULL,
	PRIMARY KEY(`connector_id`, `resource`, `field`, `granularity`, `dims_key`, `bucket_start`)
);
--> statement-breakpoint
CREATE INDEX `rollups_conn_resource_field` ON `rollups` (`connector_id`,`resource`,`field`);
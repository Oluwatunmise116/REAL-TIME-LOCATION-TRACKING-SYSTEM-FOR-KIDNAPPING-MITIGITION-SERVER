CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`first_seen` integer NOT NULL,
	`last_seen` integer,
	`last_status` text,
	`last_heartbeat_at` integer,
	`last_seq` integer,
	`last_up` integer,
	`last_lat` real,
	`last_lon` real,
	`last_fix_changed_at` integer,
	`last_fix_ts` integer,
	`last_telemetry_at` integer,
	`motion_state` text,
	`motion_indicator` text,
	`motion_at` integer,
	`connection` text DEFAULT 'offline' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text NOT NULL,
	`type` text NOT NULL,
	`ts` integer NOT NULL,
	`ts_approx` integer DEFAULT false NOT NULL,
	`received_at` integer NOT NULL,
	`payload` text NOT NULL,
	`lat` real,
	`lon` real,
	`age_sec` real,
	`severity` text NOT NULL,
	`acknowledged_at` integer,
	`acknowledged_by` text,
	`dedupe_key` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_dedupe` ON `events` (`device_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `events_ts` ON `events` (`ts`);--> statement-breakpoint
CREATE INDEX `events_device_ts` ON `events` (`device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `events_type_ts` ON `events` (`type`,`ts`);--> statement-breakpoint
CREATE TABLE `heartbeat_minutes` (
	`device_id` text NOT NULL,
	`minute` integer NOT NULL,
	`count` integer NOT NULL,
	`min_seq` integer NOT NULL,
	`max_seq` integer NOT NULL,
	PRIMARY KEY(`device_id`, `minute`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text NOT NULL,
	`ts` integer NOT NULL,
	`received_at` integer NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `positions_device_ts` ON `positions` (`device_id`,`ts`);--> statement-breakpoint
CREATE INDEX `positions_received` ON `positions` (`received_at`);--> statement-breakpoint
CREATE TABLE `raw_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic` text NOT NULL,
	`payload` text NOT NULL,
	`received_at` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `raw_received` ON `raw_messages` (`received_at`);
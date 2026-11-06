import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type {
  Connection,
  EventType,
  MotionEventPayload,
  RebootEventPayload,
  Severity,
  SosEventPayload,
  StatusEventPayload,
} from "@/lib/domain/types";

// All times are epoch milliseconds (integer).

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  displayName: text("display_name"),
  firstSeen: integer("first_seen").notNull(),
  lastSeen: integer("last_seen"),
  lastStatus: text("last_status").$type<"online" | "offline">(),
  lastHeartbeatAt: integer("last_heartbeat_at"),
  lastSeq: integer("last_seq"),
  lastUp: integer("last_up"),
  lastLat: real("last_lat"),
  lastLon: real("last_lon"),
  lastFixChangedAt: integer("last_fix_changed_at"),
  lastFixTs: integer("last_fix_ts"),
  lastTelemetryAt: integer("last_telemetry_at"),
  motionState: text("motion_state"),
  motionIndicator: text("motion_indicator"),
  motionAt: integer("motion_at"),
  /** Last derived connection, persisted so a dashboard restart doesn't log spurious transitions. */
  connection: text("connection").$type<Connection>().notNull().default("offline"),
});

export const positions = sqliteTable(
  "positions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deviceId: text("device_id").notNull(),
    ts: integer("ts").notNull(),
    receivedAt: integer("received_at").notNull(),
    lat: real("lat").notNull(),
    lon: real("lon").notNull(),
  },
  (t) => [index("positions_device_ts").on(t.deviceId, t.ts), index("positions_received").on(t.receivedAt)],
);

export type EventPayload = SosEventPayload | MotionEventPayload | StatusEventPayload | RebootEventPayload;

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deviceId: text("device_id").notNull(),
    type: text("type").$type<EventType>().notNull(),
    ts: integer("ts").notNull(),
    tsApprox: integer("ts_approx", { mode: "boolean" }).notNull().default(false),
    receivedAt: integer("received_at").notNull(),
    payload: text("payload", { mode: "json" }).$type<EventPayload>().notNull(),
    lat: real("lat"),
    lon: real("lon"),
    ageSec: real("age_sec"),
    severity: text("severity").$type<Severity>().notNull(),
    acknowledgedAt: integer("acknowledged_at"),
    acknowledgedBy: text("acknowledged_by"),
    /** sos:<seq>:<ts> / motion:<prev>><state>:<ts>; NULL for events that are never deduplicated. */
    dedupeKey: text("dedupe_key"),
  },
  (t) => [
    uniqueIndex("events_dedupe").on(t.deviceId, t.dedupeKey),
    index("events_ts").on(t.ts),
    index("events_device_ts").on(t.deviceId, t.ts),
    index("events_type_ts").on(t.type, t.ts),
  ],
);

export const heartbeatMinutes = sqliteTable(
  "heartbeat_minutes",
  {
    deviceId: text("device_id").notNull(),
    minute: integer("minute").notNull(),
    count: integer("count").notNull(),
    minSeq: integer("min_seq").notNull(),
    maxSeq: integer("max_seq").notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.minute] })],
);

export const rawMessages = sqliteTable(
  "raw_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    topic: text("topic").notNull(),
    payload: text("payload").notNull(),
    receivedAt: integer("received_at").notNull(),
    /** Validation error, or NULL for a valid message kept for audit. */
    error: text("error"),
  },
  (t) => [index("raw_received").on(t.receivedAt)],
);

export type DeviceRow = typeof devices.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type PositionRow = typeof positions.$inferSelect;

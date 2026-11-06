import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "./client";
import { devices, events, heartbeatMinutes, positions, rawMessages, type DeviceRow, type EventRow, type NewEventRow } from "./schema";
import type { EventType, EventView, HeartbeatMinuteView, PositionView } from "@/lib/domain/types";

// ---------- devices ----------

export function loadDevices(db: Db): DeviceRow[] {
  return db.select().from(devices).all();
}

export function getDeviceRow(db: Db, id: string): DeviceRow | undefined {
  return db.select().from(devices).where(eq(devices.id, id)).get();
}

export function saveDevice(db: Db, row: DeviceRow): void {
  const { id: _id, ...rest } = row; // eslint-disable-line @typescript-eslint/no-unused-vars
  db.insert(devices).values(row).onConflictDoUpdate({ target: devices.id, set: rest }).run();
}

export function renameDevice(db: Db, id: string, displayName: string | null): DeviceRow | undefined {
  return db.update(devices).set({ displayName }).where(eq(devices.id, id)).returning().get();
}

// ---------- positions ----------

export function insertPosition(db: Db, deviceId: string, p: PositionView): void {
  db.insert(positions)
    .values({ deviceId, ...p })
    .run();
}

export function lastPosition(db: Db, deviceId: string): PositionView | undefined {
  return db
    .select({ ts: positions.ts, receivedAt: positions.receivedAt, lat: positions.lat, lon: positions.lon })
    .from(positions)
    .where(eq(positions.deviceId, deviceId))
    .orderBy(desc(positions.ts), desc(positions.id))
    .limit(1)
    .get();
}

const MAX_TRACK_POINTS = 4000;

/** Positions in [from, to] ordered by device time, evenly thinned if there are too many for a polyline. */
export function track(db: Db, deviceId: string, from: number, to: number): PositionView[] {
  const rows = db
    .select({ ts: positions.ts, receivedAt: positions.receivedAt, lat: positions.lat, lon: positions.lon })
    .from(positions)
    .where(and(eq(positions.deviceId, deviceId), gte(positions.ts, from), lte(positions.ts, to)))
    .orderBy(asc(positions.ts), asc(positions.id))
    .all();
  if (rows.length <= MAX_TRACK_POINTS) return rows;
  const step = rows.length / MAX_TRACK_POINTS;
  const out: PositionView[] = [];
  for (let i = 0; i < MAX_TRACK_POINTS - 1; i++) out.push(rows[Math.floor(i * step)]);
  out.push(rows[rows.length - 1]);
  return out;
}

// ---------- events ----------

export function toEventView(r: EventRow): EventView {
  const base = {
    id: r.id,
    deviceId: r.deviceId,
    ts: r.ts,
    tsApprox: r.tsApprox,
    receivedAt: r.receivedAt,
    lat: r.lat,
    lon: r.lon,
    ageSec: r.ageSec,
    severity: r.severity,
    acknowledgedAt: r.acknowledgedAt,
    acknowledgedBy: r.acknowledgedBy,
  };
  // The payload column is written only by the ingest layer, which pairs each type with its payload shape.
  return { ...base, type: r.type, payload: r.payload } as EventView;
}

/** Insert an event; returns null when the dedupe key already exists (firmware retry / QoS 1 redelivery). */
export function insertEvent(db: Db, row: NewEventRow): EventView | null {
  const inserted = db
    .insert(events)
    .values(row)
    .onConflictDoNothing({ target: [events.deviceId, events.dedupeKey] })
    .returning()
    .get();
  return inserted ? toEventView(inserted) : null;
}

export function getEvent(db: Db, id: number): EventView | undefined {
  const r = db.select().from(events).where(eq(events.id, id)).get();
  return r ? toEventView(r) : undefined;
}

export function recentEvents(db: Db, limit = 50): EventView[] {
  return db.select().from(events).orderBy(desc(events.ts), desc(events.id)).limit(limit).all().map(toEventView);
}

export function activeSos(db: Db): EventView[] {
  return db
    .select()
    .from(events)
    .where(and(eq(events.type, "sos"), isNull(events.acknowledgedAt)))
    .orderBy(desc(events.ts), desc(events.id))
    .all()
    .map(toEventView);
}

export function countMotionAlerts(db: Db, since: number): number {
  const r = db
    .select({ n: sql<number>`count(*)` })
    .from(events)
    .where(and(eq(events.type, "motion"), gte(events.ts, since), sql`json_extract(${events.payload}, '$.state') = 'SUSPICIOUS'`))
    .get();
  return r?.n ?? 0;
}

export interface EventQuery {
  deviceId?: string;
  types?: EventType[];
  from?: number;
  to?: number;
  /** Only motion events in these states (e.g. hide transient CANDIDATE). */
  motionStates?: string[];
  cursor?: string | null;
  limit?: number;
}

export interface EventPage {
  events: EventView[];
  nextCursor: string | null;
}

export function encodeCursor(e: { ts: number; id: number }): string {
  return Buffer.from(`${e.ts}:${e.id}`).toString("base64url");
}

export function decodeCursor(c: string): { ts: number; id: number } | null {
  const [ts, id] = Buffer.from(c, "base64url").toString().split(":").map(Number);
  return Number.isFinite(ts) && Number.isFinite(id) ? { ts, id } : null;
}

/** Keyset-paginated, newest first by event time. */
export function listEvents(db: Db, q: EventQuery): EventPage {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
  const where: SQL[] = [];
  if (q.deviceId) where.push(eq(events.deviceId, q.deviceId));
  if (q.types?.length) where.push(inArray(events.type, q.types));
  if (q.from !== undefined) where.push(gte(events.ts, q.from));
  if (q.to !== undefined) where.push(lte(events.ts, q.to));
  if (q.motionStates?.length) {
    const states = sql.join(
      q.motionStates.map((s) => sql`${s}`),
      sql`, `,
    );
    where.push(sql`(${events.type} != 'motion' OR json_extract(${events.payload}, '$.state') IN (${states}))`);
  }
  const cur = q.cursor ? decodeCursor(q.cursor) : null;
  if (cur) {
    const keyset = or(lt(events.ts, cur.ts), and(eq(events.ts, cur.ts), lt(events.id, cur.id)));
    if (keyset) where.push(keyset);
  }
  const rows = db
    .select()
    .from(events)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(events.ts), desc(events.id))
    .limit(limit + 1)
    .all();
  const page = rows.slice(0, limit).map(toEventView);
  const nextCursor = rows.length > limit ? encodeCursor(page[page.length - 1]) : null;
  return { events: page, nextCursor };
}

/**
 * Acknowledge an event. With `includeEarlier`, also acknowledges this device's older
 * unacknowledged events of the same type (an SOS SUSPICIOUS followed by DANGER is one incident).
 */
export function acknowledgeEvent(db: Db, id: number, by: string, now: number, includeEarlier = false): EventView[] {
  const target = db.select().from(events).where(eq(events.id, id)).get();
  if (!target) return [];
  const cond = includeEarlier
    ? and(
        eq(events.deviceId, target.deviceId),
        eq(events.type, target.type),
        isNull(events.acknowledgedAt),
        or(lte(events.ts, target.ts), eq(events.id, target.id)),
      )
    : and(eq(events.id, id), isNull(events.acknowledgedAt));
  return db.update(events).set({ acknowledgedAt: now, acknowledgedBy: by }).where(cond).returning().all().map(toEventView);
}

// ---------- heartbeats ----------

export function upsertHeartbeatMinute(db: Db, deviceId: string, m: HeartbeatMinuteView): void {
  db.insert(heartbeatMinutes)
    .values({ deviceId, ...m })
    .onConflictDoUpdate({
      target: [heartbeatMinutes.deviceId, heartbeatMinutes.minute],
      set: {
        count: sql`${heartbeatMinutes.count} + excluded.count`,
        minSeq: sql`min(${heartbeatMinutes.minSeq}, excluded.min_seq)`,
        maxSeq: sql`max(${heartbeatMinutes.maxSeq}, excluded.max_seq)`,
      },
    })
    .run();
}

export function heartbeatHistory(db: Db, deviceId: string, since: number): HeartbeatMinuteView[] {
  return db
    .select({
      minute: heartbeatMinutes.minute,
      count: heartbeatMinutes.count,
      minSeq: heartbeatMinutes.minSeq,
      maxSeq: heartbeatMinutes.maxSeq,
    })
    .from(heartbeatMinutes)
    .where(and(eq(heartbeatMinutes.deviceId, deviceId), gte(heartbeatMinutes.minute, since)))
    .orderBy(asc(heartbeatMinutes.minute))
    .all();
}

// ---------- raw + retention ----------

export function insertRaw(db: Db, topic: string, payload: string, receivedAt: number, error: string | null): void {
  db.insert(rawMessages)
    .values({ topic, payload: payload.slice(0, 8192), receivedAt, error })
    .run();
}

/** Purge history older than the cutoff. SOS events are never deleted automatically. */
export function purgeOlderThan(db: Db, cutoff: number): { positions: number; raw: number; heartbeats: number; events: number } {
  const p = db.delete(positions).where(lt(positions.receivedAt, cutoff)).run().changes;
  const r = db.delete(rawMessages).where(lt(rawMessages.receivedAt, cutoff)).run().changes;
  const h = db.delete(heartbeatMinutes).where(lt(heartbeatMinutes.minute, cutoff)).run().changes;
  const e = db
    .delete(events)
    .where(and(lt(events.receivedAt, cutoff), inArray(events.type, ["status", "reboot"])))
    .run().changes;
  return { positions: p, raw: r, heartbeats: h, events: e };
}

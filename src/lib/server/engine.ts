/**
 * Ingest engine: parsed MQTT message → persistence → derived device state → bus messages.
 * Knows nothing about MQTT or HTTP; the clock is always passed in so it can be tested with fake time.
 */
import { parseMessage, type ParsedMessage } from "@/lib/contract/schemas";
import {
  checkHeartbeat,
  deriveConnection,
  deriveGps,
  linkQuality,
  motionDedupeKey,
  motionSeverity,
  pruneBeats,
  resolveEventTime,
  samePosition,
  sosDedupeKey,
  sosSeverity,
} from "@/lib/domain/derive";
import type {
  BusMessage,
  Connection,
  ConnectionReason,
  DeviceView,
  EventView,
  FleetStats,
  HeartbeatMinuteView,
  PositionView,
} from "@/lib/domain/types";
import type { Db } from "./db/client";
import * as repo from "./db/repo";
import type { DeviceRow, NewEventRow } from "./db/schema";

/** Don't record connection transitions until we've had this long to hear from devices after (re)subscribing. */
export const WARMUP_MS = 10_000;
const PERSIST_INTERVAL_MS = 10_000;
const DUPLICATE_POSITION_MS = 10_000;
const STATS_INTERVAL_MS = 60_000;

interface DeviceRuntime {
  row: DeviceRow;
  onlineSince: number | null;
  lastMessageAt: number | null;
  beats: number[];
  reportsNoFix: boolean;
  /** Receive time of the last current fix (in memory; falls back to the last position change after a restart). */
  lastFixAt: number | null;
  lastStored: PositionView | null | undefined; // undefined = not loaded yet
  bucket: HeartbeatMinuteView | null;
  /** Last connection we recorded an event for (persisted as row.connection). */
  recordedConnection: Connection;
  view: DeviceView | null;
  viewKey: string;
  pendingEmit: boolean;
  dirty: boolean;
  lastPersistAt: number;
}

export interface EngineOptions {
  topicRoot: string;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export class Engine {
  private readonly devices = new Map<string, DeviceRuntime>();
  private observingSince: number | null = null;
  private brokerConnected = false;
  private stats: FleetStats = { motionAlerts24h: 0 };
  private lastStatsAt = 0;
  lastMessageAt: number | null = null;
  private readonly log: Pick<Console, "info" | "warn" | "error">;

  constructor(
    private readonly db: Db,
    private readonly emit: (m: BusMessage) => void,
    private readonly opts: EngineOptions,
  ) {
    this.log = opts.log ?? console;
    for (const row of repo.loadDevices(db)) this.devices.set(row.id, this.runtimeFor(row));
  }

  private runtimeFor(row: DeviceRow): DeviceRuntime {
    return {
      row,
      onlineSince: null,
      lastMessageAt: row.lastSeen,
      beats: [],
      reportsNoFix: false,
      lastFixAt: row.lastFixChangedAt,
      lastStored: undefined,
      bucket: null,
      recordedConnection: row.connection,
      view: null,
      viewKey: "",
      pendingEmit: false,
      dirty: false,
      lastPersistAt: 0,
    };
  }

  // ---------- broker lifecycle ----------

  /** Called on every (re)subscribe. Restarts the warm-up window. */
  onSubscribed(now: number): void {
    this.brokerConnected = true;
    this.observingSince = now;
    for (const d of this.devices.values()) d.beats = [];
  }

  onDisconnected(): void {
    this.brokerConnected = false;
  }

  // ---------- ingest ----------

  handle(topic: string, payloadBuf: Buffer | string, now: number, retained = false): ParsedMessage {
    const payload = typeof payloadBuf === "string" ? payloadBuf : payloadBuf.toString("utf8");
    const msg = parseMessage(topic, payload, this.opts.topicRoot);
    this.lastMessageAt = now;

    if (msg.kind === "invalid") {
      this.log.warn(`[ingest] invalid message on ${topic}: ${msg.reason}`);
      repo.insertRaw(this.db, topic, payload, now, msg.reason);
      // A malformed message still proves the device is alive.
      if (msg.deviceId) this.touch(this.device(msg.deviceId, now, retained), now, retained);
      return msg;
    }
    if (msg.kind === "ignored") return msg;
    // Heartbeats are summarised per minute instead of being stored raw.
    if (msg.kind !== "heartbeat") repo.insertRaw(this.db, topic, payload, now, null);

    const d = this.device(msg.deviceId, now, retained);
    this.touch(d, now, retained);
    try {
      switch (msg.kind) {
        case "status":
          this.onStatus(d, msg.value, now, retained);
          break;
        case "heartbeat":
          this.onHeartbeat(d, msg.data.seq, msg.data.up, now);
          break;
        case "telemetry":
          this.onTelemetry(d, msg.data.ts, msg.data.position, now);
          break;
        case "motion":
          this.onMotion(d, msg.data, now);
          break;
        case "sos":
          this.onSos(d, msg.data, now);
          break;
      }
    } catch (err) {
      this.log.error(`[ingest] failed to process ${topic}:`, err);
    }
    return msg;
  }

  private device(id: string, now: number, retained = false): DeviceRuntime {
    let d = this.devices.get(id);
    if (!d) {
      const row: DeviceRow = {
        id,
        displayName: null,
        firstSeen: now,
        lastSeen: retained ? null : now,
        lastStatus: null,
        lastHeartbeatAt: null,
        lastSeq: null,
        lastUp: null,
        lastLat: null,
        lastLon: null,
        lastFixChangedAt: null,
        lastFixTs: null,
        lastTelemetryAt: null,
        motionState: null,
        motionIndicator: null,
        motionAt: null,
        connection: "offline",
      };
      d = this.runtimeFor(row);
      d.lastStored = null;
      this.devices.set(id, d);
      repo.saveDevice(this.db, row);
      this.log.info(`[ingest] new device ${id}`);
    }
    return d;
  }

  /**
   * Record contact. A retained message is the broker replaying the past (e.g. a stale "offline" on
   * every resubscribe), not the device talking now, so it doesn't move "last seen".
   */
  private touch(d: DeviceRuntime, now: number, retained = false): void {
    if (!retained) {
      d.lastMessageAt = now;
      d.row.lastSeen = now;
    }
    d.dirty = true;
    d.pendingEmit = true;
  }

  private onStatus(d: DeviceRuntime, value: "online" | "offline", now: number, retained: boolean): void {
    d.row.lastStatus = value;
    // A retained "online" replayed on subscribe says nothing about when the device connected.
    d.onlineSince = value === "online" && !retained ? now : d.onlineSince;
    if (value === "offline") d.onlineSince = null;
    this.publish(d, now, true);
  }

  private onHeartbeat(d: DeviceRuntime, seq: number, up: number, now: number): void {
    const prev =
      d.row.lastSeq !== null && d.row.lastUp !== null && d.row.lastHeartbeatAt !== null
        ? { seq: d.row.lastSeq, up: d.row.lastUp, at: d.row.lastHeartbeatAt }
        : null;
    const check = checkHeartbeat(prev, { seq, up, at: now });
    if (check.duplicate) return;

    if (check.rebooted) {
      this.addEvent({
        deviceId: d.row.id,
        type: "reboot",
        ts: now,
        tsApprox: true,
        receivedAt: now,
        payload: { prevSeq: prev?.seq ?? null, prevUp: prev?.up ?? null, seq, up },
        severity: "info",
      });
      this.log.info(`[ingest] ${d.row.id} restarted (seq ${prev?.seq} → ${seq}, up ${prev?.up} → ${up})`);
      this.flushBucket(d);
    }

    d.row.lastSeq = seq;
    d.row.lastUp = up;
    d.row.lastHeartbeatAt = now;
    d.beats.push(now);
    pruneBeats(d.beats, now);

    const minute = Math.floor(now / 60_000) * 60_000;
    if (d.bucket && d.bucket.minute !== minute) this.flushBucket(d);
    if (!d.bucket) d.bucket = { minute, count: 0, minSeq: seq, maxSeq: seq };
    d.bucket.count++;
    d.bucket.minSeq = Math.min(d.bucket.minSeq, seq);
    d.bucket.maxSeq = Math.max(d.bucket.maxSeq, seq);
  }

  private flushBucket(d: DeviceRuntime): void {
    if (!d.bucket) return;
    repo.upsertHeartbeatMinute(this.db, d.row.id, d.bucket);
    d.bucket = null;
  }

  private onTelemetry(d: DeviceRuntime, tsIso: string | null, pos: { lat: number; lon: number } | null, now: number): void {
    d.row.lastTelemetryAt = now;
    if (!pos) {
      d.reportsNoFix = true;
      this.publish(d, now, true);
      return;
    }
    d.reportsNoFix = false;
    const { ts } = resolveEventTime(tsIso, now);

    // Late (queued) telemetry goes into history but never moves the current position backwards.
    const isCurrent = d.row.lastFixTs === null || ts >= d.row.lastFixTs;
    if (isCurrent) {
      const prev = d.row.lastLat !== null && d.row.lastLon !== null ? { lat: d.row.lastLat, lon: d.row.lastLon } : null;
      if (!samePosition(prev, pos)) d.row.lastFixChangedAt = now;
      d.lastFixAt = now;
      d.row.lastLat = pos.lat;
      d.row.lastLon = pos.lon;
      d.row.lastFixTs = ts;
    }

    if (d.lastStored === undefined) d.lastStored = repo.lastPosition(this.db, d.row.id) ?? null;
    const last = d.lastStored;
    const duplicate = last !== null && samePosition(last, pos) && Math.abs(ts - last.ts) <= DUPLICATE_POSITION_MS;
    if (!duplicate) {
      const p: PositionView = { ts, receivedAt: now, lat: pos.lat, lon: pos.lon };
      repo.insertPosition(this.db, d.row.id, p);
      if (last === null || ts >= last.ts) d.lastStored = p;
      this.emit({ type: "position.added", deviceId: d.row.id, position: p });
    }
    this.publish(d, now, true);
  }

  private onMotion(
    d: DeviceRuntime,
    m: {
      state: string;
      prev: string | null;
      indicator: string | null;
      ts: string | null;
      position: { lat: number; lon: number } | null;
      ageSec: number | null;
    },
    now: number,
  ): void {
    const t = resolveEventTime(m.ts, now);
    const ev = this.addEvent({
      deviceId: d.row.id,
      type: "motion",
      ts: t.ts,
      tsApprox: t.approx,
      receivedAt: now,
      payload: { state: m.state, prev: m.prev, indicator: m.indicator },
      lat: m.position?.lat ?? null,
      lon: m.position?.lon ?? null,
      ageSec: m.ageSec,
      severity: motionSeverity(m.state),
      dedupeKey: motionDedupeKey(m.state, m.prev, m.ts),
    });
    if (!ev) return;
    // Alerts can arrive late; only a newer transition replaces the current state.
    if (d.row.motionAt === null || t.ts >= d.row.motionAt) {
      d.row.motionState = m.state;
      d.row.motionIndicator = m.indicator;
      d.row.motionAt = t.ts;
    }
    if (m.state === "SUSPICIOUS") this.refreshStats(now, true);
    this.publish(d, now, true);
  }

  private onSos(
    d: DeviceRuntime,
    s: {
      level: string;
      presses: number;
      seq: number;
      ts: string | null;
      position: { lat: number; lon: number } | null;
      ageSec: number | null;
    },
    now: number,
  ): void {
    const t = resolveEventTime(s.ts, now);
    const ev = this.addEvent({
      deviceId: d.row.id,
      type: "sos",
      ts: t.ts,
      tsApprox: t.approx,
      receivedAt: now,
      payload: { level: s.level, presses: s.presses, seq: s.seq },
      lat: s.position?.lat ?? null,
      lon: s.position?.lon ?? null,
      ageSec: s.ageSec,
      severity: sosSeverity(s.level),
      dedupeKey: sosDedupeKey(s.seq, s.ts),
    });
    if (ev) this.log.warn(`[ingest] SOS ${s.level} from ${d.row.id} (seq ${s.seq}, ${s.presses} presses)`);
    else this.log.info(`[ingest] duplicate SOS from ${d.row.id} ignored (seq ${s.seq})`);
  }

  private addEvent(row: NewEventRow): EventView | null {
    const ev = repo.insertEvent(this.db, row);
    if (ev) this.emit({ type: "event.added", event: ev });
    return ev;
  }

  // ---------- derived state ----------

  private computeView(d: DeviceRuntime, now: number): DeviceView {
    const r = d.row;
    const frozen = !this.brokerConnected && d.view;
    const conn: { connection: Connection; reason: ConnectionReason } = frozen
      ? { connection: d.view!.connection, reason: d.view!.connectionReason }
      : deriveConnection(
          {
            brokerStatus: r.lastStatus,
            onlineSince: d.onlineSince,
            lastHeartbeatAt: r.lastHeartbeatAt,
            lastMessageAt: d.lastMessageAt,
            observingSince: this.observingSince,
          },
          now,
        );
    return {
      id: r.id,
      displayName: r.displayName,
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
      brokerStatus: r.lastStatus,
      connection: conn.connection,
      connectionReason: conn.reason,
      lastHeartbeatAt: r.lastHeartbeatAt,
      seq: r.lastSeq,
      up: r.lastUp,
      linkQuality: frozen ? d.view!.linkQuality : linkQuality(pruneBeats(d.beats, now), now, this.observingSince),
      gps: deriveGps({ lat: r.lastLat, lon: r.lastLon, reportsNoFix: d.reportsNoFix, lastFixAt: d.lastFixAt }, now),
      lat: r.lastLat,
      lon: r.lastLon,
      fixChangedAt: r.lastFixChangedAt,
      fixTs: r.lastFixTs,
      lastTelemetryAt: r.lastTelemetryAt,
      motionState: r.motionState,
      motionIndicator: r.motionIndicator,
      motionAt: r.motionAt,
    };
  }

  /** Recompute, record connection transitions, emit if changed, persist if due. */
  private publish(d: DeviceRuntime, now: number, persistNow = false): void {
    const view = this.computeView(d, now);
    d.view = view;

    const warm = this.observingSince !== null && now - this.observingSince >= WARMUP_MS;
    if (this.brokerConnected && warm && view.connection !== d.recordedConnection) {
      this.addEvent({
        deviceId: d.row.id,
        type: "status",
        ts: now,
        tsApprox: false,
        receivedAt: now,
        payload: { from: d.recordedConnection, to: view.connection, reason: view.connectionReason },
        severity: "info",
      });
      d.recordedConnection = view.connection;
      d.row.connection = view.connection;
      d.dirty = true;
      persistNow = true;
    }

    // Heartbeats only mark the device for the 1 s tick, so a live device sends at most one update per second.
    const key = JSON.stringify(view);
    if (key !== d.viewKey) {
      d.viewKey = key;
      this.emit({ type: "device.updated", device: view });
    }
    d.pendingEmit = false;

    if (d.dirty && (persistNow || now - d.lastPersistAt >= PERSIST_INTERVAL_MS)) {
      repo.saveDevice(this.db, d.row);
      d.dirty = false;
      d.lastPersistAt = now;
    }
  }

  private refreshStats(now: number, force = false): void {
    if (!force && now - this.lastStatsAt < STATS_INTERVAL_MS) return;
    this.lastStatsAt = now;
    const next: FleetStats = { motionAlerts24h: repo.countMotionAlerts(this.db, now - 86_400_000) };
    if (next.motionAlerts24h !== this.stats.motionAlerts24h || force) {
      this.stats = next;
      this.emit({ type: "stats.updated", stats: next });
    }
  }

  /** Run every second: derived status, link quality, minute summaries, periodic persistence. */
  tick(now: number): void {
    const minute = Math.floor(now / 60_000) * 60_000;
    for (const d of this.devices.values()) {
      if (d.bucket && d.bucket.minute < minute) this.flushBucket(d);
      this.publish(d, now);
    }
    this.refreshStats(now);
  }

  /** Persist everything (shutdown). */
  flush(): void {
    for (const d of this.devices.values()) {
      this.flushBucket(d);
      repo.saveDevice(this.db, d.row);
      d.dirty = false;
    }
  }

  // ---------- reads ----------

  views(now: number): DeviceView[] {
    return [...this.devices.values()].map((d) => d.view ?? this.computeView(d, now));
  }

  view(id: string, now: number): DeviceView | null {
    const d = this.devices.get(id);
    return d ? (d.view ?? this.computeView(d, now)) : null;
  }

  getStats(now: number): FleetStats {
    if (this.lastStatsAt === 0) this.refreshStats(now, true);
    return this.stats;
  }

  rename(id: string, displayName: string | null, now: number): DeviceView | null {
    const d = this.devices.get(id);
    if (!d) return null;
    d.row.displayName = displayName;
    repo.renameDevice(this.db, id, displayName);
    this.publish(d, now);
    return d.view;
  }
}

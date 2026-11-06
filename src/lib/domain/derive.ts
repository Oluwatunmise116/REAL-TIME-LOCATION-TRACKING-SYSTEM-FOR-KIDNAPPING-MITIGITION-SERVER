/**
 * Pure functions that turn raw device observations into the derived state the UI shows.
 * No I/O and no clock access: `now` is always passed in, which keeps them testable with fake timers.
 */
import type { StatusValue } from "@/lib/contract/schemas";
import type { Connection, ConnectionReason, GpsState } from "./types";

export const HEARTBEAT_INTERVAL_MS = 2_000;
/** No heartbeat for this long while status says online → "Signal lost". The Last Will only fires after ~30 s. */
export const SIGNAL_LOST_MS = 8_000;
/** No message at all for longer than this → "Offline". */
export const OFFLINE_SILENCE_MS = 60_000;
export const LINK_WINDOW_MS = 60_000;
export const EXPECTED_BEATS_PER_WINDOW = LINK_WINDOW_MS / HEARTBEAT_INTERVAL_MS; // 30
export const LIVE_FIX_MS = 60_000;

export interface LivenessInput {
  brokerStatus: StatusValue | null;
  /** Receive time of the most recent "online" status (gives a just-connected device a grace period). */
  onlineSince: number | null;
  lastHeartbeatAt: number | null;
  /** Receive time of the most recent message on any channel. */
  lastMessageAt: number | null;
  /** When the bridge started observing (subscribe time). Before that we could not have seen heartbeats. */
  observingSince: number | null;
}

export function deriveConnection(i: LivenessInput, now: number): { connection: Connection; reason: ConnectionReason } {
  if (i.brokerStatus === "offline") return { connection: "offline", reason: "last_will" };
  if (i.lastMessageAt === null || now - i.lastMessageAt > OFFLINE_SILENCE_MS) {
    return { connection: "offline", reason: "no_messages" };
  }
  const ref = Math.max(i.lastHeartbeatAt ?? -Infinity, i.onlineSince ?? -Infinity, i.observingSince ?? -Infinity);
  if (!Number.isFinite(ref) || now - ref >= SIGNAL_LOST_MS) {
    return { connection: "signal_lost", reason: "heartbeat_timeout" };
  }
  return { connection: "online", reason: "heartbeat" };
}

/**
 * Heartbeats received / expected over the last 60 s, as a 0–100 integer.
 * Expected is 30 per full window; while the observation window is younger than 60 s
 * (dashboard just started) it is scaled down so a fresh connection doesn't read as 10 %.
 * Returns null when fewer than two heartbeat intervals have been observed.
 */
export function linkQuality(beatTimes: readonly number[], now: number, observingSince: number | null): number | null {
  const windowStart = now - LINK_WINDOW_MS;
  const from = Math.max(windowStart, observingSince ?? windowStart);
  const observedMs = now - from;
  if (observedMs < HEARTBEAT_INTERVAL_MS * 2) return null;
  let count = 0;
  for (const t of beatTimes) if (t > windowStart && t <= now) count++;
  const expected = Math.min(EXPECTED_BEATS_PER_WINDOW, observedMs / HEARTBEAT_INTERVAL_MS);
  return Math.max(0, Math.min(100, Math.round((count / expected) * 100)));
}

/** Drop beat timestamps that have left the window (mutates and returns the array for cheap reuse). */
export function pruneBeats(beatTimes: number[], now: number): number[] {
  const cutoff = now - LINK_WINDOW_MS;
  let i = 0;
  while (i < beatTimes.length && beatTimes[i] <= cutoff) i++;
  if (i > 0) beatTimes.splice(0, i);
  return beatTimes;
}

export interface GpsInput {
  lat: number | null;
  lon: number | null;
  /** True when the latest telemetry carried lat/lon = null. */
  reportsNoFix: boolean;
  /** Receive time of the last accepted fix, moved or not (a parked device still has a live fix). */
  lastFixAt: number | null;
}

export function deriveGps(i: GpsInput, now: number): GpsState {
  if (i.reportsNoFix || i.lat === null || i.lon === null) return "none";
  if (i.lastFixAt !== null && now - i.lastFixAt <= LIVE_FIX_MS) return "live";
  return "last_known";
}

export interface HeartbeatSample {
  seq: number;
  up: number;
  /** Receive time (ms). */
  at: number;
}

export interface HeartbeatCheck {
  rebooted: boolean;
  /** Heartbeats missing between the previous and this one (QoS 0 drops). */
  missed: number;
  /** Same seq/up as last time — a redelivery, not a new beat. */
  duplicate: boolean;
}

/**
 * Compare a heartbeat with the previous one.
 * A reboot is any decrease in seq or up, or — across a gap where we saw nothing — an uptime
 * smaller than the wall-clock time that passed would allow (the device rebooted while unobserved).
 */
export function checkHeartbeat(prev: HeartbeatSample | null, next: HeartbeatSample): HeartbeatCheck {
  if (!prev) return { rebooted: false, missed: 0, duplicate: false };
  if (next.seq === prev.seq && next.up === prev.up) return { rebooted: false, missed: 0, duplicate: true };
  if (next.seq < prev.seq || next.up < prev.up) return { rebooted: true, missed: 0, duplicate: false };

  const elapsedSec = (next.at - prev.at) / 1000;
  if (elapsedSec > 30) {
    const tolerance = 15 + elapsedSec * 0.02;
    if (next.up + tolerance < prev.up + elapsedSec) return { rebooted: true, missed: 0, duplicate: false };
  }
  return { rebooted: false, missed: Math.max(0, next.seq - prev.seq - 1), duplicate: false };
}

/** Event time: device ts when present, else receive time flagged approximate. */
export function resolveEventTime(ts: string | null, receivedAt: number): { ts: number; approx: boolean } {
  if (ts) {
    const ms = Date.parse(ts);
    if (!Number.isNaN(ms)) return { ts: ms, approx: false };
  }
  return { ts: receivedAt, approx: true };
}

/** SOS retries carry the same seq and ts; dedupe on (deviceId, seq, ts). deviceId is a separate column. */
export function sosDedupeKey(seq: number, ts: string | null): string {
  return `sos:${seq}:${ts ?? "null"}`;
}

/** QoS 1 can redeliver motion transitions too. Without a device ts there is nothing safe to dedupe on. */
export function motionDedupeKey(state: string, prev: string | null, ts: string | null): string | null {
  return ts ? `motion:${prev ?? ""}>${state}:${ts}` : null;
}

export function sosSeverity(level: string): "critical" | "high" {
  return level === "DANGER" ? "critical" : "high";
}

export function motionSeverity(state: string): "warning" | "info" {
  return state === "SUSPICIOUS" ? "warning" : "info";
}

/** Two positions are "the same" at the 6-decimal precision the firmware publishes. */
export function samePosition(a: { lat: number; lon: number } | null, b: { lat: number; lon: number } | null): boolean {
  if (!a || !b) return false;
  return Math.abs(a.lat - b.lat) < 5e-7 && Math.abs(a.lon - b.lon) < 5e-7;
}

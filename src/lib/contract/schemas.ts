/**
 * Device → broker contract. Source of truth is the firmware; this file mirrors it.
 *
 * Topics: <root>/<deviceId>/<channel>
 *   status     plain text "online" | "offline"   (retained, Last Will = offline)
 *   heartbeat  {"seq":690,"up":1411}             (every 2 s, QoS 0)
 *   telemetry  {"ts","lat","lon"}                (every 10 s, last known position)
 *   motion     {"state","prev","indicator"?,"ts","lat","lon","age"}
 *   sos        {"level","presses","seq","ts","lat","lon","age"}
 *
 * Rules enforced here:
 *   - lat/lon null means "no fix ever accepted". Never coerced to 0. A (0,0)
 *     pair or a half-null pair is also normalised to "no position".
 *   - ts null (or unparseable) means the device clock is not synced; callers
 *     fall back to receive time and flag it as approximate.
 *   - Enum-like fields are accepted as free strings so unknown values from
 *     newer firmware render as-is instead of failing validation.
 */
import { z } from "zod";

export const CHANNELS = ["status", "heartbeat", "telemetry", "motion", "sos"] as const;
export type Channel = (typeof CHANNELS)[number];

export const MOTION_STATES = ["INITIALIZING", "CALIBRATING", "NORMAL", "CANDIDATE", "SUSPICIOUS"] as const;
export type KnownMotionState = (typeof MOTION_STATES)[number];

export const MOTION_INDICATORS = ["UNUSUAL_MOTION", "IMPACT_THEN_INACTIVITY", "SUSPECTED_DISTRESS"] as const;
export type KnownMotionIndicator = (typeof MOTION_INDICATORS)[number];

export const SOS_LEVELS = ["SUSPICIOUS", "DANGER"] as const;
export type KnownSosLevel = (typeof SOS_LEVELS)[number];

const coord = (min: number, max: number) => z.number().finite().min(min).max(max).nullable().optional();

/** ISO-8601 UTC string, null, or missing. Garbage strings become null rather than failing the message. */
const isoTs = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v): string | null => {
    if (typeof v !== "string" || v.trim() === "") return null;
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  });

const enumString = z
  .string()
  .trim()
  .min(1)
  .transform((s) => s.toUpperCase());

const optionalEnumString = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim().toUpperCase() : null));

/** Alert position age in seconds; -1 (or anything negative) = no position. */
const ageSec = z
  .number()
  .finite()
  .nullable()
  .optional()
  .transform((v): number | null => (typeof v === "number" && v >= 0 ? v : null));

export interface Position {
  lat: number;
  lon: number;
}

/** Collapse raw lat/lon into a position or null. Rejects half-null pairs and the (0,0) null-island. */
export function toPosition(lat: number | null | undefined, lon: number | null | undefined): Position | null {
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

export const heartbeatSchema = z.object({
  seq: z.number().int().nonnegative(),
  up: z.number().int().nonnegative(),
});

export const telemetrySchema = z
  .object({
    ts: isoTs,
    lat: coord(-90, 90),
    lon: coord(-180, 180),
  })
  .transform(({ ts, lat, lon }) => ({ ts, position: toPosition(lat, lon) }));

export const motionSchema = z
  .object({
    state: enumString,
    prev: optionalEnumString,
    indicator: optionalEnumString,
    ts: isoTs,
    lat: coord(-90, 90),
    lon: coord(-180, 180),
    age: ageSec,
  })
  .transform(({ lat, lon, age, ...rest }) => {
    const position = toPosition(lat, lon);
    return { ...rest, position, ageSec: position ? age : null };
  });

export const sosSchema = z
  .object({
    level: enumString,
    presses: z.number().int().nonnegative(),
    seq: z.number().int().nonnegative(),
    ts: isoTs,
    lat: coord(-90, 90),
    lon: coord(-180, 180),
    age: ageSec,
  })
  .transform(({ lat, lon, age, ...rest }) => {
    const position = toPosition(lat, lon);
    return { ...rest, position, ageSec: position ? age : null };
  });

export type HeartbeatPayload = z.output<typeof heartbeatSchema>;
export type TelemetryPayload = z.output<typeof telemetrySchema>;
export type MotionPayload = z.output<typeof motionSchema>;
export type SosPayload = z.output<typeof sosSchema>;
export type StatusValue = "online" | "offline";

export type ParsedMessage =
  | { kind: "status"; deviceId: string; value: StatusValue }
  | { kind: "heartbeat"; deviceId: string; data: HeartbeatPayload }
  | { kind: "telemetry"; deviceId: string; data: TelemetryPayload }
  | { kind: "motion"; deviceId: string; data: MotionPayload }
  | { kind: "sos"; deviceId: string; data: SosPayload }
  /** Retained-message clear (empty payload). Not an error, nothing to do. */
  | { kind: "ignored"; deviceId: string | null; reason: string }
  | { kind: "invalid"; deviceId: string | null; channel: string | null; reason: string };

export interface ParsedTopic {
  deviceId: string;
  channel: string;
}

const DEVICE_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;

/** "devices/sim-001/heartbeat" → { deviceId: "sim-001", channel: "heartbeat" }. */
export function parseTopic(topic: string, root: string): ParsedTopic | null {
  const parts = topic.split("/");
  const rootParts = root.split("/").filter(Boolean);
  if (parts.length !== rootParts.length + 2) return null;
  for (let i = 0; i < rootParts.length; i++) if (parts[i] !== rootParts[i]) return null;
  const deviceId = parts[rootParts.length];
  const channel = parts[rootParts.length + 1];
  if (!DEVICE_ID_RE.test(deviceId) || !channel) return null;
  return { deviceId, channel };
}

function describeZodError(err: z.ZodError): string {
  return err.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/** Parse one MQTT message. Never throws. */
export function parseMessage(topic: string, payload: string, root: string): ParsedMessage {
  const t = parseTopic(topic, root);
  if (!t) return { kind: "invalid", deviceId: null, channel: null, reason: `unrecognised topic "${topic}"` };
  const { deviceId, channel } = t;

  if (channel === "status") {
    const text = payload.trim().toLowerCase();
    if (text === "") return { kind: "ignored", deviceId, reason: "empty status (retained clear)" };
    if (text === "online" || text === "offline") return { kind: "status", deviceId, value: text };
    return { kind: "invalid", deviceId, channel, reason: `unknown status text "${payload.slice(0, 40)}"` };
  }

  if (!(CHANNELS as readonly string[]).includes(channel)) {
    return { kind: "invalid", deviceId, channel, reason: `unknown channel "${channel}"` };
  }
  if (payload.trim() === "") return { kind: "ignored", deviceId, reason: "empty payload" };

  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return { kind: "invalid", deviceId, channel, reason: "payload is not valid JSON" };
  }

  switch (channel) {
    case "heartbeat": {
      const r = heartbeatSchema.safeParse(json);
      return r.success
        ? { kind: "heartbeat", deviceId, data: r.data }
        : { kind: "invalid", deviceId, channel, reason: describeZodError(r.error) };
    }
    case "telemetry": {
      const r = telemetrySchema.safeParse(json);
      return r.success
        ? { kind: "telemetry", deviceId, data: r.data }
        : { kind: "invalid", deviceId, channel, reason: describeZodError(r.error) };
    }
    case "motion": {
      const r = motionSchema.safeParse(json);
      return r.success
        ? { kind: "motion", deviceId, data: r.data }
        : { kind: "invalid", deviceId, channel, reason: describeZodError(r.error) };
    }
    default: {
      const r = sosSchema.safeParse(json);
      return r.success
        ? { kind: "sos", deviceId, data: r.data }
        : { kind: "invalid", deviceId, channel, reason: describeZodError(r.error) };
    }
  }
}

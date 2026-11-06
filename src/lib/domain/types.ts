/**
 * DTOs shared by the server (bridge, REST, SSE) and the browser store.
 * Timestamps are epoch milliseconds unless the name says otherwise.
 */
import type { StatusValue } from "@/lib/contract/schemas";

export type Connection = "online" | "signal_lost" | "offline";
export type GpsState = "live" | "last_known" | "none";
export type EventType = "sos" | "motion" | "status" | "reboot";
export type Severity = "critical" | "high" | "warning" | "info";
export type BrokerState = "connecting" | "connected" | "reconnecting" | "offline" | "error" | "not_configured";

export type ConnectionReason = "heartbeat" | "heartbeat_timeout" | "last_will" | "no_messages";

export interface DeviceView {
  id: string;
  displayName: string | null;
  firstSeen: number;
  lastSeen: number | null;
  /** Last retained status text from the broker. */
  brokerStatus: StatusValue | null;
  /** Derived server-side from status + heartbeat freshness. */
  connection: Connection;
  connectionReason: ConnectionReason;
  lastHeartbeatAt: number | null;
  seq: number | null;
  /** Device uptime in seconds as of `lastHeartbeatAt`. */
  up: number | null;
  /** % of expected heartbeats received over the last 60 s, null while there is not enough data. */
  linkQuality: number | null;
  gps: GpsState;
  /** Last accepted (non-null) position. Null = the device has never reported a fix. */
  lat: number | null;
  lon: number | null;
  /** Receive time of the telemetry that last changed the position. */
  fixChangedAt: number | null;
  /** Device ts (ms) of the telemetry carrying the current position; null if not synced. */
  fixTs: number | null;
  lastTelemetryAt: number | null;
  motionState: string | null;
  motionIndicator: string | null;
  motionAt: number | null;
}

export interface SosEventPayload {
  level: string;
  presses: number;
  seq: number;
}
export interface MotionEventPayload {
  state: string;
  prev: string | null;
  indicator: string | null;
}
export interface StatusEventPayload {
  from: Connection;
  to: Connection;
  reason: ConnectionReason;
}
export interface RebootEventPayload {
  prevSeq: number | null;
  prevUp: number | null;
  seq: number;
  up: number;
}

interface EventBase {
  id: number;
  deviceId: string;
  /** Event time: device ts, or receive time when the device clock was not synced. */
  ts: number;
  tsApprox: boolean;
  receivedAt: number;
  lat: number | null;
  lon: number | null;
  /** Seconds between fix acceptance and the event. Null = no position. */
  ageSec: number | null;
  severity: Severity;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
}

export type EventView =
  | (EventBase & { type: "sos"; payload: SosEventPayload })
  | (EventBase & { type: "motion"; payload: MotionEventPayload })
  | (EventBase & { type: "status"; payload: StatusEventPayload })
  | (EventBase & { type: "reboot"; payload: RebootEventPayload });

export interface PositionView {
  ts: number;
  receivedAt: number;
  lat: number;
  lon: number;
}

export interface HeartbeatMinuteView {
  /** Start of the minute bucket (ms). */
  minute: number;
  count: number;
  minSeq: number;
  maxSeq: number;
}

export interface FleetStats {
  motionAlerts24h: number;
}

export interface BrokerHealth {
  state: BrokerState;
  url: string | null;
  lastMessageAt: number | null;
  connectedAt: number | null;
  lastError: string | null;
}

export type StreamMessage =
  | {
      type: "snapshot";
      serverTime: number;
      devices: DeviceView[];
      events: EventView[];
      activeSos: EventView[];
      stats: FleetStats;
      broker: BrokerHealth;
    }
  | { type: "device.updated"; device: DeviceView }
  | { type: "position.added"; deviceId: string; position: PositionView }
  | { type: "event.added"; event: EventView }
  | { type: "event.acknowledged"; event: EventView }
  | { type: "stats.updated"; stats: FleetStats }
  | { type: "broker.updated"; broker: BrokerHealth };

/** Messages the bridge emits on the in-process bus (everything except the per-client snapshot). */
export type BusMessage = Exclude<StreamMessage, { type: "snapshot" }>;

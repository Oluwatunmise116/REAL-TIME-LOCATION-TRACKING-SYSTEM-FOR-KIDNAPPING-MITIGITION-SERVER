/**
 * UI wording. Firmware authors' rule: the IMU detects unusual *motion patterns*, never
 * kidnapping, assault or restraint. SOS is the only human-intent signal.
 * Unknown enum values are returned as-is so newer firmware never breaks the UI.
 */
import type { Connection, EventView, GpsState } from "./types";

const MOTION_STATE_LABELS: Record<string, string> = {
  INITIALIZING: "Initializing",
  CALIBRATING: "Calibrating",
  NORMAL: "Normal motion",
  CANDIDATE: "Checking motion",
  SUSPICIOUS: "Unusual motion",
};

const MOTION_INDICATOR_LABELS: Record<string, string> = {
  UNUSUAL_MOTION: "Unusual motion",
  IMPACT_THEN_INACTIVITY: "Impact then inactivity",
  SUSPECTED_DISTRESS: "Suspected distress (motion pattern)",
};

const SOS_LEVEL_LABELS: Record<string, string> = {
  SUSPICIOUS: "Suspicious",
  DANGER: "Danger",
};

export function motionStateLabel(state: string | null | undefined): string {
  if (!state) return "No motion data";
  return MOTION_STATE_LABELS[state] ?? state;
}

export function motionIndicatorLabel(indicator: string | null | undefined): string | null {
  if (!indicator) return null;
  return MOTION_INDICATOR_LABELS[indicator] ?? indicator;
}

/** Headline for a motion state, preferring the indicator when the state is SUSPICIOUS. */
export function motionHeadline(state: string | null | undefined, indicator: string | null | undefined): string {
  if (state === "SUSPICIOUS" && indicator) return motionIndicatorLabel(indicator) ?? motionStateLabel(state);
  return motionStateLabel(state);
}

export function sosLevelLabel(level: string): string {
  return SOS_LEVEL_LABELS[level] ?? level;
}

export function connectionLabel(c: Connection): string {
  return c === "online" ? "Online" : c === "signal_lost" ? "Signal lost" : "Offline";
}

export function gpsLabel(g: GpsState): string {
  return g === "live" ? "Live fix" : g === "last_known" ? "Last known" : "No fix";
}

export function eventTitle(e: EventView): string {
  switch (e.type) {
    case "sos":
      return `SOS · ${sosLevelLabel(e.payload.level)}`;
    case "motion":
      if (e.payload.state === "CANDIDATE") return "Possible unusual motion (checking)";
      if (e.payload.state === "NORMAL" && e.payload.prev === "SUSPICIOUS") return "Motion back to normal";
      return motionHeadline(e.payload.state, e.payload.indicator);
    case "reboot":
      return "Device restarted";
    case "status":
      if (e.payload.to === "online") return e.payload.from === "signal_lost" ? "Signal restored" : "Came online";
      if (e.payload.to === "signal_lost") return "Signal lost";
      return e.payload.reason === "last_will" ? "Went offline (broker Last Will)" : "Went offline (no messages)";
  }
}

export function eventDetail(e: EventView): string | null {
  switch (e.type) {
    case "sos":
      return `${e.payload.presses} press${e.payload.presses === 1 ? "" : "es"} in window · activation #${e.payload.seq}`;
    case "motion": {
      const parts = [`${motionStateLabel(e.payload.prev)} → ${motionStateLabel(e.payload.state)}`];
      const ind = motionIndicatorLabel(e.payload.indicator);
      if (ind && e.payload.state !== "SUSPICIOUS") parts.push(ind);
      return parts.join(" · ");
    }
    case "reboot":
      return e.payload.prevSeq !== null ? `Heartbeat seq ${e.payload.prevSeq} → ${e.payload.seq}` : null;
    case "status":
      return e.payload.reason === "heartbeat_timeout" ? "No heartbeat for 8 s or more" : null;
  }
}

/** Events that need a human to acknowledge them. */
export function isAckable(e: EventView): boolean {
  return e.type === "sos" || (e.type === "motion" && e.payload.state === "SUSPICIOUS");
}

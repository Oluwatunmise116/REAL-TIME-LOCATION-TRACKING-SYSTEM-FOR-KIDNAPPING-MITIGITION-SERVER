"use client";

import { create } from "zustand";
import type { BrokerHealth, DeviceView, EventView, FleetStats, PositionView, StreamMessage } from "@/lib/domain/types";
import type { ClientConfig } from "./config";

export type SseState = "connecting" | "live" | "reconnecting";

const MAX_EVENTS = 500;
const MAX_LIVE_POSITIONS = 2_000;

export interface Prefs {
  sound: boolean;
  notifications: boolean;
}

interface State {
  /** True once the first snapshot has been applied. */
  ready: boolean;
  /** Increments on every snapshot (initial load and each SSE reconnect re-sync). */
  snapshotSeq: number;
  sse: SseState;
  broker: BrokerHealth | null;
  /** serverTime − Date.now() at snapshot, so relative times survive a skewed browser clock. */
  clockOffset: number;
  devices: Record<string, DeviceView>;
  /** Newest first by event time (ts), capped. */
  events: EventView[];
  /** Unacknowledged SOS events by id (complete, not capped). */
  activeSos: Record<number, EventView>;
  stats: FleetStats;
  /** Positions received live since the last snapshot, per device, oldest first. */
  livePositions: Record<string, PositionView[]>;
  selectedId: string | null;
  /** Bumped to ask the map to fly to a device (e.g. "View on map" on an SOS). */
  focusRequest: { deviceId: string; at: number; lat?: number; lon?: number } | null;
  config: ClientConfig | null;
  configError: string | null;
  prefs: Prefs;

  apply: (m: StreamMessage) => void;
  setSse: (s: SseState) => void;
  select: (id: string | null) => void;
  focus: (deviceId: string, pos?: { lat: number; lon: number }) => void;
  setConfig: (c: ClientConfig | null, error?: string | null) => void;
  setPrefs: (p: Partial<Prefs>) => void;
  /** Load persisted prefs after mount (avoids a hydration mismatch). */
  initPrefs: () => void;
  upsertEvents: (events: EventView[]) => void;
  upsertDevice: (d: DeviceView) => void;
}

const PREFS_KEY = "axiometer.prefs";

function loadPrefs(): Prefs {
  const fallback: Prefs = { sound: true, notifications: true };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<Prefs>) } : fallback;
  } catch {
    return fallback;
  }
}

function insertEvent(list: EventView[], e: EventView): EventView[] {
  const without = list.filter((x) => x.id !== e.id);
  // Late alerts are common (queued while the link was down): insert by ts, not at the top.
  const i = without.findIndex((x) => x.ts < e.ts || (x.ts === e.ts && x.id < e.id));
  const next = i === -1 ? [...without, e] : [...without.slice(0, i), e, ...without.slice(i)];
  return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
}

export const useStore = create<State>((set) => ({
  ready: false,
  snapshotSeq: 0,
  sse: "connecting",
  broker: null,
  clockOffset: 0,
  devices: {},
  events: [],
  activeSos: {},
  stats: { motionAlerts24h: 0 },
  livePositions: {},
  selectedId: null,
  focusRequest: null,
  config: null,
  configError: null,
  prefs: { sound: true, notifications: true },

  apply: (m) =>
    set((s) => {
      switch (m.type) {
        case "snapshot":
          return {
            ready: true,
            snapshotSeq: s.snapshotSeq + 1,
            clockOffset: m.serverTime - Date.now(),
            devices: Object.fromEntries(m.devices.map((d) => [d.id, d])),
            events: [...m.events].sort((a, b) => b.ts - a.ts || b.id - a.id),
            activeSos: Object.fromEntries(m.activeSos.map((e) => [e.id, e])),
            stats: m.stats,
            broker: m.broker,
            livePositions: {},
          };
        case "device.updated":
          return { devices: { ...s.devices, [m.device.id]: m.device } };
        case "position.added": {
          const prev = s.livePositions[m.deviceId] ?? [];
          const next = [...prev, m.position].sort((a, b) => a.ts - b.ts);
          return {
            livePositions: {
              ...s.livePositions,
              [m.deviceId]: next.length > MAX_LIVE_POSITIONS ? next.slice(-MAX_LIVE_POSITIONS) : next,
            },
          };
        }
        case "event.added": {
          const activeSos =
            m.event.type === "sos" && m.event.acknowledgedAt === null ? { ...s.activeSos, [m.event.id]: m.event } : s.activeSos;
          return { events: insertEvent(s.events, m.event), activeSos };
        }
        case "event.acknowledged": {
          const activeSos = { ...s.activeSos };
          delete activeSos[m.event.id];
          return {
            events: s.events.some((e) => e.id === m.event.id) ? insertEvent(s.events, m.event) : s.events,
            activeSos,
          };
        }
        case "stats.updated":
          return { stats: m.stats };
        case "broker.updated":
          return { broker: m.broker };
      }
    }),
  setSse: (sse) => set({ sse }),
  select: (selectedId) => set({ selectedId }),
  focus: (deviceId, pos) => set({ selectedId: deviceId, focusRequest: { deviceId, at: Date.now(), lat: pos?.lat, lon: pos?.lon } }),
  setConfig: (config, error = null) => set({ config, configError: error }),
  setPrefs: (p) =>
    set((s) => {
      const prefs = { ...s.prefs, ...p };
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      } catch {
        /* private mode: keep in memory */
      }
      return { prefs };
    }),
  initPrefs: () => set({ prefs: loadPrefs() }),
  upsertEvents: (events) =>
    set((s) => {
      let list = s.events;
      const activeSos = { ...s.activeSos };
      for (const e of events) {
        if (list.some((x) => x.id === e.id)) list = insertEvent(list, e);
        if (e.type === "sos") {
          if (e.acknowledgedAt === null) activeSos[e.id] = e;
          else delete activeSos[e.id];
        }
      }
      return { events: list, activeSos };
    }),
  upsertDevice: (d) => set((s) => ({ devices: { ...s.devices, [d.id]: d } })),
}));

/** Display name with fallback to the device id. */
export function deviceName(d: Pick<DeviceView, "id" | "displayName"> | undefined | null, fallbackId?: string): string {
  return d?.displayName || d?.id || fallbackId || "Unknown device";
}

/** Sort: active SOS first, then motion alerts, online, signal lost, offline; then by name. */
export function sortDevices(devices: DeviceView[], sosDeviceIds: Set<string>): DeviceView[] {
  const rank = (d: DeviceView) =>
    sosDeviceIds.has(d.id)
      ? 0
      : d.motionState === "SUSPICIOUS"
        ? 1
        : d.connection === "online"
          ? 2
          : d.connection === "signal_lost"
            ? 3
            : 4;
  return [...devices].sort((a, b) => rank(a) - rank(b) || deviceName(a).localeCompare(deviceName(b)));
}

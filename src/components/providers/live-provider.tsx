"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { armAudio, notify, startAlarm, stopAlarm } from "@/lib/client/alarm";
import type { ClientConfig } from "@/lib/client/config";
import { formatShortCoord } from "@/lib/client/format";
import { deviceName, useStore } from "@/lib/client/store";
import { connectionLabel, motionHeadline, sosLevelLabel } from "@/lib/domain/labels";
import type { DeviceView, EventView, StreamMessage } from "@/lib/domain/types";

/** Ignore "new alert" side effects for alerts this much older than now (backlog after a reconnect). */
const STALE_ALERT_MS = 10 * 60 * 1000;

function sideEffects(m: StreamMessage, before: { devices: Record<string, DeviceView> }) {
  const s = useStore.getState();
  if (m.type === "event.added") {
    const e = m.event;
    const name = deviceName(s.devices[e.deviceId], e.deviceId);
    const stale = Date.now() + s.clockOffset - e.ts > STALE_ALERT_MS;
    if (e.type === "sos" && e.acknowledgedAt === null) {
      const where = e.lat !== null && e.lon !== null ? formatShortCoord(e.lat, e.lon) : "no position";
      if (s.prefs.notifications) {
        notify(
          `SOS · ${sosLevelLabel(e.payload.level).toUpperCase()} — ${name}`,
          `${e.payload.presses} presses · ${where}`,
          `sos-${e.deviceId}`,
          () => s.focus(e.deviceId, e.lat !== null && e.lon !== null ? { lat: e.lat, lon: e.lon } : undefined),
        );
      }
      if (!stale) s.focus(e.deviceId, e.lat !== null && e.lon !== null ? { lat: e.lat, lon: e.lon } : undefined);
    } else if (e.type === "motion" && e.payload.state === "SUSPICIOUS" && !stale) {
      toast.warning(`${motionHeadline(e.payload.state, e.payload.indicator)} · ${name}`, {
        id: `motion-${e.id}`,
        description: "Motion pattern flagged by the IMU. Check the device timeline.",
        duration: 10_000,
      });
    }
  } else if (m.type === "device.updated") {
    const prev = before.devices[m.device.id];
    const next = m.device;
    if (prev && prev.connection === "online" && next.connection !== "online") {
      toast(`${connectionLabel(next.connection)} · ${deviceName(next)}`, {
        id: `conn-${next.id}`,
        description:
          next.connection === "signal_lost"
            ? "No heartbeat for 8 s. The device may be out of coverage."
            : next.connectionReason === "last_will"
              ? "The broker reported the device disconnected."
              : "No messages for over a minute.",
        duration: 8_000,
      });
    }
  }
}

async function loadConfig(onUnauthorized: () => void): Promise<void> {
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    if (r.status === 401) {
      onUnauthorized();
      return;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    useStore.getState().setConfig((await r.json()) as ClientConfig);
  } catch (err) {
    useStore.getState().setConfig(null, err instanceof Error ? err.message : "failed to load config");
  }
}

/** Opens the SSE stream, applies messages to the store, and runs alert side effects. */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    const toLogin = () => routerRef.current.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    useStore.getState().initPrefs();
    void loadConfig(toLogin);

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      es = new EventSource("/api/stream");
      es.onmessage = (ev) => {
        let m: StreamMessage;
        try {
          m = JSON.parse(ev.data as string) as StreamMessage;
        } catch {
          return;
        }
        const before = { devices: useStore.getState().devices };
        useStore.getState().apply(m);
        if (m.type === "snapshot") {
          attempt = 0;
          useStore.getState().setSse("live");
          const newest = [...m.activeSos].sort((a, b) => b.ts - a.ts)[0];
          if (newest)
            useStore
              .getState()
              .focus(newest.deviceId, newest.lat !== null && newest.lon !== null ? { lat: newest.lat, lon: newest.lon } : undefined);
        } else {
          sideEffects(m, before);
        }
      };
      es.onerror = () => {
        useStore.getState().setSse("reconnecting");
        if (es?.readyState !== EventSource.CLOSED) return; // the browser retries on its own
        es.close();
        // Closed for good (HTTP error). Check whether the session expired, then back off and retry.
        void fetch("/api/config", { cache: "no-store" })
          .then((r) => {
            if (r.status === 401) toLogin();
          })
          .catch(() => {});
        const delay = Math.min(30_000, 1_000 * 2 ** attempt++);
        retryTimer = setTimeout(connect, delay);
      };
    };
    connect();

    const arm = () => armAudio();
    window.addEventListener("pointerdown", arm, { passive: true });
    window.addEventListener("keydown", arm);

    return () => {
      disposed = true;
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, []);

  // Alarm loops while any SOS is unacknowledged and sound is enabled.
  const alarmOn = useStore((s) => s.prefs.sound && Object.keys(s.activeSos).length > 0);
  useEffect(() => {
    if (alarmOn) startAlarm();
    else stopAlarm();
    return () => stopAlarm();
  }, [alarmOn]);

  return children;
}

/** Acknowledge an event via the API and reconcile the store. */
export async function acknowledge(e: Pick<EventView, "id">, includeEarlier = false): Promise<boolean> {
  try {
    const r = await fetch(`/api/events/${e.id}/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeEarlier }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { events } = (await r.json()) as { events: EventView[] };
    useStore.getState().upsertEvents(events.filter(Boolean));
    return true;
  } catch (err) {
    toast.error("Could not acknowledge", { description: err instanceof Error ? err.message : undefined });
    return false;
  }
}

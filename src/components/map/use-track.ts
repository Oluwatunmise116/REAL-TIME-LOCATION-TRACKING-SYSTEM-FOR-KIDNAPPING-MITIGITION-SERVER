"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/client/store";
import type { PositionView } from "@/lib/domain/types";

export type TrackRange = "live" | "today" | "24h" | "7d";

export const RANGES: { id: TrackRange; label: string }[] = [
  { id: "live", label: "Live (1h)" },
  { id: "today", label: "Today" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
];

export function rangeStart(r: TrackRange, now: number): number {
  switch (r) {
    case "live":
      return now - 3_600_000;
    case "today": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    case "24h":
      return now - 86_400_000;
    case "7d":
      return now - 7 * 86_400_000;
  }
}

const EMPTY: PositionView[] = [];

/** History from the API for the range, extended with positions arriving live over SSE. */
export function useTrack(deviceId: string | null, range: TrackRange) {
  const snapshotSeq = useStore((s) => s.snapshotSeq);
  const live = useStore((s) => (deviceId ? s.livePositions[deviceId] : undefined)) ?? EMPTY;
  const key = deviceId ? `${deviceId}|${range}|${snapshotSeq}` : null;
  const [state, setState] = useState<{ key: string | null; from: number; positions: PositionView[]; error: string | null }>({
    key: null,
    from: 0,
    positions: EMPTY,
    error: null,
  });

  useEffect(() => {
    if (!key || !deviceId) return;
    const ctrl = new AbortController();
    const from = rangeStart(range, Date.now());
    fetch(`/api/devices/${encodeURIComponent(deviceId)}/track?from=${from}`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const { positions } = (await r.json()) as { positions: PositionView[] };
        setState({ key, from, positions, error: null });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({ key, from, positions: EMPTY, error: err instanceof Error ? err.message : "failed" });
      });
    return () => ctrl.abort();
  }, [key, deviceId, range]);

  const loading = state.key !== key;
  const positions = useMemo(() => {
    if (loading) return EMPTY;
    const lastTs = state.positions.length ? state.positions[state.positions.length - 1].ts : -Infinity;
    const extra = live.filter((p) => p.ts > lastTs && p.ts >= state.from);
    return extra.length ? [...state.positions, ...extra] : state.positions;
  }, [loading, state, live]);

  return { positions, loading, error: loading ? null : state.error };
}

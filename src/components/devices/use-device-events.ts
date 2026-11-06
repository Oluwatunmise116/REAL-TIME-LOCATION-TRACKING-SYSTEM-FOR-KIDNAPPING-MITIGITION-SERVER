"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/client/store";
import type { EventView } from "@/lib/domain/types";

/** A device's event history (paged REST) merged with live events from the store. Newest first by ts. */
export function useDeviceEvents(deviceId: string) {
  const snapshotSeq = useStore((s) => s.snapshotSeq);
  const storeEvents = useStore((s) => s.events);
  const [pages, setPages] = useState<{ key: string; events: EventView[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = `${deviceId}|${snapshotSeq}`;

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const q = new URLSearchParams({ deviceId, limit: "100" });
      if (cursor) q.set("cursor", cursor);
      const r = await fetch(`/api/events?${q}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as { events: EventView[]; nextCursor: string | null };
    },
    [deviceId],
  );

  useEffect(() => {
    let cancelled = false;
    fetchPage(null)
      .then((p) => !cancelled && (setPages({ key, events: p.events, cursor: p.nextCursor }), setError(null)))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "failed"));
    return () => {
      cancelled = true;
    };
  }, [fetchPage, key]);

  const loadMore = useCallback(async () => {
    if (!pages?.cursor) return;
    setLoadingMore(true);
    try {
      const p = await fetchPage(pages.cursor);
      setPages((prev) => (prev ? { ...prev, events: [...prev.events, ...p.events], cursor: p.nextCursor } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, pages]);

  const events = useMemo(() => {
    const byId = new Map<number, EventView>();
    for (const e of pages?.events ?? []) byId.set(e.id, e);
    // Store copies are newer (live acks, late arrivals).
    for (const e of storeEvents) if (e.deviceId === deviceId) byId.set(e.id, e);
    return [...byId.values()].sort((a, b) => b.ts - a.ts || b.id - a.id);
  }, [pages, storeEvents, deviceId]);

  return { events, loading: pages === null && !error, error, hasMore: Boolean(pages?.cursor), loadMore, loadingMore };
}

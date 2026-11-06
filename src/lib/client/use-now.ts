"use client";

import { useSyncExternalStore } from "react";
import { useStore } from "./store";

// One shared 1 s clock for every relative timestamp on the page.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!timer) {
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 1_000);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Current server-aligned time in ms, re-rendering every second. Returns 0 during SSR. */
export function useNow(): number {
  const offset = useStore((s) => s.clockOffset);
  const t = useSyncExternalStore(
    subscribe,
    () => now,
    () => 0,
  );
  return t === 0 ? 0 : t + offset;
}

/** Current time floored to the minute: re-renders only when the minute changes. 0 during SSR. */
export function useMinuteNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(now / 60_000) * 60_000,
    () => 0,
  );
}

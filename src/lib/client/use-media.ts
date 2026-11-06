"use client";

import { useSyncExternalStore } from "react";

/** matchMedia as a hook. Server render (and hydration) uses `serverValue`. */
export function useMedia(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

export const useIsPhone = () => useMedia("(max-width: 767px)");

"use client";

import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { useEffect, useState } from "react";

// Cache by coordinates rounded to 4 decimals (~11 m): a moving device doesn't re-query every update.
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

export type GeocodeResult = { status: "loading" } | { status: "ok"; address: string } | { status: "none" } | { status: "error" };

/** Reverse geocode. Must be rendered inside an APIProvider. */
export function useReverseGeocode(lat: number | null, lon: number | null): GeocodeResult {
  const lib = useMapsLibrary("geocoding");
  const key = lat !== null && lon !== null ? `${lat.toFixed(4)},${lon.toFixed(4)}` : null;
  const [state, setState] = useState<{ key: string | null; result: GeocodeResult }>({ key: null, result: { status: "loading" } });

  useEffect(() => {
    if (!lib || !key) return;
    if (cache.has(key)) return;
    let cancelled = false;
    let p = inflight.get(key);
    if (!p) {
      const [la, lo] = key.split(",").map(Number);
      p = new lib.Geocoder()
        .geocode({ location: { lat: la, lng: lo } })
        .then((r) => r.results[0]?.formatted_address ?? null)
        .then((addr) => {
          cache.set(key, addr);
          return addr;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    p.then(
      (addr) => !cancelled && setState({ key, result: addr ? { status: "ok", address: addr } : { status: "none" } }),
      () => !cancelled && setState({ key, result: { status: "error" } }),
    );
    return () => {
      cancelled = true;
    };
  }, [lib, key]);

  if (!key) return { status: "none" };
  if (cache.has(key)) {
    const addr = cache.get(key);
    return addr ? { status: "ok", address: addr } : { status: "none" };
  }
  return state.key === key ? state.result : { status: "loading" };
}

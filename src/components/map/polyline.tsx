"use client";

import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { useEffect, useRef } from "react";

export interface PolylineProps {
  path: google.maps.LatLngLiteral[];
  color: string;
  weight?: number;
  opacity?: number;
  zIndex?: number;
}

/** Minimal declarative wrapper around google.maps.Polyline (created once, updated in place, removed on unmount). */
export function Polyline({ path, color, weight = 4, opacity = 1, zIndex = 1 }: PolylineProps) {
  const map = useMap();
  const maps = useMapsLibrary("maps");
  const line = useRef<google.maps.Polyline | null>(null);

  useEffect(() => {
    if (!map || !maps) return;
    const l = new maps.Polyline({ map, clickable: false, geodesic: false });
    line.current = l;
    return () => {
      l.setMap(null);
      line.current = null;
    };
  }, [map, maps]);

  useEffect(() => {
    line.current?.setOptions({ strokeColor: color, strokeWeight: weight, strokeOpacity: opacity, zIndex });
  }, [color, weight, opacity, zIndex, map, maps]);

  useEffect(() => {
    line.current?.setPath(path);
  }, [path, map, maps]);

  return null;
}

/** Chaikin corner-cutting so a 10 s-sampled track reads as a smooth route line. */
export function smoothPath(points: google.maps.LatLngLiteral[], iterations = 2): google.maps.LatLngLiteral[] {
  if (points.length < 3 || points.length > 3_000) return points;
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    const out: google.maps.LatLngLiteral[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      out.push({ lat: 0.75 * a.lat + 0.25 * b.lat, lng: 0.75 * a.lng + 0.25 * b.lng });
      out.push({ lat: 0.25 * a.lat + 0.75 * b.lat, lng: 0.25 * a.lng + 0.75 * b.lng });
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

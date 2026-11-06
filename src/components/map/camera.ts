"use client";

/**
 * Camera helpers that account for UI floating over the map: the info card on wide maps and
 * the bottom sheet on phones (which covers roughly the lower half at its default snap).
 */

const PHONE_MAX = 767;

function isPhone(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= PHONE_MAX;
}

export function visiblePadding(map: google.maps.Map): google.maps.Padding {
  const div = map.getDiv();
  const w = div.clientWidth;
  const h = div.clientHeight;
  if (isPhone()) return { top: 120, right: 64, bottom: Math.round(h * 0.55), left: 32 };
  // Leave room for the 360 px info card only when the map is wide enough to spare it.
  const left = w >= 900 ? 400 : 48;
  return { top: 80, right: 80, bottom: 60, left };
}

/**
 * Center a point in the part of the map that isn't covered by floating UI. On phones, "upper" suits a
 * half-open bottom sheet; "lower" suits an info card on top with the sheet at peek.
 */
export function panToVisible(
  map: google.maps.Map,
  pos: google.maps.LatLngLiteral,
  zoom?: number,
  placement: "upper" | "lower" = "upper",
): void {
  if (zoom !== undefined) map.setZoom(zoom);
  if (!isPhone()) {
    map.panTo(pos);
    return;
  }
  map.setCenter(pos);
  map.panBy(0, Math.round(map.getDiv().clientHeight * (placement === "upper" ? 0.25 : -0.2)));
}

export function fitPoints(map: google.maps.Map, points: google.maps.LatLngLiteral[], singleZoom = 15): void {
  if (points.length === 0) return;
  if (points.length === 1) {
    panToVisible(map, points[0], Math.max(map.getZoom() ?? singleZoom, singleZoom));
    return;
  }
  const b = new google.maps.LatLngBounds();
  for (const p of points) b.extend(p);
  map.fitBounds(b, visiblePadding(map));
}

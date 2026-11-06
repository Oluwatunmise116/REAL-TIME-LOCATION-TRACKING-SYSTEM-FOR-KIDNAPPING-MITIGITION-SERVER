"use client";

import { useMap } from "@vis.gl/react-google-maps";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, SatelliteDish } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { deviceVisual } from "@/components/status/chips";
import { ConnectionPill } from "@/components/shell/connection-pill";
import { useActiveSosByDevice } from "@/components/shell/sos-banner";
import { cn } from "@/lib/utils";
import { deviceName, useStore } from "@/lib/client/store";
import { useMinuteNow } from "@/lib/client/use-now";
import { eventTitle } from "@/lib/domain/labels";
import type { DeviceView, EventView, PositionView } from "@/lib/domain/types";
import { fitPoints, panToVisible } from "./camera";
import { AlertInfoCard, DeviceInfoCard } from "./info-card";
import { MapControls } from "./map-controls";
import { MapGlassCard, MapShell, useMapsAvailable } from "./map-shell";
import { AlertPin, alertPins, DeviceMarker, TrailStart } from "./markers";
import { Polyline, smoothPath } from "./polyline";
import { RANGES, rangeStart, useTrack, type TrackRange } from "./use-track";

const ACCENT = "#16A34A";

export function RangePills({ value, onChange, className }: { value: TrackRange; onChange: (r: TrackRange) => void; className?: string }) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as TrackRange)}
      aria-label="Trail time range"
      className={cn("glass rounded-full p-1 shadow-float ring-1 ring-black/5 dark:ring-white/10", className)}
    >
      {RANGES.map((r) => (
        <ToggleGroupItem
          key={r.id}
          value={r.id}
          className="h-9 rounded-full px-3.5 text-xs font-semibold whitespace-nowrap data-[state=on]:bg-foreground data-[state=on]:text-background"
        >
          {r.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function points(device: DeviceView, positions: PositionView[]): google.maps.LatLngLiteral[] {
  const pts = positions.map((p) => ({ lat: p.lat, lng: p.lon }));
  if (device.lat !== null && device.lon !== null) pts.push({ lat: device.lat, lng: device.lon });
  return pts;
}

function DeviceCamera({
  device,
  positions,
  range,
  loading,
  follow,
  setFollow,
}: {
  device: DeviceView;
  positions: PositionView[];
  range: TrackRange;
  loading: boolean;
  follow: boolean;
  setFollow: (f: boolean) => void;
}) {
  const map = useMap();
  const focusRequest = useStore((s) => s.focusRequest);

  // Dragging the map means the operator wants to look around: stop following.
  useEffect(() => {
    if (!map) return;
    const l = map.addListener("dragstart", () => setFollow(false));
    return () => l.remove();
  }, [map, setFollow]);

  // Fit the trail once per range after it loads.
  const fitted = useRef<string>("");
  useEffect(() => {
    if (!map || loading || fitted.current === `${device.id}|${range}`) return;
    fitted.current = `${device.id}|${range}`;
    const pts = points(device, positions);
    if (pts.length === 0) return;
    if (pts.length < 3) {
      panToVisible(map, pts[pts.length - 1], 16);
      return;
    }
    fitPoints(map, pts);
  }, [map, loading, range, device, positions, follow]);

  // Follow mode: keep the device centred as it moves. Only react to actual movement (or to
  // Follow being switched on), so the initial fit of the whole trail isn't immediately undone.
  const lastFollowed = useRef<string | null>(null);
  useEffect(() => {
    if (!map || device.lat === null || device.lon === null) return;
    const key = `${device.lat},${device.lon}`;
    const moved = lastFollowed.current !== null && lastFollowed.current !== key;
    lastFollowed.current = key;
    if (follow && moved) panToVisible(map, { lat: device.lat, lng: device.lon });
  }, [map, follow, device.lat, device.lon]);
  const prevFollow = useRef(follow);
  useEffect(() => {
    if (map && follow && !prevFollow.current && device.lat !== null && device.lon !== null)
      panToVisible(map, { lat: device.lat, lng: device.lon });
    prevFollow.current = follow;
  }, [map, follow, device.lat, device.lon]);

  const handled = useRef(0);
  useEffect(() => {
    if (!map || !focusRequest || focusRequest.deviceId !== device.id || handled.current === focusRequest.at) return;
    handled.current = focusRequest.at;
    const lat = focusRequest.lat ?? device.lat;
    const lon = focusRequest.lon ?? device.lon;
    if (lat === null || lon === null) return;
    panToVisible(map, { lat, lng: lon }, Math.max(map.getZoom() ?? 16, 16));
  }, [map, focusRequest, device]);

  return null;
}

function DeviceControls({ device, follow, setFollow }: { device: DeviceView; follow: boolean; setFollow: (f: boolean) => void }) {
  const map = useMap();
  const recenter = useCallback(() => {
    if (map && device.lat !== null && device.lon !== null) {
      panToVisible(map, { lat: device.lat, lng: device.lon }, 16);
    }
  }, [map, device.lat, device.lon]);
  const hasPos = device.lat !== null;
  return (
    <MapControls
      onRecenter={hasPos ? recenter : undefined}
      follow={follow}
      onToggleFollow={hasPos ? () => setFollow(!follow) : undefined}
      className="top-28 right-3 md:top-auto md:right-5 md:bottom-6"
    />
  );
}

function Overlay({
  device,
  range,
  setRange,
  loading,
  follow,
  setFollow,
  card,
  setCard,
}: {
  device: DeviceView;
  range: TrackRange;
  setRange: (r: TrackRange) => void;
  loading: boolean;
  follow: boolean;
  setFollow: (f: boolean) => void;
  card: "device" | EventView | null;
  setCard: (c: "device" | EventView | null) => void;
}) {
  const mapsAvailable = useMapsAvailable();
  const sos = useActiveSosByDevice().find((e) => e.deviceId === device.id);
  return (
    <>
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-col items-start gap-2 md:top-4 md:left-4">
        <div className="flex items-center gap-2 md:hidden">
          <Link
            href="/"
            aria-label="Back to live map"
            className="glass pointer-events-auto flex size-11 items-center justify-center rounded-full shadow-float ring-1 ring-black/5 dark:ring-white/10"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <ConnectionPill floating className="pointer-events-auto" />
        </div>
        <div className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto">
          <RangePills value={range} onChange={setRange} />
          {loading && (
            <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Loading trail" />
          )}
        </div>
      </div>

      {card && (
        <div className="pointer-events-none absolute inset-x-3 top-32 z-20 md:top-20 md:right-auto md:left-4 md:w-[360px]">
          {card === "device" ? (
            <DeviceInfoCard device={device} sos={sos} onClose={() => setCard(null)} showDetailsLink={false} />
          ) : (
            <AlertInfoCard event={card} deviceLabel={deviceName(device)} onClose={() => setCard(null)} />
          )}
        </div>
      )}

      {device.lat === null && (
        <MapGlassCard icon={SatelliteDish} title="Waiting for first GPS fix">
          {device.connection === "online"
            ? "The device is online and reporting; position will appear here automatically."
            : "This device hasn't reported a position yet. It will appear here automatically once it gets a fix."}
        </MapGlassCard>
      )}

      {mapsAvailable && <DeviceControls device={device} follow={follow} setFollow={setFollow} />}
    </>
  );
}

/** `events` = this device's events (REST history merged with live), newest first. */
export function DeviceMap({ device, events }: { device: DeviceView; events: EventView[] }) {
  const [range, setRange] = useState<TrackRange>("live");
  const [follow, setFollow] = useState(true);
  const [card, setCard] = useState<"device" | EventView | null>(null);
  const sos = useActiveSosByDevice().find((e) => e.deviceId === device.id);
  const { positions, loading } = useTrack(device.id, range);
  const minuteNow = useMinuteNow();

  const path = useMemo(() => smoothPath(points(device, positions)), [device, positions]);
  const pins = useMemo(() => {
    return alertPins(
      events.filter((e) => e.deviceId === device.id),
      rangeStart(range, minuteNow),
    );
  }, [events, device.id, range, minuteNow]);

  const overlay = (
    <Overlay
      device={device}
      range={range}
      setRange={setRange}
      loading={loading}
      follow={follow}
      setFollow={setFollow}
      card={card}
      setCard={setCard}
    />
  );

  return (
    <MapShell overlay={overlay}>
      <DeviceCamera device={device} positions={positions} range={range} loading={loading} follow={follow} setFollow={setFollow} />
      {path.length > 1 && <Polyline path={path} color={ACCENT} weight={4} />}
      {positions.length > 1 && <TrailStart position={{ lat: positions[0].lat, lng: positions[0].lon }} />}
      {pins.map((e) => (
        <AlertPin
          key={e.id}
          position={{ lat: e.lat!, lng: e.lon! }}
          kind={e.type === "sos" ? "sos" : "motion"}
          title={eventTitle(e)}
          selected={card !== null && card !== "device" && card.id === e.id}
          onClick={() => setCard(e)}
        />
      ))}
      {device.lat !== null && device.lon !== null && (
        <DeviceMarker
          position={{ lat: device.lat, lng: device.lon }}
          name={deviceName(device)}
          visual={deviceVisual(device, sos)}
          connection={device.connection}
          gps={device.gps}
          lastSeen={device.lastSeen}
          fixAt={device.fixTs ?? device.fixChangedAt}
          selected
          onClick={() => setCard(card === "device" ? null : "device")}
        />
      )}
    </MapShell>
  );
}

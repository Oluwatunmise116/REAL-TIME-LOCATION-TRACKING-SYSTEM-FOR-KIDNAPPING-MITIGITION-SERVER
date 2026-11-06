"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RadioTower, SatelliteDish } from "lucide-react";
import { deviceVisual } from "@/components/status/chips";
import { ConnectionPill } from "@/components/shell/connection-pill";
import { useActiveSosByDevice } from "@/components/shell/sos-banner";
import { deviceName, useStore } from "@/lib/client/store";
import { useMinuteNow } from "@/lib/client/use-now";
import { eventTitle } from "@/lib/domain/labels";
import type { DeviceView, EventView } from "@/lib/domain/types";
import { fitPoints, panToVisible } from "./camera";
import { AlertInfoCard, DeviceInfoCard } from "./info-card";
import { MapControls } from "./map-controls";
import { MapGlassCard, MapShell, useMapsAvailable } from "./map-shell";
import { AlertPin, alertPins, DeviceMarker } from "./markers";
import { Polyline, smoothPath } from "./polyline";
import { useTrack } from "./use-track";

const ACCENT = "#16A34A";
const ALERT_WINDOW_MS = 24 * 3_600_000;

type Fixed = DeviceView & { lat: number; lon: number };
const hasFix = (d: DeviceView): d is Fixed => d.lat !== null && d.lon !== null;

function fitTo(map: google.maps.Map, points: google.maps.LatLngLiteral[]) {
  fitPoints(map, points);
}

function FleetCamera({ fixed }: { fixed: Fixed[] }) {
  const map = useMap();
  const focusRequest = useStore((s) => s.focusRequest);
  const fittedKey = useRef<string>("");
  const key = fixed
    .map((d) => d.id)
    .sort()
    .join(",");

  // Auto-fit when the set of devices with a fix changes (not on every position update).
  useEffect(() => {
    if (!map || !key || fittedKey.current === key) return;
    fittedKey.current = key;
    fitTo(
      map,
      fixed.map((d) => ({ lat: d.lat, lng: d.lon })),
    );
  }, [map, key, fixed]);

  const handled = useRef(0);
  useEffect(() => {
    if (!map || !focusRequest || handled.current === focusRequest.at) return;
    const d = fixed.find((x) => x.id === focusRequest.deviceId);
    const pos =
      focusRequest.lat !== undefined && focusRequest.lon !== undefined
        ? { lat: focusRequest.lat, lng: focusRequest.lon }
        : d
          ? { lat: d.lat, lng: d.lon }
          : null;
    handled.current = focusRequest.at;
    if (!pos) return;
    panToVisible(map, pos, Math.max(map.getZoom() ?? 16, 16), "lower");
  }, [map, focusRequest, fixed]);

  return null;
}

function SelectedTrail({ deviceId }: { deviceId: string }) {
  const { positions } = useTrack(deviceId, "live");
  const path = useMemo(() => smoothPath(positions.map((p) => ({ lat: p.lat, lng: p.lon }))), [positions]);
  return path.length > 1 ? <Polyline path={path} color={ACCENT} weight={4} opacity={0.9} /> : null;
}

function FleetControls({ fixed }: { fixed: Fixed[] }) {
  const map = useMap();
  const recenter = useCallback(() => {
    if (map)
      fitTo(
        map,
        fixed.map((d) => ({ lat: d.lat, lng: d.lon })),
      );
  }, [map, fixed]);
  return <MapControls onRecenter={fixed.length ? recenter : undefined} className="top-16 right-3 md:top-auto md:right-5 md:bottom-6" />;
}

function FleetOverlay({
  fixed,
  all,
  alert,
  setAlert,
}: {
  fixed: Fixed[];
  all: DeviceView[];
  alert: EventView | null;
  setAlert: (e: EventView | null) => void;
}) {
  const mapsAvailable = useMapsAvailable();
  const ready = useStore((s) => s.ready);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const devices = useStore((s) => s.devices);
  const sos = useActiveSosByDevice();
  const selected = selectedId ? devices[selectedId] : undefined;

  const anyOnline = all.some((d) => d.connection === "online");

  return (
    <>
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-start justify-between gap-2 md:hidden">
        <ConnectionPill floating className="pointer-events-auto" />
      </div>

      <div className="pointer-events-none absolute inset-x-3 top-14 z-20 md:top-4 md:right-auto md:left-4 md:w-[360px]">
        {alert ? (
          <AlertInfoCard event={alert} deviceLabel={deviceName(devices[alert.deviceId], alert.deviceId)} onClose={() => setAlert(null)} />
        ) : selected ? (
          <DeviceInfoCard device={selected} sos={sos.find((e) => e.deviceId === selected.id)} onClose={() => select(null)} />
        ) : null}
      </div>

      {ready && all.length === 0 && (
        <MapGlassCard icon={RadioTower} title="No devices yet">
          Waiting for the first message on <span className="font-mono text-xs">devices/+/#</span>. Devices appear here automatically as soon
          as they connect.
        </MapGlassCard>
      )}
      {ready && all.length > 0 && fixed.length === 0 && !selected && (
        <MapGlassCard icon={SatelliteDish} title="Waiting for first GPS fix">
          {anyOnline
            ? "The device is online and reporting; position will appear here automatically."
            : "No device has reported a position yet. Positions appear here automatically once a device gets a fix."}
        </MapGlassCard>
      )}

      {mapsAvailable && <FleetControls fixed={fixed} />}
    </>
  );
}

export function FleetMap() {
  const devices = useStore((s) => s.devices);
  const events = useStore((s) => s.events);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const focus = useStore((s) => s.focus);
  const sos = useActiveSosByDevice();
  const [alert, setAlert] = useState<EventView | null>(null);
  const minuteNow = useMinuteNow();

  const all = useMemo(() => Object.values(devices), [devices]);
  const fixed = useMemo(() => all.filter(hasFix), [all]);
  const sosByDevice = useMemo(() => new Map(sos.map((e) => [e.deviceId, e])), [sos]);

  const pins = useMemo(() => {
    // events are newest first, which alertPins relies on to keep the newest press of an incident.
    return alertPins(events, minuteNow - ALERT_WINDOW_MS).slice(0, 150);
  }, [events, minuteNow]);

  const overlay = <FleetOverlay fixed={fixed} all={all} alert={alert} setAlert={setAlert} />;

  return (
    <MapShell overlay={overlay}>
      <FleetCamera fixed={fixed} />
      {selectedId && devices[selectedId] && hasFix(devices[selectedId]) && <SelectedTrail deviceId={selectedId} />}
      {pins.map((e) => (
        <AlertPin
          key={e.id}
          position={{ lat: e.lat!, lng: e.lon! }}
          kind={e.type === "sos" ? "sos" : "motion"}
          title={`${eventTitle(e)} · ${deviceName(devices[e.deviceId], e.deviceId)}`}
          selected={alert?.id === e.id}
          onClick={() => setAlert(e)}
        />
      ))}
      {fixed.map((d) => (
        <DeviceMarker
          key={d.id}
          position={{ lat: d.lat, lng: d.lon }}
          name={deviceName(d)}
          visual={deviceVisual(d, sosByDevice.get(d.id))}
          connection={d.connection}
          gps={d.gps}
          lastSeen={d.lastSeen}
          fixAt={d.fixTs ?? d.fixChangedAt}
          selected={d.id === selectedId}
          onClick={() => {
            setAlert(null);
            if (d.id === selectedId) select(null);
            else focus(d.id);
          }}
        />
      ))}
    </MapShell>
  );
}

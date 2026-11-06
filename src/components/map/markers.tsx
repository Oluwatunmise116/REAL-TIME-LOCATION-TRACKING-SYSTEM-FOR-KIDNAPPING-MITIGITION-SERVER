"use client";

import { AdvancedMarker } from "@vis.gl/react-google-maps";
import { Activity, Siren } from "lucide-react";
import { cn } from "@/lib/utils";
import { initials, relTime } from "@/lib/client/format";
import { useNow } from "@/lib/client/use-now";
import { connectionLabel } from "@/lib/domain/labels";
import type { Connection, EventView, GpsState } from "@/lib/domain/types";
import type { DeviceVisual } from "@/components/status/chips";

const MARKER_BG: Record<DeviceVisual["marker"], string> = {
  sos: "bg-danger",
  motion: "bg-warning",
  live: "bg-live",
  online: "bg-offline",
  idle: "bg-offline",
};

const CONN_DOT: Record<Connection, string> = { online: "bg-live", signal_lost: "bg-warning", offline: "bg-offline" };

interface MarkerTimes {
  connection: Connection;
  gps: GpsState;
  /** Last message of any kind from the device. */
  lastSeen: number | null;
  /** Time of the fix the marker sits on. */
  fixAt: number | null;
}

/**
 * The line under the name: "Offline · 5 min ago" (last time we heard from it) when not online, or
 * "Last GPS 3 min ago" when it's online but fixes have stopped. Nothing while online with a live fix.
 */
function markerNote({ connection, gps, lastSeen, fixAt }: MarkerTimes, now: number): { text: string; tone: string } | null {
  if (connection !== "online") {
    const ago = relTime(lastSeen, now);
    return {
      text: ago ? `${connectionLabel(connection)} · ${ago}` : connectionLabel(connection),
      tone: connection === "signal_lost" ? "text-amber-700" : "text-slate-500",
    };
  }
  if (gps === "live") return null;
  const ago = relTime(fixAt, now);
  return { text: ago ? `Last GPS ${ago}` : "No GPS fix", tone: "text-slate-500" };
}

function MarkerLabel({ name, times }: { name: string; times: MarkerTimes }) {
  const now = useNow();
  const note = markerNote(times, now);
  return (
    <span className="mt-1 flex max-w-[160px] flex-col items-center rounded-2xl bg-white px-2 py-0.5 leading-tight shadow-[0_2px_8px_rgb(15_23_42/0.18)]">
      <span className="max-w-full truncate text-[11px] font-semibold text-slate-900">{name}</span>
      {note && <span className={cn("tabular max-w-full truncate text-[10px] font-medium", note.tone)}>{note.text}</span>}
    </span>
  );
}

/**
 * Round avatar chip. Green + pulsing ring = online with a live fix; grey = offline or last-known
 * position; red pulsing = active SOS; amber = unusual motion. A small corner dot shows connection,
 * and the label under the name says when it was last online / last sent GPS.
 */
export function DeviceMarker({
  position,
  name,
  visual,
  connection,
  gps,
  lastSeen,
  fixAt,
  selected,
  onClick,
}: MarkerTimes & {
  position: google.maps.LatLngLiteral;
  name: string;
  visual: DeviceVisual;
  selected?: boolean;
  onClick?: () => void;
}) {
  const z = visual.marker === "sos" ? 1000 : visual.marker === "motion" ? 900 : selected ? 800 : 500;
  return (
    <AdvancedMarker
      position={position}
      onClick={onClick}
      zIndex={z}
      title={`${name} · ${visual.label}`}
      anchorLeft="-50%"
      anchorTop="-22px"
    >
      <div className="flex flex-col items-center">
        <div className="relative flex size-11 items-center justify-center">
          {visual.marker === "sos" && <span className="axm-sos-ring absolute inset-0 rounded-full bg-danger/50" aria-hidden />}
          {visual.marker === "live" && <span className="axm-pulse-ring absolute inset-0 rounded-full bg-live/45" aria-hidden />}
          <span
            className={cn(
              "relative flex size-11 items-center justify-center rounded-full border-[3px] border-white text-sm font-bold text-white shadow-[0_4px_14px_rgb(15_23_42/0.28)] transition-transform",
              MARKER_BG[visual.marker],
              selected && "scale-110 outline-[3px] outline-offset-1 outline-live outline-solid",
            )}
          >
            {visual.marker === "sos" ? <Siren className="size-5" aria-hidden /> : initials(name)}
            <span
              className={cn("absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-white", CONN_DOT[connection])}
              aria-hidden
            />
          </span>
        </div>
        <MarkerLabel name={name} times={{ connection, gps, lastSeen, fixAt }} />
      </div>
    </AdvancedMarker>
  );
}

/**
 * Alerts worth a pin: SOS and unusual-motion events with a position. Rapid SOS presses from one
 * device (one incident) collapse to the newest, so an incident shows one pin, not ten.
 */
export function alertPins(events: EventView[], from: number): EventView[] {
  const out: EventView[] = [];
  const lastSos = new Map<string, number>();
  for (const e of events) {
    if (e.lat === null || e.lon === null || e.ts < from) continue;
    if (e.type === "motion" && e.payload.state === "SUSPICIOUS") out.push(e);
    else if (e.type === "sos") {
      const newer = lastSos.get(e.deviceId);
      lastSos.set(e.deviceId, e.ts);
      if (newer === undefined || newer - e.ts > 120_000) out.push(e);
    }
  }
  return out;
}

/** Small pin for an SOS or motion alert that carried a position. */
export function AlertPin({
  position,
  kind,
  title,
  selected,
  onClick,
}: {
  position: google.maps.LatLngLiteral;
  kind: "sos" | "motion";
  title: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const Icon = kind === "sos" ? Siren : Activity;
  return (
    <AdvancedMarker
      position={position}
      onClick={onClick}
      zIndex={kind === "sos" ? 400 : 300}
      title={title}
      anchorLeft="-50%"
      anchorTop="-100%"
    >
      <div className={cn("flex flex-col items-center transition-transform", selected && "scale-125")}>
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-full border-2 border-white text-white shadow-[0_3px_10px_rgb(15_23_42/0.3)]",
            kind === "sos" ? "bg-danger" : "bg-warning",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </span>
        <span className={cn("-mt-0.5 h-2 w-0.5 rounded-b", kind === "sos" ? "bg-danger" : "bg-warning")} aria-hidden />
      </div>
    </AdvancedMarker>
  );
}

/** Hollow start-of-trail dot. */
export function TrailStart({ position }: { position: google.maps.LatLngLiteral }) {
  return (
    <AdvancedMarker position={position} zIndex={200} anchorLeft="-50%" anchorTop="-50%" title="Start of trail">
      <span className="block size-3.5 rounded-full border-[3px] border-live bg-white shadow" />
    </AdvancedMarker>
  );
}

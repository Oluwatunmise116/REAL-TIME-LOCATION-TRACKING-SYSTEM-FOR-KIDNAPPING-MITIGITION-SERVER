"use client";

import {
  Activity,
  CircleSlash,
  LocateFixed,
  LocateOff,
  MapPinned,
  Siren,
  TriangleAlert,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { connectionLabel, gpsLabel, motionHeadline, sosLevelLabel } from "@/lib/domain/labels";
import type { Connection, DeviceView, EventView, GpsState } from "@/lib/domain/types";

export type Tone = "live" | "warning" | "danger" | "offline" | "neutral";

const TONE: Record<Tone, { chip: string; dot: string }> = {
  live: { chip: "bg-live-tint text-live-fg", dot: "bg-live" },
  warning: { chip: "bg-warning-tint text-warning-fg", dot: "bg-warning" },
  danger: { chip: "bg-danger-tint text-danger-fg", dot: "bg-danger" },
  offline: { chip: "bg-offline-tint text-offline-fg", dot: "bg-offline" },
  neutral: { chip: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/60" },
};

export function toneDot(tone: Tone): string {
  return TONE[tone].dot;
}

export function Chip({
  tone,
  icon: Icon,
  label,
  pulse,
  className,
  title,
}: {
  tone: Tone;
  icon?: LucideIcon;
  label: string;
  pulse?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap",
        TONE[tone].chip,
        className,
      )}
    >
      <span className={cn("relative size-1.5 rounded-full", TONE[tone].dot)} aria-hidden>
        {pulse && <span className={cn("axm-pulse-ring absolute inset-0 rounded-full", TONE[tone].dot)} />}
      </span>
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {label}
    </span>
  );
}

export function connectionTone(c: Connection): Tone {
  return c === "online" ? "live" : c === "signal_lost" ? "warning" : "offline";
}

export function ConnectionChip({ connection, className }: { connection: Connection; className?: string }) {
  const icon = connection === "online" ? Wifi : connection === "signal_lost" ? TriangleAlert : WifiOff;
  return (
    <Chip
      tone={connectionTone(connection)}
      icon={icon}
      label={connectionLabel(connection)}
      pulse={connection === "online"}
      className={className}
    />
  );
}

export function SosChip({ level, className }: { level: string; className?: string }) {
  return <Chip tone="danger" icon={Siren} label={`SOS · ${sosLevelLabel(level)}`} className={cn("axm-blink", className)} />;
}

export function MotionChip({ state, indicator, className }: { state: string | null; indicator: string | null; className?: string }) {
  if (!state) return <Chip tone="neutral" icon={CircleSlash} label="No motion data" className={className} />;
  const tone: Tone = state === "SUSPICIOUS" || state === "CANDIDATE" ? "warning" : "neutral";
  return (
    <Chip
      tone={tone}
      icon={Activity}
      label={motionHeadline(state, indicator)}
      className={cn(state === "CANDIDATE" && "bg-transparent ring-1 ring-warning/50 ring-inset", className)}
    />
  );
}

export function gpsIcon(g: GpsState): LucideIcon {
  return g === "live" ? LocateFixed : g === "last_known" ? MapPinned : LocateOff;
}

/** Icon for a GPS state, as a stable component (not chosen during render). */
export function GpsStateIcon({ gps, className }: { gps: GpsState; className?: string }) {
  if (gps === "live") return <LocateFixed className={className} aria-hidden />;
  if (gps === "last_known") return <MapPinned className={className} aria-hidden />;
  return <LocateOff className={className} aria-hidden />;
}

export function GpsChip({ gps, className }: { gps: GpsState; className?: string }) {
  return <Chip tone={gps === "live" ? "live" : "neutral"} icon={gpsIcon(gps)} label={gpsLabel(gps)} className={className} />;
}

/** The single most important status for a device (used by the list card + marker). */
export interface DeviceVisual {
  tone: Tone;
  label: string;
  /** Marker state for the map. */
  marker: "sos" | "motion" | "live" | "online" | "idle";
}

export function deviceVisual(d: DeviceView, sos: EventView | undefined): DeviceVisual {
  if (sos && sos.type === "sos") return { tone: "danger", label: `SOS · ${sosLevelLabel(sos.payload.level)}`, marker: "sos" };
  if (d.motionState === "SUSPICIOUS") return { tone: "warning", label: motionHeadline(d.motionState, d.motionIndicator), marker: "motion" };
  if (d.connection === "online") return { tone: "live", label: "Online", marker: d.gps === "live" ? "live" : "online" };
  return { tone: connectionTone(d.connection), label: connectionLabel(d.connection), marker: "idle" };
}

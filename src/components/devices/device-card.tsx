"use client";

import Link from "next/link";
import { ChevronRight, Siren } from "lucide-react";
import { Chip, GpsStateIcon, MotionChip, deviceVisual, toneDot } from "@/components/status/chips";
import { cn } from "@/lib/utils";
import { initials, relTime } from "@/lib/client/format";
import { deviceName } from "@/lib/client/store";
import { useNow } from "@/lib/client/use-now";
import { connectionLabel, gpsLabel } from "@/lib/domain/labels";
import type { DeviceView, EventView } from "@/lib/domain/types";
import { Skeleton } from "@/components/ui/skeleton";

export function LinkQualityBar({ value, className }: { value: number | null; className?: string }) {
  const tone = value === null ? "bg-offline" : value >= 80 ? "bg-live" : value >= 50 ? "bg-warning" : "bg-danger";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label="Link quality, last 60 seconds"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
        aria-valuetext={value === null ? "not enough data" : `${value} percent`}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-500", tone)} style={{ width: `${value ?? 0}%` }} />
      </div>
      <span className="tabular w-9 text-right text-xs font-semibold">{value === null ? "—" : `${value}%`}</span>
    </div>
  );
}

export function DeviceAvatar({ device, sos, size = "md" }: { device: DeviceView; sos?: EventView; size?: "md" | "lg" }) {
  const v = deviceVisual(device, sos);
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full font-bold text-white",
        size === "lg" ? "size-12 text-base" : "size-10 text-sm",
        toneDot(v.tone === "neutral" ? "offline" : v.tone),
      )}
      aria-hidden
    >
      {v.marker === "sos" ? <Siren className="relative size-5" /> : initials(deviceName(device))}
      {(v.marker === "live" || v.marker === "sos") && (
        <span
          className={cn(
            "absolute inset-0 rounded-full",
            v.marker === "sos" ? "axm-sos-ring-sm bg-danger/40" : "axm-pulse-ring-sm bg-live/40",
          )}
        />
      )}
    </span>
  );
}

export function DeviceCard({
  device,
  sos,
  selected,
  onSelect,
}: {
  device: DeviceView;
  sos?: EventView;
  selected?: boolean;
  onSelect: () => void;
}) {
  const now = useNow();
  const v = deviceVisual(device, sos);
  const name = deviceName(device);
  return (
    <div
      className={cn(
        "group relative rounded-2xl bg-card p-3.5 shadow-soft ring-1 ring-black/[0.04] transition-shadow hover:shadow-float dark:ring-white/[0.06]",
        selected && "ring-2 ring-live dark:ring-live",
        v.marker === "sos" && !selected && "ring-2 ring-danger/60",
      )}
    >
      {/* Stretched button: the whole card selects; the details link sits above it. */}
      <button
        type="button"
        data-device-card
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${name}, ${v.label}, ${connectionLabel(device.connection)}, ${gpsLabel(device.gps)}`}
        className="absolute inset-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <div className="pointer-events-none relative flex items-start gap-3">
        <DeviceAvatar device={device} sos={sos} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{name}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{device.id}</p>
            </div>
            <Chip tone={v.tone} label={v.label} pulse={v.marker === "live"} className={cn(v.marker === "sos" && "axm-blink")} />
          </div>
          <div className="mt-2.5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="tabular">Seen {relTime(device.lastSeen, now) || "never"}</span>
            <span className="inline-flex items-center gap-1">
              <GpsStateIcon gps={device.gps} className={cn("size-3.5", device.gps === "live" && "text-live-fg")} />
              {gpsLabel(device.gps)}
            </span>
          </div>
          <LinkQualityBar value={device.linkQuality} className="mt-2" />
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <MotionChip state={device.motionState} indicator={device.motionIndicator} />
            <Link
              href={`/devices/${encodeURIComponent(device.id)}`}
              className="pointer-events-auto relative z-10 -my-2 -mr-2 inline-flex h-11 items-center gap-0.5 rounded-xl px-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Details <ChevronRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DeviceCardSkeleton() {
  return (
    <div className="rounded-2xl bg-card p-3.5 shadow-soft">
      <div className="flex gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-1.5 w-full" />
          <Skeleton className="h-6 w-28 rounded-full" />
        </div>
      </div>
    </div>
  );
}

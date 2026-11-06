"use client";

import Link from "next/link";
import { ArrowUpRight, ChevronRight, Copy, LocateOff, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConnectionChip, GpsChip, SosChip, MotionChip } from "@/components/status/chips";
import { cn } from "@/lib/utils";
import { clockTime, formatAge, formatCoord, mapsLink, relTime, utcString } from "@/lib/client/format";
import { deviceName } from "@/lib/client/store";
import { useNow } from "@/lib/client/use-now";
import { eventDetail, eventTitle } from "@/lib/domain/labels";
import type { DeviceView, EventView } from "@/lib/domain/types";
import { useMapsAvailable } from "./map-shell";
import { useReverseGeocode } from "./use-geocode";

function Address({ lat, lon }: { lat: number; lon: number }) {
  const r = useReverseGeocode(lat, lon);
  if (r.status === "loading")
    return <span className="inline-block h-4 w-40 animate-pulse rounded bg-muted" aria-label="Looking up address" />;
  if (r.status === "ok") return <span>{r.address}</span>;
  return <span className="text-muted-foreground">{r.status === "error" ? "Address lookup unavailable" : "No address found"}</span>;
}

export function CoordRow({ lat, lon, label = "Position", approxNote }: { lat: number; lon: number; label?: string; approxNote?: string }) {
  const maps = useMapsAvailable();
  const text = formatCoord(lat, lon);
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <MapPin className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
          <p className="tabular font-mono text-[13px] font-semibold">{text}</p>
          {approxNote && <p className="text-xs text-muted-foreground">{approxNote}</p>}
          {maps && (
            <p className="mt-1 text-xs leading-snug">
              <Address lat={lat} lon={lon} />
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-xl"
          aria-label="Copy coordinates"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(
              () => toast.success("Coordinates copied", { description: text, duration: 2_000 }),
              () => toast.error("Couldn't copy to clipboard"),
            );
          }}
        >
          <Copy />
        </Button>
      </div>
      <a
        href={mapsLink(lat, lon)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-9 items-center gap-1.5 rounded-xl px-1 text-sm font-semibold text-live-fg hover:underline"
      >
        Open in Google Maps <ArrowUpRight className="size-4" aria-hidden />
      </a>
    </div>
  );
}

function CardFrame({
  children,
  onClose,
  className,
  label,
}: {
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
  label: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "pointer-events-auto relative w-full rounded-3xl bg-card p-4 shadow-float ring-1 ring-black/5 sm:p-5 dark:ring-white/10",
        className,
      )}
    >
      {onClose && (
        <Button variant="ghost" size="icon" className="absolute top-3 right-3 size-9 rounded-full" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      )}
      {children}
    </section>
  );
}

export function DeviceInfoCard({
  device,
  sos,
  onClose,
  showDetailsLink = true,
  className,
}: {
  device: DeviceView;
  sos?: EventView;
  onClose?: () => void;
  showDetailsLink?: boolean;
  className?: string;
}) {
  const now = useNow();
  const name = deviceName(device);
  const hasPos = device.lat !== null && device.lon !== null;
  const fixAt = device.fixTs ?? device.fixChangedAt;
  return (
    <CardFrame onClose={onClose} className={className} label={`${name} details`}>
      <div className="pr-10">
        <h2 className="truncate text-base font-bold">{name}</h2>
        {device.displayName && <p className="truncate font-mono text-xs text-muted-foreground">{device.id}</p>}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {sos?.type === "sos" && <SosChip level={sos.payload.level} />}
        <ConnectionChip connection={device.connection} />
        <GpsChip gps={device.gps} />
        {device.motionState === "SUSPICIOUS" && <MotionChip state={device.motionState} indicator={device.motionIndicator} />}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Last seen <span className="font-semibold text-foreground">{relTime(device.lastSeen, now) || "never"}</span>
      </p>
      <div className="mt-4 border-t pt-4">
        {hasPos ? (
          <CoordRow
            lat={device.lat!}
            lon={device.lon!}
            label={device.gps === "live" ? "Last known position · live" : "Last known position"}
            approxNote={fixAt ? `Reported ${relTime(fixAt, now)} · ${clockTime(fixAt, now)}` : undefined}
          />
        ) : (
          <div className="flex items-start gap-2.5 text-sm">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <LocateOff className="size-4" aria-hidden />
            </span>
            <p className="text-muted-foreground">
              <span className="block font-semibold text-foreground">Waiting for first GPS fix</span>
              The device is {device.connection === "online" ? "online and reporting" : "not currently reporting"}; its position will appear
              automatically.
            </p>
          </div>
        )}
      </div>
      {showDetailsLink && (
        <Button asChild variant="secondary" className="mt-4 h-11 w-full rounded-xl font-semibold">
          <Link href={`/devices/${encodeURIComponent(device.id)}`}>
            Device details <ChevronRight />
          </Link>
        </Button>
      )}
    </CardFrame>
  );
}

export function AlertInfoCard({
  event,
  deviceLabel,
  onClose,
  className,
}: {
  event: EventView;
  deviceLabel: string;
  onClose?: () => void;
  className?: string;
}) {
  const now = useNow();
  const detail = eventDetail(event);
  return (
    <CardFrame onClose={onClose} className={className} label={`${eventTitle(event)} details`}>
      <p className={cn("text-[11px] font-bold tracking-wide uppercase", event.type === "sos" ? "text-danger-fg" : "text-warning-fg")}>
        {event.type === "sos" ? "SOS alert" : "Motion alert"}
      </p>
      <h2 className="mt-0.5 pr-10 text-base font-bold">{eventTitle(event)}</h2>
      <p className="text-sm text-muted-foreground">{deviceLabel}</p>
      {detail && <p className="mt-2 text-sm">{detail}</p>}
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Time</dt>
          <dd className="font-semibold" title={utcString(event.ts)}>
            {event.tsApprox && "≈ "}
            {clockTime(event.ts, now)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Position age</dt>
          <dd className="font-semibold">{event.ageSec !== null ? `${formatAge(event.ageSec)}` : "No position"}</dd>
        </div>
      </dl>
      {event.lat !== null && event.lon !== null && (
        <div className="mt-4 border-t pt-4">
          <CoordRow lat={event.lat} lon={event.lon} label="Alert position" />
        </div>
      )}
    </CardFrame>
  );
}

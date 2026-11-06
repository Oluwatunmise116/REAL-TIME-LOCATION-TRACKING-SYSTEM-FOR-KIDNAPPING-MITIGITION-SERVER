"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowLeft, Check, Clock, Hash, Loader2, Pencil, SignalHigh, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DeviceMap } from "@/components/map/device-map";
import { BottomSheet, type Snap } from "@/components/shell/bottom-sheet";
import { useActiveSosByDevice } from "@/components/shell/sos-banner";
import { ConnectionChip, gpsIcon, SosChip } from "@/components/status/chips";
import { formatNumber, formatUptime, liveUptime, relTime } from "@/lib/client/format";
import { deviceName, useStore } from "@/lib/client/store";
import { useIsPhone, useMedia } from "@/lib/client/use-media";
import { useNow } from "@/lib/client/use-now";
import { gpsLabel, motionHeadline, motionStateLabel } from "@/lib/domain/labels";
import type { DeviceView, EventView } from "@/lib/domain/types";
import { DeviceAvatar } from "./device-card";
import { EventTimeline } from "./event-timeline";
import { LinkQualityChart } from "./link-quality-chart";
import { StatTile } from "./stat-tile";
import { useDeviceEvents } from "./use-device-events";

function EditableName({ device }: { device: DeviceView }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(device.displayName ?? "");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const upsertDevice = useStore((s) => s.upsertDevice);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/devices/${encodeURIComponent(device.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: value.trim() || null }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      upsertDevice(((await r.json()) as { device: DeviceView }).device);
      setEditing(false);
    } catch (e) {
      toast.error("Rename failed", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <h1 className="truncate text-lg font-bold tracking-tight md:text-xl">{deviceName(device)}</h1>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-full"
          aria-label="Rename device"
          onClick={() => {
            setValue(device.displayName ?? "");
            setEditing(true);
          }}
        >
          <Pencil className="size-4" />
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex min-w-0 items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        maxLength={60}
        placeholder={device.id}
        aria-label="Display name"
        className="h-10 w-full max-w-[260px] rounded-xl text-base font-semibold"
      />
      <Button type="submit" size="icon" className="size-10 shrink-0 rounded-xl" aria-label="Save name" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Check />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-10 shrink-0 rounded-xl"
        aria-label="Cancel"
        onClick={() => setEditing(false)}
      >
        <X />
      </Button>
    </form>
  );
}

function Header({ device, sos, compact }: { device: DeviceView; sos?: EventView; compact?: boolean }) {
  const now = useNow();
  const up = liveUptime(device.up, device.lastHeartbeatAt, now, device.connection === "online");
  return (
    <div className="flex items-start gap-3">
      {!compact && (
        <Button asChild variant="ghost" size="icon" className="mt-0.5 size-10 shrink-0 rounded-full bg-card shadow-soft">
          <Link href="/" aria-label="Back to live map">
            <ArrowLeft />
          </Link>
        </Button>
      )}
      <DeviceAvatar device={device} sos={sos} size="lg" />
      <div className="min-w-0 flex-1">
        <EditableName device={device} />
        <p className="truncate font-mono text-xs text-muted-foreground">{device.id}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {sos?.type === "sos" && <SosChip level={sos.payload.level} />}
          <ConnectionChip connection={device.connection} />
          <span className="tabular text-xs text-muted-foreground">
            Last seen <span className="font-semibold text-foreground">{relTime(device.lastSeen, now) || "never"}</span>
            {up !== null && (
              <>
                {" "}
                · up <span className="font-semibold text-foreground">{formatUptime(up)}</span>
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function Tiles({ device }: { device: DeviceView }) {
  const now = useNow();
  const up = liveUptime(device.up, device.lastHeartbeatAt, now, device.connection === "online");
  const fixAt = device.fixTs ?? device.fixChangedAt;
  const GpsIcon = gpsIcon(device.gps);
  const motionTone = device.motionState === "SUSPICIOUS" || device.motionState === "CANDIDATE" ? "warning" : "neutral";
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 2xl:grid-cols-5">
      <StatTile
        label="Uptime"
        icon={Clock}
        tone="neutral"
        value={formatUptime(up)}
        sub={device.up !== null ? `${formatNumber(up ?? 0)} s since boot` : "No heartbeat yet"}
      />
      <StatTile
        label="Heartbeat seq"
        icon={Hash}
        tone="neutral"
        value={device.seq !== null ? formatNumber(device.seq) : "—"}
        sub={device.lastHeartbeatAt ? `${relTime(device.lastHeartbeatAt, now)}` : "—"}
      />
      <StatTile
        label="Link quality (60 s)"
        icon={SignalHigh}
        tone={device.linkQuality === null ? "neutral" : device.linkQuality >= 80 ? "live" : "warning"}
        value={device.linkQuality ?? "—"}
        unit={device.linkQuality !== null ? "%" : undefined}
        sub={device.linkQuality !== null ? `${Math.round((device.linkQuality / 100) * 30)} of 30 heartbeats` : "Collecting…"}
      />
      <StatTile
        label="GPS"
        icon={GpsIcon}
        tone={device.gps === "live" ? "live" : "neutral"}
        value={<span className="text-base">{gpsLabel(device.gps)}</span>}
        sub={device.lat === null ? "Waiting for first fix" : fixAt ? `Position reported ${relTime(fixAt, now)}` : "Last known position"}
      />
      <StatTile
        label="Motion"
        icon={Activity}
        tone={motionTone}
        value={<span className="text-base">{motionHeadline(device.motionState, device.motionIndicator)}</span>}
        sub={device.motionAt ? `${motionStateLabel(device.motionState)} · ${relTime(device.motionAt, now)}` : "No motion data"}
        className="col-span-2 2xl:col-span-1"
      />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 p-4 md:p-6" aria-busy="true" aria-label="Loading device">
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="h-[360px] w-full rounded-3xl" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 2xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

export function DeviceDetail({ id }: { id: string }) {
  const device = useStore((s) => s.devices[id]);
  const ready = useStore((s) => s.ready);
  const focus = useStore((s) => s.focus);
  const sos = useActiveSosByDevice().find((e) => e.deviceId === id);
  const isPhone = useIsPhone();
  const isWide = useMedia("(min-width: 1280px)", true);
  const [snap, setSnap] = useState<Snap>("half");
  const timeline = useDeviceEvents(id);

  if (!ready) return <DetailSkeleton />;
  if (!device) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm rounded-3xl bg-card p-6 text-center shadow-soft">
          <h1 className="text-base font-bold">Device not found</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            No messages have been received from <span className="font-mono">{id}</span>.
          </p>
          <Button asChild className="mt-4 rounded-xl">
            <Link href="/">Back to live map</Link>
          </Button>
        </div>
      </div>
    );
  }

  const onFocusPosition = (e: EventView) => {
    if (e.lat !== null && e.lon !== null) {
      focus(id, { lat: e.lat, lon: e.lon });
      if (isPhone) setSnap("peek");
    }
  };
  const timelineEl = (
    <EventTimeline
      events={timeline.events}
      loading={timeline.loading}
      hasMore={timeline.hasMore}
      loadingMore={timeline.loadingMore}
      onLoadMore={() => void timeline.loadMore()}
      onFocusPosition={onFocusPosition}
    />
  );
  const map = <DeviceMap device={device} events={timeline.events} />;

  if (isPhone) {
    return (
      <div className="relative h-full">
        {map}
        <BottomSheet
          snap={snap}
          onSnapChange={setSnap}
          label={`${deviceName(device)} details`}
          header={
            <div className="px-4 pb-3">
              <Header device={device} sos={sos} compact />
            </div>
          }
        >
          <div className="space-y-4">
            <Tiles device={device} />
            <LinkQualityChart deviceId={id} />
            {timelineEl}
          </div>
        </BottomSheet>
      </div>
    );
  }

  return (
    <div className="scrollbar-thin h-full overflow-y-auto xl:flex xl:flex-col xl:overflow-hidden">
      <div className="shrink-0 px-4 pt-4 md:px-6 md:pt-5">
        <Header device={device} sos={sos} />
      </div>
      <div className="gap-5 p-4 md:p-6 xl:grid xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="scrollbar-thin space-y-4 xl:min-h-0 xl:overflow-y-auto xl:pr-1">
          <div className="h-[420px] overflow-hidden rounded-3xl shadow-soft ring-1 ring-black/[0.04] xl:h-[max(420px,52vh)] dark:ring-white/[0.06]">
            {map}
          </div>
          <Tiles device={device} />
          <LinkQualityChart deviceId={id} />
          {!isWide && timelineEl}
        </div>
        {isWide && <div className="scrollbar-thin min-h-0 overflow-y-auto">{timelineEl}</div>}
      </div>
    </div>
  );
}

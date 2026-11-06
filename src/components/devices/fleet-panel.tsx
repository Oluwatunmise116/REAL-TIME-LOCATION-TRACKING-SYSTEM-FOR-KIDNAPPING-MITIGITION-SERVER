"use client";

import { useMemo, useState } from "react";
import { Activity, Radio, Search, SignalHigh, Siren } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useActiveSosByDevice } from "@/components/shell/sos-banner";
import { cn } from "@/lib/utils";
import { deviceName, sortDevices, useStore } from "@/lib/client/store";
import type { DeviceView } from "@/lib/domain/types";
import { DeviceCard, DeviceCardSkeleton } from "./device-card";
import { StatTile } from "./stat-tile";

export type DeviceFilter = "all" | "online" | "alerts" | "offline";

export function KpiTiles({ className }: { className?: string }) {
  const ready = useStore((s) => s.ready);
  const devices = useStore((s) => s.devices);
  const stats = useStore((s) => s.stats);
  const sos = useActiveSosByDevice();
  const list = Object.values(devices);
  const online = list.filter((d) => d.connection === "online").length;
  const lq = list.map((d) => d.linkQuality).filter((v): v is number => v !== null && v !== undefined);
  const onlineLq = list.filter((d) => d.connection !== "offline" && d.linkQuality !== null).map((d) => d.linkQuality as number);
  const avgSource = onlineLq.length ? onlineLq : lq;
  const avg = avgSource.length ? Math.round(avgSource.reduce((a, b) => a + b, 0) / avgSource.length) : null;
  return (
    <div className={cn("grid grid-cols-2 gap-2.5", className)}>
      <StatTile label="Devices online" icon={Radio} tone="live" loading={!ready} value={online} unit={`/ ${list.length}`} />
      <StatTile label="Active SOS" icon={Siren} tone="danger" loading={!ready} value={sos.length} emphasis={sos.length > 0} />
      <StatTile label="Motion alerts (24h)" icon={Activity} tone="warning" loading={!ready} value={stats.motionAlerts24h} />
      <StatTile
        label="Avg link quality"
        icon={SignalHigh}
        tone="neutral"
        loading={!ready}
        value={avg ?? "—"}
        unit={avg !== null ? "%" : undefined}
      />
    </div>
  );
}

export function matchesFilter(d: DeviceView, f: DeviceFilter, sosIds: Set<string>): boolean {
  switch (f) {
    case "all":
      return true;
    case "online":
      return d.connection === "online";
    case "alerts":
      return sosIds.has(d.id) || d.motionState === "SUSPICIOUS";
    case "offline":
      return d.connection !== "online";
  }
}

export function useFilteredDevices(query: string, filter: DeviceFilter) {
  const devices = useStore((s) => s.devices);
  const sos = useActiveSosByDevice();
  return useMemo(() => {
    const sosIds = new Set(sos.map((e) => e.deviceId));
    const q = query.trim().toLowerCase();
    const all = sortDevices(Object.values(devices), sosIds);
    const counts: Record<DeviceFilter, number> = { all: 0, online: 0, alerts: 0, offline: 0 };
    for (const d of all) for (const f of Object.keys(counts) as DeviceFilter[]) if (matchesFilter(d, f, sosIds)) counts[f]++;
    const visible = all.filter(
      (d) => matchesFilter(d, filter, sosIds) && (!q || deviceName(d).toLowerCase().includes(q) || d.id.toLowerCase().includes(q)),
    );
    return { visible, counts, total: all.length, sosByDevice: new Map(sos.map((e) => [e.deviceId, e])) };
  }, [devices, sos, query, filter]);
}

export function SearchAndFilter({
  query,
  setQuery,
  filter,
  setFilter,
  counts,
}: {
  query: string;
  setQuery: (q: string) => void;
  filter: DeviceFilter;
  setFilter: (f: DeviceFilter) => void;
  counts: Record<DeviceFilter, number>;
}) {
  const labels: Record<DeviceFilter, string> = { all: "All", online: "Online", alerts: "Alerts", offline: "Offline" };
  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or ID"
          aria-label="Search devices"
          className="h-11 rounded-full border-0 bg-card pl-10 shadow-soft ring-1 ring-black/[0.04] dark:ring-white/[0.06]"
        />
      </div>
      <ToggleGroup
        type="single"
        value={filter}
        onValueChange={(v) => v && setFilter(v as DeviceFilter)}
        aria-label="Filter devices"
        className="w-full justify-start gap-1.5"
      >
        {(Object.keys(labels) as DeviceFilter[]).map((f) => (
          <ToggleGroupItem
            key={f}
            value={f}
            className="h-9 flex-1 rounded-full bg-card px-3 text-xs font-semibold shadow-soft ring-1 ring-black/[0.04] data-[state=on]:bg-foreground data-[state=on]:text-background dark:ring-white/[0.06]"
          >
            {labels[f]}
            <span className="tabular ml-1 opacity-60">{counts[f]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/** Arrow-key navigation between device cards. */
export function onListKeyDown(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const cards = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-device-card]")];
  const i = cards.indexOf(document.activeElement as HTMLButtonElement);
  if (i === -1) return;
  e.preventDefault();
  cards[Math.max(0, Math.min(cards.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
}

export function DeviceList({ query, filter, onSelected }: { query: string; filter: DeviceFilter; onSelected?: (id: string) => void }) {
  const ready = useStore((s) => s.ready);
  const selectedId = useStore((s) => s.selectedId);
  const focus = useStore((s) => s.focus);
  const select = useStore((s) => s.select);
  const { visible, total, sosByDevice } = useFilteredDevices(query, filter);

  if (!ready) {
    return (
      <div className="space-y-2.5" aria-busy="true" aria-label="Loading devices">
        <DeviceCardSkeleton />
        <DeviceCardSkeleton />
        <DeviceCardSkeleton />
      </div>
    );
  }
  if (total === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/50 p-6 text-center">
        <p className="text-sm font-bold">No devices yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Trackers appear automatically when they publish to <span className="font-mono text-xs">devices/&lt;id&gt;/…</span>. Run{" "}
          <span className="font-mono text-xs">npm run simulate</span> to try it without hardware.
        </p>
      </div>
    );
  }
  if (visible.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/50 p-6 text-center">
        <p className="text-sm font-bold">No matching devices</p>
        <p className="mt-1 text-sm text-muted-foreground">Try another search or filter.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2.5" aria-label="Devices" onKeyDown={onListKeyDown}>
      {visible.map((d) => (
        <li key={d.id}>
          <DeviceCard
            device={d}
            sos={sosByDevice.get(d.id)}
            selected={d.id === selectedId}
            onSelect={() => {
              if (d.id === selectedId) select(null);
              else {
                focus(d.id);
                onSelected?.(d.id);
              }
            }}
          />
        </li>
      ))}
    </ul>
  );
}

/** KPIs + search + filters + device list (desktop side panel and phone bottom sheet). */
export function FleetPanel({ onSelected, className }: { onSelected?: (id: string) => void; className?: string }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DeviceFilter>("all");
  const { counts } = useFilteredDevices(query, filter);
  const broker = useStore((s) => s.broker?.state);
  return (
    <div className={cn("space-y-4", className)}>
      {broker && broker !== "connected" && (
        <p role="status" className="rounded-2xl bg-warning-tint px-3.5 py-2.5 text-xs font-medium text-warning-fg">
          {broker === "not_configured"
            ? "MQTT broker is not configured (MQTT_URL). Showing stored data only."
            : "Broker link is down. Device states are frozen at their last known values until it reconnects."}
        </p>
      )}
      <KpiTiles />
      <SearchAndFilter query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} counts={counts} />
      <DeviceList query={query} filter={filter} onSelected={onSelected} />
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Download, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { acknowledge } from "@/components/providers/live-provider";
import { Chip } from "@/components/status/chips";
import { cn } from "@/lib/utils";
import { clockTime, formatAge, formatShortCoord, mapsLink, utcString } from "@/lib/client/format";
import { deviceName, useStore } from "@/lib/client/store";
import { useMinuteNow, useNow } from "@/lib/client/use-now";
import { eventTitle, isAckable, motionIndicatorLabel, motionStateLabel, sosLevelLabel } from "@/lib/domain/labels";
import type { EventView } from "@/lib/domain/types";

type TypeFilter = "all" | "sos" | "motion";
type Period = "24h" | "7d" | "30d" | "all";
const PERIOD_MS: Record<Period, number | null> = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, all: null };
const PAGE = 25;

function levelText(e: EventView): string {
  if (e.type === "sos") return sosLevelLabel(e.payload.level);
  if (e.type === "motion") return motionIndicatorLabel(e.payload.indicator) ?? motionStateLabel(e.payload.state);
  return "—";
}

function AckCell({ e }: { e: EventView }) {
  const now = useNow();
  const [busy, setBusy] = useState(false);
  if (!isAckable(e)) return <span className="text-muted-foreground">—</span>;
  if (e.acknowledgedAt !== null) {
    return (
      <span className="text-xs">
        <span className="font-semibold">{e.acknowledgedBy ?? "admin"}</span>
        <span className="block text-muted-foreground" title={utcString(e.acknowledgedAt)}>
          {clockTime(e.acknowledgedAt, now)}
        </span>
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant={e.type === "sos" ? "default" : "secondary"}
      disabled={busy}
      className={cn("h-9 rounded-full px-3 font-semibold", e.type === "sos" && "bg-danger text-white hover:bg-danger/90")}
      onClick={async () => {
        setBusy(true);
        // An SOS incident is several presses; acknowledging one closes the earlier ones too.
        await acknowledge(e, e.type === "sos");
        setBusy(false);
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Check />} Acknowledge
    </Button>
  );
}

function TypeChip({ e }: { e: EventView }) {
  return e.type === "sos" ? (
    <Chip tone="danger" label={eventTitle(e)} />
  ) : (
    <Chip
      tone="warning"
      label={
        e.type === "motion" && e.payload.state === "SUSPICIOUS"
          ? "Unusual motion"
          : motionStateLabel(e.type === "motion" ? e.payload.state : null)
      }
    />
  );
}

function Position({ e }: { e: EventView }) {
  if (e.lat === null || e.lon === null) return <span className="text-muted-foreground">No position</span>;
  return (
    <a
      href={mapsLink(e.lat, e.lon)}
      target="_blank"
      rel="noopener noreferrer"
      className="tabular inline-flex items-center gap-1 font-medium hover:underline"
    >
      <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
      {formatShortCoord(e.lat, e.lon)}
      <span className="font-normal text-muted-foreground">· {formatAge(e.ageSec)}</span>
    </a>
  );
}

export default function AlertsPage() {
  const now = useNow();
  const minuteNow = useMinuteNow();
  const devices = useStore((s) => s.devices);
  const storeEvents = useStore((s) => s.events);
  const [type, setType] = useState<TypeFilter>("all");
  const [period, setPeriod] = useState<Period>("7d");
  const [deviceId, setDeviceId] = useState<string>("all");
  const [transient, setTransient] = useState(false);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [result, setResult] = useState<{ key: string; events: EventView[]; next: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(() => {
    const q = new URLSearchParams();
    q.set("type", type === "all" ? "sos,motion" : type);
    const ms = PERIOD_MS[period];
    // Minute resolution keeps the query (and pagination cursors) stable while the clock ticks.
    if (ms && minuteNow) q.set("from", String(minuteNow - ms));
    if (deviceId !== "all") q.set("deviceId", deviceId);
    if (!transient) q.set("transient", "0");
    return q;
  }, [type, period, deviceId, transient, minuteNow]);

  const pageIndex = cursors.length - 1;
  const key = `${params}|${cursors[pageIndex] ?? ""}`;

  useEffect(() => {
    if (PERIOD_MS[period] && !params.has("from")) return; // clock not known yet (hydration)
    const ctrl = new AbortController();
    const q = new URLSearchParams(params);
    q.set("limit", String(PAGE));
    const cursor = cursors[cursors.length - 1];
    if (cursor) q.set("cursor", cursor);
    fetch(`/api/events?${q}`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as { events: EventView[]; nextCursor: string | null };
        setResult({ key: `${params}|${cursor ?? ""}`, events: body.events, next: body.nextCursor });
        setError(null);
      })
      .catch((e: unknown) => !ctrl.signal.aborted && setError(e instanceof Error ? e.message : "failed"));
    return () => ctrl.abort();
  }, [params, cursors, period]);

  const resetPaging = () => setCursors([null]);

  // Live: on page 1, fold in matching alerts that arrived over SSE, and keep acks current everywhere.
  const rows = useMemo(() => {
    if (!result) return [];
    const byId = new Map(storeEvents.map((e) => [e.id, e]));
    const merged = result.events.map((e) => byId.get(e.id) ?? e);
    if (pageIndex === 0) {
      const from = Number(params.get("from") ?? 0);
      const fresh = storeEvents.filter(
        (e) =>
          !result.events.some((r) => r.id === e.id) &&
          (type === "all" ? e.type === "sos" || e.type === "motion" : e.type === type) &&
          (deviceId === "all" || e.deviceId === deviceId) &&
          e.ts >= from &&
          (transient || e.type !== "motion" || e.payload.state === "SUSPICIOUS") &&
          (result.events.length === 0 || e.ts >= result.events[result.events.length - 1].ts),
      );
      merged.push(...fresh);
    }
    return merged.sort((a, b) => b.ts - a.ts || b.id - a.id);
  }, [result, storeEvents, pageIndex, params, type, deviceId, transient]);

  const loading = !result || result.key !== key;
  const deviceList = Object.values(devices).sort((a, b) => deviceName(a).localeCompare(deviceName(b)));

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-end gap-3 rounded-3xl bg-card p-3 shadow-soft ring-1 ring-black/[0.04] sm:p-4 dark:ring-white/[0.06]">
          <ToggleGroup
            type="single"
            value={type}
            onValueChange={(v) => {
              if (!v) return;
              setType(v as TypeFilter);
              resetPaging();
            }}
            aria-label="Alert type"
            className="gap-1 rounded-full bg-muted p-1"
          >
            {(["all", "sos", "motion"] as const).map((t) => (
              <ToggleGroupItem
                key={t}
                value={t}
                className="h-9 rounded-full px-4 text-xs font-semibold data-[state=on]:bg-card data-[state=on]:shadow-soft"
              >
                {t === "all" ? "All alerts" : t === "sos" ? "SOS" : "Motion"}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup
            type="single"
            value={period}
            onValueChange={(v) => {
              if (!v) return;
              setPeriod(v as Period);
              resetPaging();
            }}
            aria-label="Time range"
            className="gap-1 rounded-full bg-muted p-1"
          >
            {(["24h", "7d", "30d", "all"] as const).map((p) => (
              <ToggleGroupItem
                key={p}
                value={p}
                className="h-9 rounded-full px-3.5 text-xs font-semibold data-[state=on]:bg-card data-[state=on]:shadow-soft"
              >
                {p === "all" ? "All time" : p}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select
            value={deviceId}
            onValueChange={(v) => {
              setDeviceId(v);
              resetPaging();
            }}
          >
            <SelectTrigger className="w-full min-w-[180px] rounded-full px-4 data-[size=default]:h-11 sm:w-auto" aria-label="Device">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All devices</SelectItem>
              {deviceList.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {deviceName(d)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex h-11 items-center gap-2 px-1">
            <Switch
              id="alerts-transient"
              checked={transient}
              onCheckedChange={(v) => {
                setTransient(v);
                resetPaging();
              }}
            />
            <Label htmlFor="alerts-transient" className="text-xs text-muted-foreground">
              Include transient motion
            </Label>
          </div>
          <Button asChild variant="outline" className="ml-auto h-11 rounded-full px-4 font-semibold">
            <a href={`/api/events?${params}&format=csv`} download>
              <Download /> Export CSV
            </a>
          </Button>
        </div>

        {error && <p className="rounded-2xl bg-danger-tint px-4 py-3 text-sm text-danger-fg">Couldn&apos;t load alerts: {error}</p>}

        {/* Desktop / tablet: table */}
        <div className="hidden overflow-hidden rounded-3xl bg-card shadow-soft ring-1 ring-black/[0.04] md:block dark:ring-white/[0.06]">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Type</TableHead>
                <TableHead>Level / indicator</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Position</TableHead>
                <TableHead className="pr-5">Acknowledged</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? [0, 1, 2, 3, 4].map((i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6} className="px-5">
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : rows.map((e) => (
                    <TableRow key={e.id} className={cn(e.type === "sos" && e.acknowledgedAt === null && "bg-danger-tint/50")}>
                      <TableCell className="pl-5">
                        <TypeChip e={e} />
                      </TableCell>
                      <TableCell className="font-medium">{levelText(e)}</TableCell>
                      <TableCell>
                        <Link href={`/devices/${encodeURIComponent(e.deviceId)}`} className="font-semibold hover:underline">
                          {deviceName(devices[e.deviceId], e.deviceId)}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular whitespace-nowrap" title={utcString(e.ts)}>
                        {e.tsApprox && <span className="mr-1 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold">approx.</span>}
                        {clockTime(e.ts, now)}
                      </TableCell>
                      <TableCell>
                        <Position e={e} />
                      </TableCell>
                      <TableCell className="pr-5">
                        <AckCell e={e} />
                      </TableCell>
                    </TableRow>
                  ))}
              {!loading && rows.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                    No alerts in this range. SOS presses and unusual-motion events will be listed here.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Phone: stacked cards */}
        <ul className="space-y-2.5 md:hidden" aria-label="Alerts">
          {loading
            ? [0, 1, 2].map((i) => (
                <li key={i}>
                  <Skeleton className="h-32 rounded-2xl" />
                </li>
              ))
            : rows.map((e) => (
                <li
                  key={e.id}
                  className={cn(
                    "rounded-2xl bg-card p-4 shadow-soft",
                    e.type === "sos" && e.acknowledgedAt === null && "ring-2 ring-danger/50",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <TypeChip e={e} />
                    <time className="tabular text-xs text-muted-foreground" title={utcString(e.ts)}>
                      {e.tsApprox && "≈ "}
                      {clockTime(e.ts, now)}
                    </time>
                  </div>
                  <p className="mt-2 text-sm font-bold">{levelText(e)}</p>
                  <Link href={`/devices/${encodeURIComponent(e.deviceId)}`} className="text-sm text-muted-foreground hover:underline">
                    {deviceName(devices[e.deviceId], e.deviceId)}
                  </Link>
                  <p className="mt-2 text-sm">
                    <Position e={e} />
                  </p>
                  <div className="mt-3">
                    <AckCell e={e} />
                  </div>
                </li>
              ))}
          {!loading && rows.length === 0 && (
            <li className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">No alerts in this range.</li>
          )}
        </ul>

        <nav aria-label="Pagination" className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Page {pageIndex + 1}</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-11 rounded-full"
              disabled={pageIndex === 0 || loading}
              onClick={() => setCursors((c) => c.slice(0, -1))}
            >
              <ChevronLeft /> Newer
            </Button>
            <Button
              variant="outline"
              className="h-11 rounded-full"
              disabled={!result?.next || loading}
              onClick={() => result?.next && setCursors((c) => [...c, result.next])}
            >
              Older <ChevronRight />
            </Button>
          </div>
        </nav>
      </div>
    </div>
  );
}

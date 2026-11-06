"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { EXPECTED_BEATS_PER_WINDOW } from "@/lib/domain/derive";
import type { HeartbeatMinuteView } from "@/lib/domain/types";

// Validated against both chart surfaces (dataviz palette check): passes lightness band + 3:1 contrast in light and dark.
const SERIES = "#16A34A";
const HOUR = 3_600_000;

interface Point {
  t: number;
  q: number;
  beats: number;
}

function toSeries(minutes: HeartbeatMinuteView[], now: number): Point[] {
  if (minutes.length === 0) return [];
  const byMinute = new Map(minutes.map((m) => [m.minute, m]));
  const start = Math.max(minutes[0].minute, Math.floor((now - HOUR) / 60_000) * 60_000);
  const lastComplete = Math.floor(now / 60_000) * 60_000 - 60_000;
  const out: Point[] = [];
  // Missing minutes between the first and last observed are real outages (0 %), not gaps to interpolate.
  for (let t = start; t <= lastComplete; t += 60_000) {
    const m = byMinute.get(t);
    const beats = m?.count ?? 0;
    out.push({ t, beats, q: Math.min(100, Math.round((beats / EXPECTED_BEATS_PER_WINDOW) * 100)) });
  }
  return out;
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  const p = active && payload?.[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-xl bg-popover px-3 py-2 text-xs shadow-float ring-1 ring-black/5 dark:ring-white/10">
      <p className="font-semibold text-foreground">{hhmm(p.t)}</p>
      <p className="tabular text-muted-foreground">
        <span className="font-semibold text-foreground">{p.q}%</span> · {p.beats} of {EXPECTED_BEATS_PER_WINDOW} heartbeats
      </p>
    </div>
  );
}

/** Link quality per minute over the last hour, from the persisted heartbeat summaries. */
export function LinkQualityChart({ deviceId }: { deviceId: string }) {
  const [minutes, setMinutes] = useState<HeartbeatMinuteView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`/api/devices/${encodeURIComponent(deviceId)}/heartbeats?since=${Date.now() - HOUR - 60_000}`, { cache: "no-store" })
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const body = (await r.json()) as { minutes: HeartbeatMinuteView[] };
          if (!cancelled) {
            setMinutes(body.minutes);
            setNow(Date.now());
            setError(null);
          }
        })
        .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "failed"));
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [deviceId]);

  const data = useMemo(() => (minutes ? toSeries(minutes, now) : []), [minutes, now]);
  const avg = data.length ? Math.round(data.reduce((a, p) => a + p.q, 0) / data.length) : null;
  const min = data.length ? Math.min(...data.map((p) => p.q)) : null;

  return (
    <figure className="rounded-3xl bg-card p-4 shadow-soft ring-1 ring-black/[0.04] sm:p-5 dark:ring-white/[0.06]">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold">Link quality · last hour</span>
        {avg !== null && (
          <span className="tabular text-xs text-muted-foreground">
            avg <span className="font-semibold text-foreground">{avg}%</span> · min{" "}
            <span className="font-semibold text-foreground">{min}%</span>
          </span>
        )}
      </figcaption>
      <div className="mt-3 h-40">
        {minutes === null && !error ? (
          <Skeleton className="h-full w-full rounded-2xl" />
        ) : error ? (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Couldn&apos;t load heartbeat history ({error}).
          </p>
        ) : data.length === 0 ? (
          <p className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            No complete minute of heartbeats yet. The chart fills in once a minute.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }} accessibilityLayer>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={hhmm}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                minTickGap={40}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 50, 100]}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                unit="%"
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="q"
                stroke={SERIES}
                strokeWidth={2}
                fill={SERIES}
                fillOpacity={0.1}
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      {data.length > 0 && (
        <table className="sr-only">
          <caption>Link quality per minute</caption>
          <thead>
            <tr>
              <th>Minute</th>
              <th>Link quality</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.t}>
                <td>{hhmm(p.t)}</td>
                <td>{p.q}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}

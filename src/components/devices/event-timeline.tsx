"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { acknowledge } from "@/components/providers/live-provider";
import { cn } from "@/lib/utils";
import { clockTime, formatAge, formatShortCoord, relTime, utcString } from "@/lib/client/format";
import { useNow } from "@/lib/client/use-now";
import { eventDetail, eventTitle, isAckable } from "@/lib/domain/labels";
import type { EventView } from "@/lib/domain/types";

const isTransient = (e: EventView) => e.type === "motion" && e.payload.state === "CANDIDATE";

function Dot({ e }: { e: EventView }) {
  let cls = "bg-offline";
  if (e.type === "sos") cls = "bg-danger ring-4 ring-danger-tint";
  else if (e.type === "motion" && e.payload.state === "SUSPICIOUS") cls = "bg-warning ring-4 ring-warning-tint";
  else if (isTransient(e)) cls = "border-2 border-warning bg-card";
  else if (e.type === "motion") cls = "bg-muted-foreground/40";
  return <span className={cn("relative z-10 mt-1 size-3 shrink-0 rounded-full", cls)} aria-hidden />;
}

/** Presses of one SOS incident (same device, each within 2 min of the next) fold under the newest one. */
function groupIncidents(events: EventView[]): { head: EventView; earlier: EventView[] }[] {
  const out: { head: EventView; earlier: EventView[] }[] = [];
  const open = new Map<string, { group: { head: EventView; earlier: EventView[] }; lastTs: number }>();
  for (const e of events) {
    if (e.type === "sos") {
      const g = open.get(e.deviceId);
      if (g && g.lastTs - e.ts <= 120_000) {
        g.group.earlier.push(e);
        g.lastTs = e.ts;
        continue;
      }
      const group = { head: e, earlier: [] as EventView[] };
      open.set(e.deviceId, { group, lastTs: e.ts });
      out.push(group);
    } else {
      open.delete(e.deviceId);
      out.push({ head: e, earlier: [] });
    }
  }
  return out;
}

function Item({
  e,
  onFocusPosition,
  earlier = 0,
  expanded,
  onToggle,
  nested,
}: {
  e: EventView;
  onFocusPosition?: (e: EventView) => void;
  earlier?: number;
  expanded?: boolean;
  onToggle?: () => void;
  nested?: boolean;
}) {
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const detail = eventDetail(e);
  const hasPos = e.lat !== null && e.lon !== null;
  // Earlier presses of an incident are acknowledged together with its newest press.
  const needsAck = !nested && isAckable(e) && e.acknowledgedAt === null;
  return (
    <li className="relative flex gap-3 rounded-lg pb-5 last:pb-0" tabIndex={0} data-timeline-item>
      <span className="absolute top-4 bottom-0 left-[5px] w-0.5 bg-border [li:last-child>&]:hidden" aria-hidden />
      <Dot e={e} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("text-sm font-bold", e.type === "sos" && "text-danger-fg")}>{eventTitle(e)}</p>
          <time
            dateTime={new Date(e.ts).toISOString()}
            title={`${utcString(e.ts)}${e.tsApprox ? " (approx.: device clock not synced, server receive time)" : ""}`}
            className="tabular shrink-0 text-xs text-muted-foreground"
          >
            {e.tsApprox && <span className="mr-1 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold">approx.</span>}
            {clockTime(e.ts, now)}
          </time>
        </div>
        {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
        {(e.type === "sos" || e.type === "motion") && (
          <p className="mt-1 text-xs">
            {hasPos ? (
              <button
                type="button"
                onClick={() => onFocusPosition?.(e)}
                className="tabular inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
              >
                <MapPin className="size-3" aria-hidden />
                {formatShortCoord(e.lat!, e.lon!)}
                <span className="text-muted-foreground">· position {formatAge(e.ageSec)} old</span>
              </button>
            ) : (
              <span className="text-muted-foreground">No position</span>
            )}
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-muted-foreground">{relTime(e.ts, now)}</p>
        {needsAck && (
          <Button
            size="sm"
            variant={e.type === "sos" ? "default" : "secondary"}
            disabled={busy}
            className={cn("mt-2 h-9 rounded-full px-3 font-semibold", e.type === "sos" && "bg-danger text-white hover:bg-danger/90")}
            onClick={async () => {
              setBusy(true);
              await acknowledge(e, e.type === "sos");
              setBusy(false);
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Check />} Acknowledge
          </Button>
        )}
        {earlier > 0 && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={onToggle}
            className="mt-1.5 block text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
          >
            {expanded ? "Hide" : "Show"} {earlier} earlier press{earlier === 1 ? "" : "es"} in this incident
          </button>
        )}
        {isAckable(e) && e.acknowledgedAt !== null && !nested && (
          <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Check className="size-3" aria-hidden /> Acknowledged by {e.acknowledgedBy ?? "admin"} · {clockTime(e.acknowledgedAt, now)}
          </p>
        )}
      </div>
    </li>
  );
}

export function EventTimeline({
  events,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  onFocusPosition,
  className,
}: {
  events: EventView[];
  loading?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onFocusPosition?: (e: EventView) => void;
  className?: string;
}) {
  const [showTransient, setShowTransient] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const uid = useId();
  const transientCount = events.filter(isTransient).length;
  const groups = groupIncidents(showTransient ? events : events.filter((e) => !isTransient(e)));

  const onKeyDown = (ev: React.KeyboardEvent<HTMLOListElement>) => {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    const items = [...ev.currentTarget.querySelectorAll<HTMLElement>("[data-timeline-item]")];
    const i = items.findIndex((el) => el.contains(document.activeElement));
    const next = items[Math.max(0, Math.min(items.length - 1, i + (ev.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      ev.preventDefault();
      next.focus();
    }
  };

  return (
    <section
      aria-labelledby={`${uid}-title`}
      className={cn("rounded-3xl bg-card p-4 shadow-soft ring-1 ring-black/[0.04] sm:p-5 dark:ring-white/[0.06]", className)}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${uid}-title`} className="text-sm font-bold">
          Event timeline
        </h2>
        <div className="flex items-center gap-2">
          <Switch id={`${uid}-transient`} checked={showTransient} onCheckedChange={setShowTransient} />
          <Label htmlFor={`${uid}-transient`} className="text-xs font-medium text-muted-foreground">
            Show transient{transientCount ? ` (${transientCount})` : ""}
          </Label>
        </div>
      </div>
      {loading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-3 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-5 text-center text-sm text-muted-foreground">
          No events yet. SOS presses, motion alerts, restarts and connectivity changes will appear here.
        </p>
      ) : (
        <ol aria-label="Events, newest first" onKeyDown={onKeyDown}>
          {groups.flatMap(({ head, earlier }) => [
            <Item
              key={head.id}
              e={head}
              onFocusPosition={onFocusPosition}
              earlier={earlier.length}
              expanded={expanded.has(head.id)}
              onToggle={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(head.id)) next.delete(head.id);
                  else next.add(head.id);
                  return next;
                })
              }
            />,
            ...(expanded.has(head.id) ? earlier.map((e) => <Item key={e.id} e={e} onFocusPosition={onFocusPosition} nested />) : []),
          ])}
        </ol>
      )}
      {hasMore && (
        <Button variant="ghost" className="mt-3 h-10 w-full rounded-xl text-xs font-semibold" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? <Loader2 className="animate-spin" /> : <ChevronDown />} Load older events
        </Button>
      )}
    </section>
  );
}

import { badRequest, parseTime, requireSession } from "@/lib/server/api";
import { getDb } from "@/lib/server/db/client";
import { listEvents, type EventQuery } from "@/lib/server/db/repo";
import { eventDetail, eventTitle } from "@/lib/domain/labels";
import type { EventType, EventView } from "@/lib/domain/types";

const TYPES: readonly EventType[] = ["sos", "motion", "status", "reboot"];

function csvCell(v: string | number | boolean | null): string {
  if (v === null) return "";
  const s = String(v);
  // Quote everything that could break a row; neutralise spreadsheet formula injection.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(events: EventView[]): string {
  const header = [
    "id",
    "device_id",
    "type",
    "title",
    "detail",
    "level_or_indicator",
    "ts_utc",
    "ts_approx",
    "received_utc",
    "lat",
    "lon",
    "position_age_s",
    "severity",
    "acknowledged_utc",
    "acknowledged_by",
  ];
  const rows = events.map((e) => {
    const level = e.type === "sos" ? e.payload.level : e.type === "motion" ? (e.payload.indicator ?? e.payload.state) : null;
    return [
      e.id,
      e.deviceId,
      e.type,
      eventTitle(e),
      eventDetail(e),
      level,
      new Date(e.ts).toISOString(),
      e.tsApprox,
      new Date(e.receivedAt).toISOString(),
      e.lat,
      e.lon,
      e.ageSec,
      e.severity,
      e.acknowledgedAt ? new Date(e.acknowledgedAt).toISOString() : null,
      e.acknowledgedBy,
    ]
      .map(csvCell)
      .join(",");
  });
  return [header.join(","), ...rows].join("\r\n") + "\r\n";
}

export async function GET(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const p = new URL(req.url).searchParams;

  const types = (p.get("type") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (types.some((t) => !TYPES.includes(t as EventType))) return badRequest(`type must be one of ${TYPES.join(", ")}`);
  const from = parseTime(p.get("from"));
  const to = parseTime(p.get("to"));
  if (from === null || to === null) return badRequest("from/to must be epoch ms or ISO-8601");

  const q: EventQuery = {
    deviceId: p.get("deviceId") || undefined,
    types: types as EventType[],
    from,
    to,
    cursor: p.get("cursor"),
    limit: Number(p.get("limit")) || 50,
    // transient=0 hides CANDIDATE and other non-alert motion states.
    motionStates: p.get("transient") === "0" ? ["SUSPICIOUS"] : undefined,
  };

  if (p.get("format") === "csv") {
    const all: EventView[] = [];
    let cursor: string | null = null;
    do {
      const page = listEvents(getDb(), { ...q, cursor, limit: 500 });
      all.push(...page.events);
      cursor = page.nextCursor;
    } while (cursor && all.length < 50_000);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return new Response(toCsv(all), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="axiometer-alerts-${stamp}.csv"`,
      },
    });
  }

  return Response.json(listEvents(getDb(), q));
}

import "server-only";
import { sessionFromRequest, type Session } from "@/lib/auth/session";
import type { EventView, StreamMessage } from "@/lib/domain/types";
import { ensureBridge } from "./bridge";
import { getDb } from "./db/client";
import { activeSos, recentEvents } from "./db/repo";

/** Route handlers re-check the session even though proxy.ts already gates them (defence in depth). */
export async function requireSession(req: Request): Promise<Session | Response> {
  const s = await sessionFromRequest(req);
  return s ?? Response.json({ error: "unauthorized" }, { status: 401 });
}

export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export function notFound(message = "not found"): Response {
  return Response.json({ error: message }, { status: 404 });
}

/** Accepts epoch ms or an ISO-8601 string. */
export function parseTime(v: string | null): number | undefined | null {
  if (v === null || v === "") return undefined;
  if (/^\d+$/.test(v)) return Number(v);
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

export function buildSnapshot(): Extract<StreamMessage, { type: "snapshot" }> {
  const bridge = ensureBridge();
  const now = Date.now();
  const db = getDb();
  return {
    type: "snapshot",
    serverTime: now,
    devices: bridge.engine.views(now),
    events: recentEvents(db, 50),
    activeSos: activeSos(db),
    stats: bridge.engine.getStats(now),
    broker: bridge.health,
  };
}

export function sortByTsDesc(events: EventView[]): EventView[] {
  return [...events].sort((a, b) => b.ts - a.ts || b.id - a.id);
}

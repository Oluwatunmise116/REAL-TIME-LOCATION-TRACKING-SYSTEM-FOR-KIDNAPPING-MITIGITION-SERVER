import { z } from "zod";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { getBus } from "@/lib/server/bus";
import { getDb } from "@/lib/server/db/client";
import { acknowledgeEvent, getEvent } from "@/lib/server/db/repo";

const bodySchema = z.object({ includeEarlier: z.boolean().optional() }).optional();

export async function POST(req: Request, ctx: RouteContext<"/api/events/[id]/ack">) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return badRequest("invalid event id");

  let body: unknown;
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : undefined;
  } catch {
    return badRequest("body must be JSON");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return badRequest("body must be { includeEarlier?: boolean }");

  const db = getDb();
  if (!getEvent(db, id)) return notFound("event not found");
  const updated = acknowledgeEvent(db, id, auth.name, Date.now(), parsed.data?.includeEarlier ?? false);
  for (const event of updated) getBus().publish({ type: "event.acknowledged", event });
  // Already acknowledged → return the current state so the client can reconcile.
  return Response.json({ events: updated.length ? updated : [getEvent(db, id)] });
}

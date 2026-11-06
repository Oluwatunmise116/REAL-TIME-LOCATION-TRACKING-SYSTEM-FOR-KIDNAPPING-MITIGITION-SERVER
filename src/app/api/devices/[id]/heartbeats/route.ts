import { badRequest, parseTime, requireSession } from "@/lib/server/api";
import { getDb } from "@/lib/server/db/client";
import { heartbeatHistory } from "@/lib/server/db/repo";

/** Per-minute heartbeat summaries (link quality chart). */
export async function GET(req: Request, ctx: RouteContext<"/api/devices/[id]/heartbeats">) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const since = parseTime(new URL(req.url).searchParams.get("since"));
  if (since === null) return badRequest("since must be epoch ms or ISO-8601");
  return Response.json({ minutes: heartbeatHistory(getDb(), id, since ?? Date.now() - 3_600_000) });
}

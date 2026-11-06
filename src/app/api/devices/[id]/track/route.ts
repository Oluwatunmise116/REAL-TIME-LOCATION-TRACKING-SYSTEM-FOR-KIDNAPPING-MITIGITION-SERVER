import { badRequest, parseTime, requireSession } from "@/lib/server/api";
import { getDb } from "@/lib/server/db/client";
import { track } from "@/lib/server/db/repo";

export async function GET(req: Request, ctx: RouteContext<"/api/devices/[id]/track">) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const now = Date.now();
  const from = parseTime(url.searchParams.get("from"));
  const to = parseTime(url.searchParams.get("to"));
  if (from === null || to === null) return badRequest("from/to must be epoch ms or ISO-8601");
  return Response.json({ positions: track(getDb(), id, from ?? now - 3_600_000, to ?? now + 60_000) });
}

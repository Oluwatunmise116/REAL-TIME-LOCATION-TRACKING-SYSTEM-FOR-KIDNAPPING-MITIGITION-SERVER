import { z } from "zod";
import { badRequest, notFound, requireSession } from "@/lib/server/api";
import { ensureBridge } from "@/lib/server/bridge";
import { getDb } from "@/lib/server/db/client";
import { listEvents } from "@/lib/server/db/repo";

export async function GET(req: Request, ctx: RouteContext<"/api/devices/[id]">) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const device = ensureBridge().engine.view(id, Date.now());
  if (!device) return notFound("device not found");
  const { events } = listEvents(getDb(), { deviceId: id, limit: 50 });
  return Response.json({ device, events });
}

const patchSchema = z.object({
  displayName: z.string().trim().max(60).nullable(),
});

export async function PATCH(req: Request, ctx: RouteContext<"/api/devices/[id]">) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("displayName must be a string of at most 60 characters, or null");
  const device = ensureBridge().engine.rename(id, parsed.data.displayName || null, Date.now());
  if (!device) return notFound("device not found");
  return Response.json({ device });
}

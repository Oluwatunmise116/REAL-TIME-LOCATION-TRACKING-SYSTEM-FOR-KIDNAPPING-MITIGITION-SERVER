import { requireSession } from "@/lib/server/api";
import { ensureBridge } from "@/lib/server/bridge";

export async function GET(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  return Response.json({ devices: ensureBridge().engine.views(Date.now()) });
}

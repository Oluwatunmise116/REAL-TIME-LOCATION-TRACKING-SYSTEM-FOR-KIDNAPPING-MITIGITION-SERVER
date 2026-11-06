import { sessionFromRequest } from "@/lib/auth/session";
import { brokerHealth } from "@/lib/server/bridge";

/** Public liveness probe. Broker URL is only shown to signed-in users. */
export async function GET(req: Request) {
  // Touch the request first: it makes this handler request-time, so `next build` never prerenders it
  // (which would start the MQTT bridge inside a build worker).
  const signedIn = Boolean(await sessionFromRequest(req));
  const h = brokerHealth();
  const ok = h.state === "connected";
  return Response.json(
    {
      ok,
      broker: h.state,
      lastMessageAt: h.lastMessageAt,
      connectedAt: h.connectedAt,
      ...(signedIn ? { url: h.url, lastError: h.lastError } : {}),
      time: Date.now(),
    },
    { status: ok || h.state === "not_configured" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

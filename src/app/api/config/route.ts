import { requireSession } from "@/lib/server/api";
import type { ClientConfig } from "@/lib/client/config";

// Read with dynamic keys: `process.env.NEXT_PUBLIC_*` literals are inlined at build time,
// and this must reflect the runtime environment so one Docker image works everywhere.
const env = (name: string): string => (process.env[name] ?? "").trim();

function parseCenter(raw: string): { lat: number; lng: number } {
  const [lat, lng] = raw.split(",").map((s) => Number(s.trim()));
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
    return { lat, lng };
  }
  return { lat: 6.5244, lng: 3.3792 }; // Lagos
}

export async function GET(req: Request) {
  const auth = await requireSession(req);
  if (auth instanceof Response) return auth;
  const config: ClientConfig = {
    mapsApiKey: env("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY") || null,
    mapId: env("NEXT_PUBLIC_GOOGLE_MAP_ID") || null,
    defaultCenter: parseCenter(env("DEFAULT_MAP_CENTER")),
    operator: auth.name,
  };
  return Response.json(config, { headers: { "Cache-Control": "private, no-store" } });
}

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createRateLimiter, type RateLimiter } from "@/lib/auth/rate-limit";
import { authConfigError, createSessionToken, isSecureRequest, SESSION_COOKIE, SESSION_TTL_SEC } from "@/lib/auth/session";

const g = globalThis as typeof globalThis & { __axiometerLoginLimiter?: RateLimiter };
const limiter = (g.__axiometerLoginLimiter ??= createRateLimiter(5, 15 * 60 * 1000));

const bodySchema = z.object({
  password: z.string().min(1).max(512),
  name: z.string().trim().max(60).optional(),
});

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

function passwordMatches(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const configError = authConfigError();
  if (configError) return Response.json({ error: `Server misconfigured: ${configError}` }, { status: 500 });

  const ip = clientIp(req);
  const now = Date.now();
  const wait = limiter.check(ip, now);
  if (wait > 0) {
    return Response.json(
      { error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(wait) } },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !passwordMatches(parsed.data.password, process.env.DASHBOARD_PASSWORD!)) {
    limiter.fail(ip, now);
    return Response.json({ error: "Incorrect password" }, { status: 401 });
  }

  limiter.reset(ip);
  const token = await createSessionToken({ name: parsed.data.name || "admin" });
  const secure = isSecureRequest(req) ? "; Secure" : "";
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}${secure}`,
      },
    },
  );
}

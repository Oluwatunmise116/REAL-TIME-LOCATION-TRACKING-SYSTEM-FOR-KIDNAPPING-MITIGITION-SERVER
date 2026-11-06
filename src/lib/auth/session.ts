/**
 * Signed session cookie (HS256 JWT via jose). Imported by proxy.ts and route handlers,
 * so it must stay free of Node-only APIs and module-level state.
 */
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "axm_session";
export const SESSION_TTL_SEC = 60 * 60 * 24 * 7;

export interface Session {
  /** Operator name typed at login (recorded on acknowledgements). */
  name: string;
}

function key(): Uint8Array | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
}

export function authConfigError(): string | null {
  if (!process.env.DASHBOARD_PASSWORD) return "DASHBOARD_PASSWORD is not set";
  if (!key()) return "SESSION_SECRET must be at least 32 characters";
  return null;
}

export async function createSessionToken(s: Session): Promise<string> {
  const k = key();
  if (!k) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new SignJWT({ name: s.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("admin")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(k);
}

export async function verifySessionToken(token: string | undefined): Promise<Session | null> {
  const k = key();
  if (!token || !k) return null;
  try {
    const { payload } = await jwtVerify(token, k, { algorithms: ["HS256"] });
    return { name: typeof payload.name === "string" && payload.name ? payload.name : "admin" };
  } catch {
    return null;
  }
}

/** Read the session from a request's cookies (route handlers). */
export async function sessionFromRequest(req: Request): Promise<Session | null> {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return verifySessionToken(match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : undefined);
}

export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return new URL(req.url).protocol === "https:";
}

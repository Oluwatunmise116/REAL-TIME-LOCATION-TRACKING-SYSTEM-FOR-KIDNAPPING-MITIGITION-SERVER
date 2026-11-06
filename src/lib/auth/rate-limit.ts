/** Fixed-window limiter for login attempts, keyed by client IP. In-memory: one instance per server process. */
export interface RateLimiter {
  /** Returns seconds to wait if blocked, or 0 if the attempt may proceed. */
  check(key: string, now: number): number;
  fail(key: string, now: number): void;
  reset(key: string): void;
}

export function createRateLimiter(maxAttempts: number, windowMs: number): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key, now) {
      const h = hits.get(key);
      if (!h || now >= h.resetAt) return 0;
      return h.count >= maxAttempts ? Math.ceil((h.resetAt - now) / 1000) : 0;
    },
    fail(key, now) {
      const h = hits.get(key);
      if (!h || now >= h.resetAt) hits.set(key, { count: 1, resetAt: now + windowMs });
      else h.count++;
      if (hits.size > 10_000) for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

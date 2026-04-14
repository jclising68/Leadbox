/**
 * Simple in-memory rate limiter for serverless.
 * Best-effort per-instance — won't coordinate across lambda instances
 * but still effective at throttling individual attackers.
 */

const store = new Map<string, { count: number; resetAt: number }>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key);
  }
}, 5 * 60 * 1000);

export function rateLimit(
  key: string,
  { maxAttempts, windowMs }: { maxAttempts: number; windowMs: number }
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1 };
  }

  entry.count++;
  const allowed = entry.count <= maxAttempts;
  return { allowed, remaining: Math.max(0, maxAttempts - entry.count) };
}

// In-memory fixed-window rate limiter for the app's unauthenticated
// credential endpoints (/api/auth/login, /api/auth/signup, /api/auth/token —
// mobile's POST /api/auth/token is a *second* endpoint that accepts a
// password, which is exactly what makes this newly urgent rather than a
// pre-existing gap getting worse). In-memory is correct for one process on
// one VPS, which is today's deploy; move to Redis when there's a second
// process, not before. See docs/product/mobile-technical-plan-2026-09.md §2.5.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Sweep expired entries occasionally instead of on every call, so a burst of
// distinct keys (many IPs/emails) can't grow the map unboundedly between
// sweeps for long.
let lastSweepAt = 0;
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number) {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Returns true if `key` is still under `limit` for the current window, and records this attempt. */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export function getClientIp(request: Request): string {
  // Trusts the reverse proxy in front of the app (nginx et al) to set this
  // and not pass through a client-supplied value unmodified — true of every
  // standard proxy config, and there's no alternative source of a real
  // client IP behind a proxy.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_IP_LIMIT = 10;
const AUTH_EMAIL_LIMIT = 5;

/** Applies the shared 10/IP/15min + 5/email/15min policy used across every unauthenticated credential endpoint. */
export function checkAuthRateLimit(request: Request, email: string): boolean {
  const ip = getClientIp(request);
  const okByIp = checkRateLimit(`auth:ip:${ip}`, AUTH_IP_LIMIT, AUTH_WINDOW_MS);
  const okByEmail = checkRateLimit(`auth:email:${email.toLowerCase()}`, AUTH_EMAIL_LIMIT, AUTH_WINDOW_MS);
  return okByIp && okByEmail;
}

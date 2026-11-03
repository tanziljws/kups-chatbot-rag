const WINDOW_MS = 60_000;
const MAX_REQUESTS = 12;
const buckets = new Map<string, { resetAt: number; count: number }>();

export function allowRequest(key: string, now = Date.now()) {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { resetAt: now + WINDOW_MS, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

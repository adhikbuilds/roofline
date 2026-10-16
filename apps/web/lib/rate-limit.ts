/**
 * Small in-process fixed-window limiter for the public read routes that exist before Phase 4. Each server instance
 * keeps its own window, so this bounds abuse per instance rather than globally; Phase 4's public API replaces it with
 * a shared limiter.
 */
type Window = { count: number; resetAt: number };

const MAX_KEYS = 10_000;

export type Limiter = { take: (key: string, now?: number) => { allowed: boolean; retryAfter: number } };

export function createLimiter(limit: number, windowMs: number): Limiter {
  const windows = new Map<string, Window>();
  return {
    take(key, now = Date.now()) {
      let w = windows.get(key);
      if (!w || w.resetAt <= now) {
        if (windows.size >= MAX_KEYS) {
          for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
          if (windows.size >= MAX_KEYS) windows.clear();
        }
        w = { count: 0, resetAt: now + windowMs };
        windows.set(key, w);
      }
      w.count += 1;
      return { allowed: w.count <= limit, retryAfter: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
    },
  };
}

/**
 * The client address as the platform proxy reports it, or null when there is no proxy (a local dev server or test
 * run, where every request would otherwise share one bucket). Vercel always sets x-real-ip.
 */
export function clientKey(headers: Headers): string | null {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, 64);
  const xff = headers.get('x-forwarded-for');
  const last = xff?.split(',').map((p) => p.trim()).filter(Boolean).pop();
  return last ? last.slice(0, 64) : null;
}

/**
 * Process-local sliding-window rate limiter.
 *
 * Used by the same-origin marketing endpoints (`/v1/contact` today,
 * potentially `/v1/errors` and `/v1/metrics/web` later) to throttle
 * abuse without standing up a Redis dependency on the web edge.
 *
 * Limitations on purpose:
 *   - In-memory only, so a horizontally-scaled deployment would
 *     allow N parallel buckets per IP (one per server). That's a
 *     known weakness for the marketing-form use case; when the form
 *     moves to apps/api in a later phase the implementation switches
 *     to BullMQ/Redis-backed rate-limit (already a dep there).
 *   - Cleanup happens lazily on read. If an IP never returns, its
 *     entry sticks around until the next sweep. The map is bounded
 *     by `MAX_KEYS`; the LRU-ish eviction inside `recordHit` keeps
 *     memory bounded under abuse.
 *
 * The window is "rolling" in the sense that timestamps older than
 * the window are dropped on each call. So the limiter naturally
 * recovers — there's no per-window reset boundary an attacker can
 * synchronize to.
 */

export interface RateLimitConfig {
  readonly windowMs: number;
  readonly max: number;
}

interface Bucket {
  readonly hits: number[];
}

const MAX_KEYS = 5_000;

const stores = new WeakMap<RateLimitConfig, Map<string, Bucket>>();

function getStore(config: RateLimitConfig): Map<string, Bucket> {
  let store = stores.get(config);
  if (!store) {
    store = new Map();
    stores.set(config, store);
  }
  return store;
}

export interface RateLimitResult {
  readonly ok: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export function recordHit(key: string, config: RateLimitConfig, now = Date.now()): RateLimitResult {
  const store = getStore(config);
  const cutoff = now - config.windowMs;

  let bucket = store.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    store.set(key, bucket);
    if (store.size > MAX_KEYS) {
      // Drop the first inserted entry. Rough LRU; sufficient under abuse.
      const firstKey = store.keys().next().value;
      if (typeof firstKey === 'string' && firstKey !== key) {
        store.delete(firstKey);
      }
    }
  }

  // Drop expired hits in place (mutating the array is fine; nobody else
  // holds a reference and we're updating a process-local store).
  const fresh = bucket.hits.filter((t) => t > cutoff);
  fresh.push(now);
  (bucket as { hits: number[] }).hits = fresh;

  const overage = fresh.length - config.max;
  if (overage > 0) {
    const oldest = fresh[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + config.windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfterSeconds };
  }
  return { ok: true, remaining: Math.max(0, config.max - fresh.length), retryAfterSeconds: 0 };
}

/**
 * Tests pass their own freshly-built `RateLimitConfig` object so they
 * see an isolated store automatically (the `WeakMap` is keyed by
 * config identity). Production callers reuse a module-level `const`,
 * sharing one store across every request the runtime serves.
 */

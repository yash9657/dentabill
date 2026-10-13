import type { Redis } from 'ioredis';

/**
 * Per-org cost guard for SummarizerPort calls (ADR-042).
 *
 * The "read-org-budget → invoke Claude → write-back tokens-used"
 * window is the textbook check-then-act race: two concurrent jobs for
 * the same org both observe `summaryTokensUsed = 0`, both invoke
 * Claude, and the org overspends its daily budget. We close that race
 * with a Redis distributed lock keyed by `(orgId, calendarDay)`.
 *
 * Lock semantics:
 *   - Key:    `summarize:<orgId>:<YYYY-MM-DD>`
 *   - Token:  random per acquisition (no spurious unlocks).
 *   - TTL:    24h — covers a stuck process; the next day's key is
 *             different so the lock can't span midnight.
 *   - SET NX EX: atomic "set if absent, expire in N seconds".
 *
 * Lock release uses a Lua script so we don't accidentally release a
 * lock held by another process whose key happens to collide.
 *
 * The cost guard is NOT the budget arithmetic itself — it's the
 * mutex around it. The handler reads `Organization.summaryTokensUsed`
 * inside the lock, decides to abort or proceed, invokes Claude, and
 * writes back the new total inside the same lock window.
 */

export interface CostGuardLock {
  readonly orgId: string;
  readonly billingDay: string;
  readonly token: string;
}

const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export function billingDayUtc(now: Date): string {
  // Single-day window per ADR-042. UTC keeps the boundary stable
  // across deploys and avoids US/EU timezone-edge regressions.
  return now.toISOString().slice(0, 10);
}

export function lockKey(orgId: string, billingDay: string): string {
  return `summarize:${orgId}:${billingDay}`;
}

/**
 * Try to acquire the lock. Returns the held token on success, `null`
 * on contention. The handler treats `null` as "another worker has the
 * org's budget mutex" and requeues with delay (rate-limit, not
 * failure).
 */
export async function tryAcquire(
  redis: Redis,
  orgId: string,
  billingDay: string,
  ttlSeconds = 86_400,
): Promise<CostGuardLock | null> {
  const token = `${String(process.pid)}.${String(Date.now())}.${Math.random().toString(36).slice(2)}`;
  const result = await redis.set(lockKey(orgId, billingDay), token, 'EX', ttlSeconds, 'NX');
  if (result !== 'OK') return null;
  return { orgId, billingDay, token };
}

/** Release the lock IFF this process still holds it. Idempotent. */
export async function release(redis: Redis, lock: CostGuardLock): Promise<void> {
  await redis.eval(RELEASE_LUA, 1, lockKey(lock.orgId, lock.billingDay), lock.token);
}

/**
 * Mutex surface the summary handler actually needs (ADR-053). The Redis
 * implementation is the production default; the in-memory one exists for
 * serverless deployments that run without Redis.
 */
export interface CostGuard {
  tryAcquire(orgId: string, billingDay: string): Promise<CostGuardLock | null>;
  release(lock: CostGuardLock): Promise<void>;
}

export function createRedisCostGuard(redis: Redis): CostGuard {
  return {
    tryAcquire: (orgId, billingDay) => tryAcquire(redis, orgId, billingDay),
    release: (lock) => release(redis, lock),
  };
}

/**
 * Process-local lock. Serialises concurrent summaries for the same org
 * inside ONE process / function instance only — two serverless instances
 * can still both pass the budget check at the same moment, so the daily
 * token budget becomes a soft cap (worst case overshoot: one summary's
 * tokens per concurrent instance). Acceptable for the no-Redis demo
 * topology; documented in docs/DEPLOY_VERCEL.md.
 */
export function createInMemoryCostGuard(): CostGuard {
  const held = new Map<string, string>();
  return {
    tryAcquire(orgId, billingDay): Promise<CostGuardLock | null> {
      const key = lockKey(orgId, billingDay);
      if (held.has(key)) return Promise.resolve(null);
      const token = `${String(process.pid)}.${String(Date.now())}.${Math.random().toString(36).slice(2)}`;
      held.set(key, token);
      return Promise.resolve({ orgId, billingDay, token });
    },
    release(lock): Promise<void> {
      const key = lockKey(lock.orgId, lock.billingDay);
      if (held.get(key) === lock.token) held.delete(key);
      return Promise.resolve();
    },
  };
}

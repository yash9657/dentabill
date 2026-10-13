import type { DefaultJobOptions, Job } from 'bullmq';

import type { JobDispatcher } from './dispatcher.js';
import type { CallJobData, SummaryJobData } from './types.js';

/**
 * Inline (serverless) job execution — ADR-053.
 *
 * Two halves:
 *
 *   1. `createInlineJobDispatcher` — the producer side. Instead of
 *      `queue.add`, it POSTs the job payload to an internal API route
 *      authenticated by a shared secret. The POST is fire-and-forget: the
 *      promise is handed to `waitUntil` (Vercel keeps the invocation alive
 *      until it settles) and the caller gets the job id back immediately.
 *
 *   2. `runInlineJob` — the consumer side, used by that internal route. It
 *      wraps the payload in a minimal BullMQ-`Job`-shaped object so the
 *      existing processors run unchanged, and replays BullMQ's retry
 *      policy (`attempts` + exponential `backoff`) in-process, bounded by
 *      the invocation's time budget.
 */

export const INTERNAL_JOB_SECRET_HEADER = 'x-internal-job-secret';

export const INTERNAL_JOB_ROUTES = {
  calls: '/v1/internal/jobs/calls',
  summaries: '/v1/internal/jobs/summaries',
} as const;

export type InlineJobKind = keyof typeof INTERNAL_JOB_ROUTES;

export interface CreateInlineJobDispatcherOptions {
  /** Origin of the API deployment, e.g. `https://api.example.com`. No trailing path. */
  readonly baseUrl: string;
  /** Shared secret sent in `INTERNAL_JOB_SECRET_HEADER`. */
  readonly secret: string;
  /** Extra request headers, e.g. Vercel's `x-vercel-protection-bypass`. */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Keeps the current invocation alive until the trigger settles. On
   * Vercel this is `waitUntil` from `@vercel/functions`; elsewhere a
   * function that simply lets the promise run.
   */
  readonly waitUntil: (promise: Promise<unknown>) => void;
  /** Injected for tests. Defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Trigger attempts before giving up (network error / 5xx). Default 3. */
  readonly triggerAttempts?: number;
  /** Delay between trigger attempts. Default 500 ms. */
  readonly triggerRetryDelayMs?: number;
  /** Called once if the trigger ultimately fails. Must not throw. */
  readonly onTriggerError?: (err: unknown, ctx: { kind: InlineJobKind; jobId: string }) => void;
}

export function createInlineJobDispatcher(
  options: CreateInlineJobDispatcherOptions,
): JobDispatcher {
  const doFetch = options.fetch ?? fetch;
  const attempts = Math.max(1, options.triggerAttempts ?? 3);
  const retryDelayMs = options.triggerRetryDelayMs ?? 500;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  const trigger = async (
    kind: InlineJobKind,
    body: CallJobData | SummaryJobData,
  ): Promise<void> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const res = await doFetch(`${baseUrl}${INTERNAL_JOB_ROUTES[kind]}`, {
          method: 'POST',
          headers: {
            ...options.headers,
            'content-type': 'application/json',
            [INTERNAL_JOB_SECRET_HEADER]: options.secret,
          },
          body: JSON.stringify(body),
        });
        if (res.ok) return;
        lastError = new Error(`internal job trigger ${kind} returned HTTP ${String(res.status)}`);
        // 4xx (bad secret, bad payload) will not get better on retry.
        if (res.status < 500) break;
      } catch (err) {
        lastError = err;
      }
      if (attempt < attempts) await sleep(retryDelayMs);
    }
    throw lastError;
  };

  const fire = (kind: InlineJobKind, body: CallJobData | SummaryJobData): string => {
    const jobId = body.idempotencyKey;
    const promise = trigger(kind, body).catch((err: unknown) => {
      options.onTriggerError?.(err, { kind, jobId });
    });
    options.waitUntil(promise);
    return jobId;
  };

  return {
    mode: 'inline',
    dispatchCall(data): Promise<string> {
      return Promise.resolve(fire('calls', data));
    },
    dispatchSummary(data): Promise<string> {
      return Promise.resolve(fire('summaries', data));
    },
  };
}

// ─── Consumer side ─────────────────────────────────────────────────────────

/**
 * The subset of a BullMQ `Job` the call / summary / DLQ handlers read.
 * Audited against apps/call-worker/src/handler.ts, dlq-consumer.ts and
 * apps/summary-worker/src/handler.ts: they touch `id` and `data` only;
 * `name` and `attemptsMade` are carried for logging parity.
 */
export interface InlineJob<D> {
  readonly id: string;
  readonly name: string;
  readonly data: D;
  readonly attemptsMade: number;
}

/**
 * Present an `InlineJob` as a BullMQ `Job` for processors typed against
 * BullMQ's `Processor`. Safe because the handlers only read the fields
 * `InlineJob` carries (see above); anything else would be `undefined`.
 */
export function asBullMqJob<D, R, N extends string>(job: InlineJob<D>): Job<D, R, N> {
  return job as unknown as Job<D, R, N>;
}

/** BullMQ's built-in backoff formulas: fixed = delay, exponential = delay·2^(n-1). */
export function computeBackoffMs(
  backoff: DefaultJobOptions['backoff'],
  attemptsMade: number,
): number {
  if (backoff === undefined) return 0;
  if (typeof backoff === 'number') return backoff;
  const delay = backoff.delay ?? 0;
  if (backoff.type === 'exponential') return Math.round(2 ** (attemptsMade - 1) * delay);
  return delay;
}

export type InlineJobOutcome<R> =
  | { readonly status: 'completed'; readonly result: R; readonly attemptsMade: number }
  | {
      readonly status: 'failed';
      readonly error: unknown;
      readonly attemptsMade: number;
      /** True when retries stopped early because the next backoff would overrun the budget. */
      readonly budgetExhausted: boolean;
    };

export interface RunInlineJobOptions<D, R> {
  readonly id: string;
  readonly name: string;
  readonly data: D;
  /** BullMQ job options to honour — `attempts` and `backoff` are used. */
  readonly jobOptions: DefaultJobOptions;
  readonly process: (job: InlineJob<D>) => Promise<R>;
  /**
   * Wall-clock budget for all attempts + backoff sleeps. A retry is only
   * scheduled if its backoff ends inside the budget; the processor's own
   * runtime is not pre-empted.
   */
  readonly budgetMs: number;
  readonly onAttemptFailed?: (err: unknown, attemptsMade: number) => void;
  /** Test seams. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

export async function runInlineJob<D, R>(
  options: RunInlineJobOptions<D, R>,
): Promise<InlineJobOutcome<R>> {
  const now = options.now ?? Date.now;
  const wait = options.sleep ?? sleep;
  const maxAttempts = Math.max(1, options.jobOptions.attempts ?? 1);
  const deadline = now() + options.budgetMs;

  let attemptsMade = 0;
  for (;;) {
    try {
      const result = await options.process({
        id: options.id,
        name: options.name,
        data: options.data,
        attemptsMade,
      });
      return { status: 'completed', result, attemptsMade: attemptsMade + 1 };
    } catch (err) {
      attemptsMade += 1;
      options.onAttemptFailed?.(err, attemptsMade);
      if (attemptsMade >= maxAttempts) {
        return { status: 'failed', error: err, attemptsMade, budgetExhausted: false };
      }
      const delay = computeBackoffMs(options.jobOptions.backoff, attemptsMade);
      if (now() + delay >= deadline) {
        return { status: 'failed', error: err, attemptsMade, budgetExhausted: true };
      }
      await wait(delay);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

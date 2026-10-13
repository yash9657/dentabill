/**
 * `POST /v1/internal/jobs/calls` and `POST /v1/internal/jobs/summaries` —
 * inline job execution (ADR-053).
 *
 * In `JOB_DISPATCH_MODE=inline` the dispatcher POSTs each job here instead
 * of adding it to BullMQ. The route authenticates the shared secret,
 * validates the payload at the trust boundary, acknowledges with 202, and
 * then runs the processor to completion under `waitUntil` — so the trigger
 * returns in milliseconds while the job keeps the invocation alive up to
 * the function's maxDuration (800 s on Vercel Pro).
 *
 * Not part of the public API: hidden from the OpenAPI document and
 * unreachable unless `INTERNAL_JOB_SECRET` is configured.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import {
  CallJobDataSchema,
  INTERNAL_JOB_SECRET_HEADER,
  SummaryJobDataSchema,
} from '@dentabill/queue';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { runInBackground } from '../../lib/background.js';
import { getEnv } from '../../lib/env.js';
import {
  createInlineJobRuntime,
  type InlineJobRuntime,
  type InlineRunReport,
} from '../../lib/inline-jobs.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Lazily built on the first internal job so `bullmq`-mode servers and
     * tests never construct worker adapters. Decorated (as `null`) on the
     * root instance in app.ts so tests can assign a fake.
     */
    inlineJobRuntime: InlineJobRuntime | null;
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Constant-time secret check. Both sides are hashed first so the compare
 * runs over equal-length buffers and leaks neither content nor length.
 */
export function internalSecretMatches(provided: unknown, expected: string | undefined): boolean {
  if (expected === undefined || expected.length === 0) return false;
  if (typeof provided !== 'string' || provided.length === 0) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

export function internalJobsRoutes(fastify: FastifyInstance): void {
  const runtime = (): InlineJobRuntime =>
    (fastify.inlineJobRuntime ??= createInlineJobRuntime({
      jobDispatcher: fastify.jobDispatcher,
      redis: fastify.queueRedis,
    }));

  const authorize = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const ok = internalSecretMatches(
      request.headers[INTERNAL_JOB_SECRET_HEADER],
      getEnv().INTERNAL_JOB_SECRET,
    );
    if (!ok) {
      void reply.code(401).send({ error: true, code: 'UNAUTHORIZED', message: 'Unauthorized.' });
    }
    return ok;
  };

  const logReport = (kind: string, jobId: string, report: InlineRunReport): void => {
    const level = report.status === 'failed' ? 'error' : 'info';
    fastify.log[level]({ kind, jobId, ...report }, 'inline job finished');
  };

  const schema = { hide: true } as const;

  fastify.post('/internal/jobs/calls', { schema }, async (request, reply) => {
    if (!authorize(request, reply)) return reply;
    const parsed = CallJobDataSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: true, code: 'VALIDATION_ERROR', message: 'Invalid call job payload.' });
    }
    const data = parsed.data;
    const jobs = runtime();
    runInBackground(
      jobs.runCall(data).then(
        (report) => {
          logReport('calls', data.idempotencyKey, report);
        },
        (err: unknown) => {
          fastify.log.error({ jobId: data.idempotencyKey, err }, 'inline call job crashed');
        },
      ),
    );
    return reply.code(202).send({ accepted: true, jobId: data.idempotencyKey });
  });

  fastify.post('/internal/jobs/summaries', { schema }, async (request, reply) => {
    if (!authorize(request, reply)) return reply;
    const parsed = SummaryJobDataSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: true, code: 'VALIDATION_ERROR', message: 'Invalid summary job payload.' });
    }
    const data = parsed.data;
    const jobs = runtime();
    runInBackground(
      jobs.runSummary(data).then(
        (report) => {
          logReport('summaries', data.idempotencyKey, report);
        },
        (err: unknown) => {
          fastify.log.error({ jobId: data.idempotencyKey, err }, 'inline summary job crashed');
        },
      ),
    );
    return reply.code(202).send({ accepted: true, jobId: data.idempotencyKey });
  });
}

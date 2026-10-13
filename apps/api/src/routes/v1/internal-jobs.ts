/**
 * `POST /v1/internal/jobs/calls` and `POST /v1/internal/jobs/summaries` —
 * inline job execution (ADR-053).
 *
 * In `JOB_DISPATCH_MODE=inline` the dispatcher POSTs each job here instead
 * of adding it to BullMQ. The route authenticates the shared secret,
 * validates the payload at the trust boundary, and acknowledges only after
 * the runtime reaches a durable disposition. `waitUntil` also tracks the
 * work if the caller times out before receiving the completion receipt.
 *
 * Not part of the public API: hidden from the OpenAPI document and
 * unreachable unless `INTERNAL_JOB_SECRET` is configured.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { relayJobOutbox } from '@dentabill/call-worker';
import { prisma } from '@dentabill/db';
import {
  CallJobDataSchema,
  type CallJobData,
  INTERNAL_JOB_SECRET_HEADER,
  INTERNAL_JOB_TRANSPORT_HEADER,
  TransportJobIdSchema,
  SummaryJobDataSchema,
  type SummaryJobData,
} from '@dentabill/queue';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { runInBackground } from '../../lib/background.js';
import { getEnv } from '../../lib/env.js';
import {
  createInlineJobRuntime,
  createCallObservationSweep,
  type CallObservationSweep,
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
    /** Optional injected observer; production creates provider-only clients lazily. */
    callObservationSweep?: CallObservationSweep;
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
  const observe = (): CallObservationSweep =>
    (fastify.callObservationSweep ??= createCallObservationSweep({ prisma }));
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
    fastify.log[level](
      {
        kind,
        jobId,
        status: report.status,
        ...('attemptsMade' in report && { attemptsMade: report.attemptsMade }),
        ...(report.status === 'failed' && { dlq: report.dlq }),
      },
      'inline job finished',
    );
  };

  const unconfirmed = (reply: FastifyReply): FastifyReply =>
    reply.code(503).send({
      error: true,
      code: 'INTERNAL_ERROR',
      message: 'Job completion is not confirmed.',
    });

  const execute = async (
    data: CallJobData | SummaryJobData,
    run: () => Promise<InlineRunReport>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const kind = 'claimId' in data ? 'calls' : 'summaries';
    const jobId = data.idempotencyKey;
    const work = Promise.resolve().then(run);
    runInBackground(work);
    try {
      const report = await work;
      logReport(kind, jobId, report);
      if (report.status === 'failed' && !report.dlq) return await unconfirmed(reply);
      if ('claimId' in data) {
        if (data.resume && data.idempotencyKey !== `call.resume.${data.resume.intentId}`) {
          return await unconfirmed(reply);
        }
        // A duplicate worker can short-circuit while another owner is still submitting.
        // Only durable disposition of this exact saved command confirms delivery.
        const intent = await prisma.callIntent.findFirst({
          where: {
            organizationId: data.organizationId,
            ...(data.resume
              ? { id: data.resume.intentId, callId: data.resume.callId }
              : { idempotencyKey: data.idempotencyKey }),
            claimId: data.claimId,
            attemptNumber: data.attemptNumber,
            claimPriority: data.claimPriority,
            OR: [
              { state: { in: data.resume ? ['TERMINAL'] : ['TERMINAL', 'CANCELLED', 'UNKNOWN'] } },
              {
                state: 'ACCEPTED',
                callId: { not: null },
                callDeadlineAt: { not: null },
                nextObservationAt: { not: null },
              },
            ],
          },
          select: { payerCode: true },
        });
        if (intent?.payerCode !== data.payerCode) return await unconfirmed(reply);
      }
      return await reply.code(200).send({ accepted: true, jobId });
    } catch {
      fastify.log.error({ kind, jobId, code: 'INLINE_JOB_CRASH' }, 'inline job unconfirmed');
      return await unconfirmed(reply);
    }
  };

  const schema = { hide: true } as const;

  fastify.post('/internal/jobs/calls', { schema }, async (request, reply) => {
    if (!authorize(request, reply)) return reply;
    const transport = TransportJobIdSchema.optional().safeParse(
      request.headers[INTERNAL_JOB_TRANSPORT_HEADER],
    );
    if (!transport.success)
      return reply.code(400).send({
        error: true,
        code: 'VALIDATION_ERROR',
        message: 'Invalid delivery identity.',
      });
    const parsed = CallJobDataSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: true, code: 'VALIDATION_ERROR', message: 'Invalid call job payload.' });
    }
    const data = parsed.data;
    return execute(
      data,
      () =>
        transport.data === undefined
          ? runtime().runCall(data)
          : runtime().runCall(data, { transportJobId: transport.data }),
      reply,
    );
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
    return execute(data, () => runtime().runSummary(data), reply);
  });

  fastify.post('/internal/jobs/outbox/relay', { schema }, async (request, reply) => {
    if (!authorize(request, reply)) return reply;
    if (
      !z
        .object({})
        .strict()
        .safeParse(request.body ?? {}).success
    ) {
      return reply
        .code(400)
        .send({ error: true, code: 'VALIDATION_ERROR', message: 'Invalid relay payload.' });
    }
    // This authenticated system sweep owns scope and bounds; callers cannot override them.
    const work = Promise.allSettled([
      relayJobOutbox({
        prisma,
        jobDispatcher: fastify.jobDispatcher,
        limit: 25,
        leaseMs: 30_000,
        sendTimeoutMs: 5_000,
        budgetMs: 20_000,
      }),
      Promise.resolve().then(() => observe()({ limit: 5, budgetMs: 25_000 })),
    ]);
    runInBackground(work);
    try {
      const [relay, observation] = await work;
      if (relay.status === 'rejected' || observation.status === 'rejected') {
        fastify.log.error({ code: 'RECOVERY_SWEEP_UNCONFIRMED' }, 'recovery sweep unconfirmed');
        return await unconfirmed(reply);
      }
      const { selected, sent, failed, quarantined } = relay.value;
      const {
        selected: due,
        observed,
        terminal,
        rescheduled,
        stopRequested,
        failed: observationFailed,
      } = observation.value;
      return await reply.code(200).send({
        selected,
        sent,
        failed,
        quarantined,
        observation: {
          selected: due,
          observed,
          terminal,
          rescheduled,
          stopRequested,
          failed: observationFailed,
        },
      });
    } catch {
      fastify.log.error({ code: 'OUTBOX_RELAY_UNCONFIRMED' }, 'outbox relay unconfirmed');
      return await unconfirmed(reply);
    }
  });
}

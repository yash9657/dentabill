import { audit, getOrgScopedDb, prisma } from '@dentabill/db';
import { checkPayerHours } from '@dentabill/payer-ivr';
import { CALL_JOB_NAME, type CallJobData } from '@dentabill/queue';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/**
 * `/v1/claims/:id/calls` — enqueue an outbound call (P3-T16).
 *
 * Phase 3 entry point for the dashboard "Call now" button. The route
 * does the bare-minimum gating then hands off to BullMQ; the actual
 * call lifecycle (Retell → IVR → rep → DB persist) lives in the
 * call-worker.
 *
 * Flow:
 *
 *   1. `requireAuth` populates `request.dentabillAuth` with `orgId` and
 *      `userId`.
 *   2. Look up the Claim through `getOrgScopedDb` so the multi-tenancy
 *      filter is automatic — a foreign claim id returns 404, not the
 *      foreign row.
 *   3. Reject if the claim is in a state where dialling makes no sense
 *      (`COMPLETED`, `WRITTEN_OFF`, etc.).
 *   4. Reject if the payer's provider line is closed at submission time
 *      (ADR-037 — business-hours guard runs at enqueue, not at worker
 *      pickup, so the user gets immediate feedback).
 *   5. Transition Claim → IN_QUEUE via the `prisma.claim.updateMany`
 *      with a composite where (matches the established API pattern in
 *      claims.ts).
 *   6. Enqueue a `call.place` job. The BullMQ jobId is the deterministic
 *      idempotency key (`<claimId>-<attemptNumber>-<timestamp slug>`)
 *      so a UI double-click collapses to a single job.
 *   7. Audit + return 202 with `{ jobId, claimId, queuedAt }`.
 *
 * Per-org rate limit: 10/min (ADR-035 — busy practices have ~50 claims
 * per biller per day; 10 enqueues per minute is well above the
 * legitimate ceiling and well below the per-payer line capacity).
 */

const PHASE_3_PAYERS = ['DELTA_DENTAL_PPO', 'CIGNA_DENTAL', 'METLIFE_DENTAL'] as const;
const PHASE_3_PAYERS_SET = new Set<string>(PHASE_3_PAYERS);

const IdParamSchema = z.object({ id: z.string().min(1, 'Claim id is required.') }).strict();

const EnqueueCallBodySchema = z
  .object({
    /**
     * Optional override of the claim's stored priority. Phase 3 doesn't
     * surface a UI for this — the placeholder is here for testability
     * and so an internal tool (P3-T20 cancel + reschedule) can prefer
     * a one-shot priority bump without touching the row.
     */
    priorityOverride: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .optional();

const EnqueueCallResponseSchema = z.object({
  jobId: z.string(),
  claimId: z.string(),
  queuedAt: z.iso.datetime(),
  attemptNumber: z.number().int().min(1).max(2),
});

type EnqueueCallResponse = z.infer<typeof EnqueueCallResponseSchema>;

const ENQUEUEABLE_CLAIM_STATUSES = new Set(['PENDING', 'NEEDS_INFO', 'APPEALING', 'MANUAL_REVIEW']);

export function callsRoutes(fastify: FastifyInstance): void {
  const { requireAuth } = fastify.auth;
  const security = [{ bearer: [] as string[] }];

  fastify.withTypeProvider().post(
    '/claims/:id/calls',
    {
      preHandler: requireAuth,
      schema: {
        description:
          'Enqueue an outbound payer call for the given claim. Returns 202 with the BullMQ job id; the call lifecycle plays out in the call-worker.',
        security,
        params: IdParamSchema,
        body: EnqueueCallBodySchema,
        response: { 202: EnqueueCallResponseSchema },
      },
      // Per-org rate limit (ADR-035). Per-route override of the global
      // 300/min — dialling is a high-cost action and 10/min keeps a
      // runaway script (or a genuinely confused biller) from amplifying
      // beyond Retell's per-account concurrency.
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: (req): string => req.dentabillAuth?.orgId ?? 'anon',
        },
      },
    },
    async (request, reply): Promise<EnqueueCallResponse> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const orgId = auth.orgId;
      const { id } = request.params as z.infer<typeof IdParamSchema>;
      const body = (request.body ?? {}) as z.infer<typeof EnqueueCallBodySchema>;

      const db = getOrgScopedDb(orgId);
      const claim = await db.claim.findFirst({ where: { id } });
      if (!claim) {
        throw new ApiError('NOT_FOUND', 'Claim not found in your organization.');
      }

      if (!ENQUEUEABLE_CLAIM_STATUSES.has(claim.status)) {
        throw new ApiError(
          'INVALID_STATE_TRANSITION',
          `Claim ${id} is in ${claim.status}; only PENDING / NEEDS_INFO / APPEALING / MANUAL_REVIEW claims can be enqueued.`,
        );
      }

      if (!PHASE_3_PAYERS_SET.has(claim.payerCode)) {
        throw new ApiError(
          'UNSUPPORTED_PAYER',
          `Payer ${claim.payerCode} is not supported in Phase 3 (Delta Dental PPO, Cigna Dental, MetLife Dental only).`,
        );
      }

      // ADR-037 — business-hours guard at enqueue, not worker pickup.
      const hours = checkPayerHours(claim.payerCode, new Date());
      if (hours.state === 'closed') {
        throw new ApiError(
          'PAYER_HOURS_CLOSED',
          `${claim.payerCode} provider line is closed (${hours.reason}). Next opening: ${hours.nextOpeningAt.toISOString()}.`,
        );
      }
      if (hours.state === 'unsupported_payer') {
        throw new ApiError(
          'UNSUPPORTED_PAYER',
          `Payer ${claim.payerCode} business-hours metadata is missing.`,
        );
      }

      // Count today's attempts for this claim so we stamp the right
      // `attemptNumber` (ADR-039 cap of 2/claim/day). UTC day boundary
      // is fine for Phase 3 — payer-local wall-clock day matters most
      // for the hold-time policy, which the worker enforces.
      const todayUtcStart = new Date();
      todayUtcStart.setUTCHours(0, 0, 0, 0);
      const attemptsToday = await prisma.call.count({
        where: {
          organizationId: orgId,
          claimId: id,
          createdAt: { gte: todayUtcStart },
        },
      });
      if (attemptsToday >= 2) {
        throw new ApiError(
          'RATE_LIMITED',
          'This claim has already used its 2 dialling attempts for today (ADR-039).',
        );
      }
      const attemptNumber = (attemptsToday + 1) as 1 | 2;

      const queuedAt = new Date();
      const idempotencyKey = `${id}-a${String(attemptNumber)}-${queuedAt.getTime().toString(36)}`;
      const data: CallJobData = {
        organizationId: orgId,
        claimId: id,
        payerCode: claim.payerCode,
        attemptNumber,
        claimPriority: body?.priorityOverride ?? claim.priority,
        idempotencyKey,
      };

      // Transition the claim into the queue BEFORE enqueuing the job —
      // a worker pickup is allowed to see status=IN_QUEUE; if Redis
      // throws on `add()` we leave the claim flipped, which is the
      // less-bad failure mode (the user sees the queued state and can
      // retry; the background reaper P3-T28 documents could pull stuck
      // rows back to PENDING).
      await prisma.claim.updateMany({
        where: { id, organizationId: orgId },
        data: { status: 'IN_QUEUE' },
      });

      try {
        await fastify.callsQueue.add(CALL_JOB_NAME, data, {
          jobId: idempotencyKey,
          // Higher claimPriority → lower BullMQ priority value (BullMQ
          // is min-first). Map [0..100] → [101..1] so 100 priority
          // dials before 0.
          priority: 101 - data.claimPriority,
        });
      } catch (err) {
        // Roll the claim back so the UI doesn't show a stuck IN_QUEUE.
        await prisma.claim.updateMany({
          where: { id, organizationId: orgId, status: 'IN_QUEUE' },
          data: { status: claim.status },
        });
        throw err;
      }

      await audit({
        action: 'call.enqueue',
        resourceType: 'Claim',
        resourceId: id,
        organizationId: orgId,
        metadata: {
          clerkUserId: auth.userId,
          attemptNumber,
          jobId: idempotencyKey,
          payerCode: claim.payerCode,
        },
      });

      reply.code(202);
      return {
        jobId: idempotencyKey,
        claimId: id,
        queuedAt: queuedAt.toISOString(),
        attemptNumber,
      };
    },
  );
}

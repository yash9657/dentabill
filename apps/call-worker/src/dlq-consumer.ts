import type { CallDLQReason } from '@dentabill/db';
import type { Logger } from '@dentabill/logger';
import {
  type DlqJobData,
  DlqJobDataSchema,
  type DlqJobName,
  DLQ_REASONS,
  type DlqReason,
  QUEUE_NAMES,
} from '@dentabill/queue';
import { Worker, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';

import type { DbClient } from './handler.js';

/**
 * DLQ consumer (P3-T14).
 *
 * Drains `calls-dlq` and persists the terminal escalation across the
 * domain so the dashboard surface (P3-T18 calls list, P3-T22 KPI tiles)
 * does not need access to BullMQ admin to know why a claim ended up in
 * `MANUAL_REVIEW`. For each DLQ payload:
 *
 *   1. Find the most-recent Call row for the (org, claim, attempt)
 *      tuple. There may be none — a job can DLQ before
 *      `handler.ts` ever called `prisma.call.create` (e.g. start-call
 *      failed at the network layer). In that case we still escalate
 *      the claim and emit a structured log line; the missing Call row
 *      is a known recoverability gap until P4 adds the schema column.
 *   2. If a Call exists:
 *      - stamp `Call.dlqReason` (idempotent — skipped if already set)
 *      - flip `Call.status = FAILED`
 *      - insert a `CallEvent type=DLQ` carrying the full DLQ payload
 *        (org-scope safe: CallEvent inherits org through Call)
 *   3. Flip the Claim to `MANUAL_REVIEW` if not already there.
 *   4. Emit a structured `logger.warn` line — Phase 5 wires this into
 *      Slack via the existing logger transport, no code change here.
 *
 * Idempotency: re-running the same DLQ job is a no-op once
 * `Call.dlqReason` is set. BullMQ's `jobId === originalJobId` (set by
 * `enqueueDlqJob`) protects against duplicate enqueue; this handler
 * additionally protects against duplicate consumption.
 */
export interface DlqHandlerDeps {
  readonly logger: Logger;
  readonly prisma: DbClient;
}

export type DlqProcessor = Processor<DlqJobData, void, DlqJobName>;

export type DlqWorker = Worker<DlqJobData, void, DlqJobName>;

export function createDlqJobHandler(deps: DlqHandlerDeps): DlqProcessor {
  return async (job): Promise<void> => {
    const validation = await DlqJobDataSchema.safeParseAsync(job.data);
    if (!validation.success) throw validation.error;
    const data = validation.data;
    const { organizationId, claimId, attemptNumber } = data.originalData;

    // Look for the Call row that corresponds to this DLQ entry. We
    // match on (org, claim, attemptNumber) — that triple is unique-per-
    // day in practice given the ADR-039 cap of 2 attempts/claim/day.
    const existingCall = await deps.prisma.call.findFirst({
      where: { organizationId, claimId, attemptNumber },
      orderBy: { createdAt: 'desc' },
    });

    if (existingCall !== null) {
      // Idempotent: if `dlqReason` is already set we have already
      // processed this DLQ row (or an earlier duplicate of it).
      if (existingCall.dlqReason !== null) {
        deps.logger.info(
          {
            dlqJobId: job.id,
            callId: existingCall.id,
            organizationId,
            claimId,
            existingDlqReason: existingCall.dlqReason,
          },
          'dlq-consumer: skipping — Call already has dlqReason set',
        );
        return;
      }

      const dlqReason = mapDlqReasonToEnum(data.reason);
      await deps.prisma.call.updateMany({
        where: { id: existingCall.id, organizationId },
        data: { status: 'FAILED', dlqReason },
      });
      await deps.prisma.callEvent.create({
        data: {
          callId: existingCall.id,
          eventType: 'call.dlq',
          data: {
            reason: data.reason,
            failedReason: data.failedReason ?? null,
            attemptsMade: data.attemptsMade,
            originalJobId: data.originalJobId,
            enqueuedAt: data.enqueuedAt,
          },
        },
      });
    } else {
      deps.logger.warn(
        {
          dlqJobId: job.id,
          organizationId,
          claimId,
          attemptNumber,
          reason: data.reason,
        },
        'dlq-consumer: no Call row found for DLQ entry — claim still escalated',
      );
    }

    // Always escalate the Claim — independent of whether a Call row
    // existed, the biller needs MANUAL_REVIEW visibility.
    await deps.prisma.claim.updateMany({
      where: { id: claimId, organizationId, status: { not: 'MANUAL_REVIEW' } },
      data: { status: 'MANUAL_REVIEW' },
    });

    deps.logger.warn(
      {
        dlqJobId: job.id,
        organizationId,
        claimId,
        attemptNumber,
        reason: data.reason,
        failedReason: data.failedReason,
        attemptsMade: data.attemptsMade,
      },
      'dlq-consumer: call escalated to MANUAL_REVIEW (Phase 5 will route this through Slack)',
    );
  };
}

function mapDlqReasonToEnum(reason: DlqReason): CallDLQReason {
  switch (reason) {
    case DLQ_REASONS.EXCEEDED_MAX_ATTEMPTS:
      return 'EXCEEDED_MAX_ATTEMPTS';
    case DLQ_REASONS.EXCEEDED_MAX_DURATION:
      return 'EXCEEDED_MAX_DURATION';
    case DLQ_REASONS.EXCEEDED_MAX_HOLD:
      return 'EXCEEDED_MAX_HOLD';
    case DLQ_REASONS.CANCELLED_BY_OPERATOR:
      return 'CANCELLED_BY_OPERATOR';
  }
}

export interface CreateDlqWorkerOptions {
  readonly connection: Redis;
  readonly processor: DlqProcessor;
  /** ADR-035 — DLQ concurrency is intentionally low (1) since it writes to Postgres. */
  readonly concurrency?: number;
}

export function createDlqWorker(options: CreateDlqWorkerOptions): DlqWorker {
  return new Worker<DlqJobData, void, DlqJobName>(QUEUE_NAMES.CALLS_DLQ, options.processor, {
    connection: options.connection,
    concurrency: options.concurrency ?? 1,
  });
}

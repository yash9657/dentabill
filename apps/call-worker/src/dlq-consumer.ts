import { createHash } from 'node:crypto';

import type { Logger } from '@dentabill/logger';
import {
  CallJobDataSchema,
  type DlqJobData,
  DlqJobDataSchema,
  type DlqJobName,
  QUEUE_NAMES,
} from '@dentabill/queue';
import { Worker, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';

import type { DbClient } from './handler.js';

/**
 * Queue exhaustion is not evidence that the provider call failed. Only an exact
 * READY intent can be cancelled; submitted or ambiguous intents retain their
 * evidence and remain protected against another physical submission.
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
    const original = data.originalData;
    const cancelled = await deps.prisma.$transaction(async (tx) => {
      // Serialize cancellation with approval so an older transport cannot cancel
      // the newly approved generation of the same immutable domain command.
      await tx.$queryRaw`SELECT id FROM "JobOutbox" WHERE "organizationId" = ${original.organizationId} AND kind = 'CALL_PLACE' AND "idempotencyKey" = ${original.idempotencyKey} FOR SHARE`;
      const outbox = await tx.jobOutbox.findFirst({
        where: {
          organizationId: original.organizationId,
          kind: 'CALL_PLACE',
          idempotencyKey: original.idempotencyKey,
        },
      });
      const expectedJobId =
        outbox && outbox.recoveryCount > 0
          ? `outbox.${outbox.id}.recovery.${String(outbox.recoveryCount)}`
          : original.idempotencyKey;
      if (data.originalJobId !== expectedJobId || outbox?.state === 'CLOSED') return false;
      if (outbox) {
        const payload = CallJobDataSchema.strict().safeParse(outbox.payload);
        if (
          !payload.success ||
          JSON.stringify(payload.data) !== JSON.stringify(original) ||
          createHash('sha256').update(JSON.stringify(payload.data)).digest('hex') !==
            outbox.payloadHash
        )
          return false;
      }
      const intent = await tx.callIntent.findFirst({
        where: {
          organizationId: original.organizationId,
          idempotencyKey: original.idempotencyKey,
        },
      });
      if (
        intent?.claimId !== original.claimId ||
        intent.payerCode !== original.payerCode ||
        intent.attemptNumber !== original.attemptNumber ||
        intent.claimPriority !== original.claimPriority ||
        intent.state !== 'READY'
      )
        return false;

      const claimed = await tx.callIntent.updateMany({
        where: {
          id: intent.id,
          organizationId: original.organizationId,
          state: 'READY',
          callId: null,
          submittedAt: null,
        },
        data: {
          state: 'CANCELLED',
          completedAt: new Date(),
          lastErrorCode: 'DELIVERY_EXHAUSTED',
        },
      });
      if (claimed.count === 0) return false;
      const claim = await tx.claim.updateMany({
        where: {
          id: intent.claimId,
          organizationId: intent.organizationId,
          status: 'IN_QUEUE',
          updatedAt: intent.claimVersion,
        },
        data: { status: 'MANUAL_REVIEW' },
      });
      await tx.auditLog.create({
        data: {
          organizationId: intent.organizationId,
          action: 'call.intent.cancelled',
          resourceType: 'CallIntent',
          resourceId: intent.id,
          metadata: {
            reason: data.reason,
            attemptsMade: data.attemptsMade,
            jobId: original.idempotencyKey,
            claimChanged: claim.count > 0,
          },
        },
      });
      return true;
    });

    deps.logger.warn(
      {
        jobId: original.idempotencyKey,
        organizationId: original.organizationId,
        claimId: original.claimId,
        reason: data.reason,
        intentCancelled: cancelled,
      },
      'call delivery exhausted; submitted and ambiguous intents remain protected',
    );
  };
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

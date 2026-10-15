import { createHash, randomUUID } from 'node:crypto';

import { type JobOutbox, type JobOutboxKind, type Prisma } from '@dentabill/db';
import {
  CallJobDataSchema,
  SummaryJobDataSchema,
  type CallJobData,
  type SummaryJobData,
  type JobDispatcher,
} from '@dentabill/queue';

import type { DbClient } from './handler.js';

type OutboxDb = Omit<
  DbClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface EnqueueJobOutboxInput {
  readonly organizationId: string;
  readonly kind: JobOutboxKind;
  readonly data: CallJobData | SummaryJobData;
  readonly availableAt?: Date;
}

/** Call within the transaction that creates the corresponding domain state. */
export async function enqueueJobOutbox(
  db: OutboxDb,
  input: EnqueueJobOutboxInput,
): Promise<JobOutbox> {
  const data =
    input.kind === 'CALL_PLACE'
      ? CallJobDataSchema.parse(input.data)
      : SummaryJobDataSchema.parse(input.data);
  if (data.organizationId !== input.organizationId)
    throw new Error('Outbox organization mismatch.');
  const payload = JSON.stringify(data);
  const payloadHash = hash(payload);
  const where = {
    organizationId: input.organizationId,
    kind: input.kind,
    idempotencyKey: data.idempotencyKey,
  };
  await db.jobOutbox.createMany({
    data: [
      {
        ...where,
        payload: JSON.parse(payload) as Prisma.InputJsonValue,
        payloadHash,
        availableAt: input.availableAt ?? new Date(),
      },
    ],
    skipDuplicates: true,
  });
  const row = await db.jobOutbox.findFirstOrThrow({ where });
  if (row.payloadHash !== payloadHash)
    throw new Error('Outbox key already belongs to a different command.');
  return row;
}

export interface RelayJobOutboxOptions {
  readonly prisma: DbClient;
  readonly jobDispatcher: Pick<JobDispatcher, 'dispatchCall' | 'dispatchSummary'>;
  /** Omit only at a trusted internal sweep boundary, never from a user-supplied trigger. */
  readonly organizationId?: string;
  readonly idempotencyKey?: string;
  readonly limit?: number;
  readonly clock?: () => Date;
  readonly leaseMs?: number;
  readonly sendTimeoutMs?: number;
  readonly budgetMs?: number;
}

export interface RelayJobOutboxResult {
  selected: number;
  sent: number;
  failed: number;
  quarantined: number;
}

class DispatchTimeoutError extends Error {}

/** At-least-once transport delivery. Consumer intent/evidence owns side-effect deduplication. */
export async function relayJobOutbox(
  options: RelayJobOutboxOptions,
): Promise<RelayJobOutboxResult> {
  const clock = options.clock ?? (() => new Date());
  const limit = options.limit ?? 25;
  const sendTimeoutMs = options.sendTimeoutMs ?? 5_000;
  const leaseMs = options.leaseMs ?? 30_000;
  const budgetMs = options.budgetMs ?? 20_000;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    sendTimeoutMs < 1 ||
    leaseMs <= sendTimeoutMs ||
    budgetMs < 1 ||
    !Number.isFinite(leaseMs + sendTimeoutMs + budgetMs)
  ) {
    throw new Error('Invalid outbox relay bounds.');
  }
  if (options.organizationId === '' || (options.idempotencyKey && !options.organizationId)) {
    throw new Error('Outbox key filtering requires an organization.');
  }
  const deadline = Date.now() + budgetMs;
  const ready = (now: Date): Prisma.JobOutboxWhereInput => ({
    state: 'PENDING',
    availableAt: { lte: now },
    OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
  });
  // System sweep: row identifiers are read globally; every claim/update below explicitly scopes its tenant.
  const candidates = await options.prisma.jobOutbox.findMany({
    where: {
      ...ready(clock()),
      ...(options.organizationId && { organizationId: options.organizationId }),
      ...(options.idempotencyKey && { idempotencyKey: options.idempotencyKey }),
    },
    select: { id: true, organizationId: true },
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });
  const result: RelayJobOutboxResult = { selected: 0, sent: 0, failed: 0, quarantined: 0 };
  for (const candidate of candidates) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const now = clock();
    const leaseToken = randomUUID();
    const leased = await options.prisma.jobOutbox.updateMany({
      where: { ...candidate, ...ready(now) },
      data: { leaseToken, leaseExpiresAt: new Date(now.getTime() + leaseMs) },
    });
    if (leased.count !== 1) continue;
    result.selected++;
    const owned = { ...candidate, state: 'PENDING' as const, leaseToken };
    const row = await options.prisma.jobOutbox.findFirst({ where: owned });
    if (!row?.leaseExpiresAt) continue;
    const parsed =
      row.kind === 'CALL_PLACE'
        ? CallJobDataSchema.safeParse(row.payload)
        : SummaryJobDataSchema.safeParse(row.payload);
    let quarantineCode: string | null = null;
    if (
      !parsed.success ||
      parsed.data.organizationId !== row.organizationId ||
      parsed.data.idempotencyKey !== row.idempotencyKey ||
      hash(JSON.stringify(parsed.data)) !== row.payloadHash
    ) {
      quarantineCode = 'PAYLOAD_INVALID';
    } else if (row.deliveryAttempts >= row.deliveryAttemptLimit) {
      quarantineCode = 'DELIVERY_EXHAUSTED';
    }
    if (quarantineCode !== null) {
      const changed = await options.prisma.jobOutbox.updateMany({
        where: owned,
        data: {
          state: 'QUARANTINED',
          lastErrorCode: quarantineCode,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      result.quarantined += changed.count;
      continue;
    }
    if (Date.now() >= deadline || clock() >= row.leaseExpiresAt) {
      await options.prisma.jobOutbox.updateMany({
        where: owned,
        data: { leaseToken: null, leaseExpiresAt: null },
      });
      continue;
    }
    // Persist attempts before sending so repeated crashes are bounded too.
    const attempted = await options.prisma.jobOutbox.updateMany({
      where: { ...owned, leaseExpiresAt: { gt: clock() } },
      data: { deliveryAttempts: { increment: 1 } },
    });
    if (attempted.count !== 1) continue;
    const sendBudgetMs = Math.min(
      sendTimeoutMs,
      deadline - Date.now(),
      row.leaseExpiresAt.getTime() - clock().getTime(),
    );
    if (sendBudgetMs <= 0) {
      await options.prisma.jobOutbox.updateMany({
        where: owned,
        data: { leaseToken: null, leaseExpiresAt: null },
      });
      continue;
    }
    try {
      await withTimeout(async () => {
        const recoveryOptions =
          row.recoveryCount > 0
            ? { transportJobId: `outbox.${row.id}.recovery.${String(row.recoveryCount)}` }
            : undefined;
        if (row.kind === 'CALL_PLACE') {
          const data = CallJobDataSchema.parse(row.payload);
          await options.jobDispatcher.dispatchCall(data, {
            priority: 101 - data.claimPriority,
            ...recoveryOptions,
          });
        } else {
          const data = SummaryJobDataSchema.parse(row.payload);
          if (recoveryOptions) await options.jobDispatcher.dispatchSummary(data, recoveryOptions);
          else await options.jobDispatcher.dispatchSummary(data);
        }
      }, sendBudgetMs);
    } catch (error) {
      const exhausted = row.deliveryAttempts + 1 >= row.deliveryAttemptLimit;
      const changed = await options.prisma.jobOutbox.updateMany({
        where: owned,
        data: {
          state: exhausted ? 'QUARANTINED' : 'PENDING',
          leaseToken: null,
          leaseExpiresAt: null,
          availableAt: new Date(
            clock().getTime() + Math.min(300_000, 1_000 * 2 ** row.deliveryAttempts),
          ),
          lastErrorCode:
            error instanceof DispatchTimeoutError ? 'DISPATCH_TIMEOUT' : 'DISPATCH_FAILED',
        },
      });
      result.failed += changed.count;
      if (exhausted) result.quarantined += changed.count;
      continue;
    }
    // If this write fails, leave the lease to expire: the same command is resent, never fabricated as delivered.
    const completed = await options.prisma.jobOutbox.updateMany({
      where: owned,
      data: {
        state: 'DELIVERED',
        deliveredAt: clock(),
        lastErrorCode: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    result.sent += completed.count;
  }
  return result;
}

function hash(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

async function withTimeout(work: () => Promise<void>, ms: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Timing out is ambiguous: a transport may still accept the command later.
    await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new DispatchTimeoutError('Outbox dispatch timed out.'));
        }, ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

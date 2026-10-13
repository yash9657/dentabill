import {
  previewJobRecovery,
  recoverJobOutbox,
  type JobRecoveryResult,
} from '@dentabill/call-worker';
import { getOrgScopedDb, prisma, Prisma } from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AuthIdentity } from '../../plugins/auth.js';

const DELIVERY_AGE_SECONDS = 300;
const OBSERVATION_AGE_SECONDS = 120;
const DateSchema = z.iso.datetime().nullable();
const StateSchema = z.enum(['PENDING', 'QUARANTINED', 'DELIVERED', 'CLOSED']);
const ErrorSchema = z
  .enum(['PAYLOAD_INVALID', 'DELIVERY_EXHAUSTED', 'DISPATCH_FAILED', 'DISPATCH_TIMEOUT', 'UNKNOWN'])
  .nullable();
const OutboxSchema = z.object({
  id: z.string(),
  kind: z.enum(['CALL_PLACE', 'SUMMARY_GENERATE']),
  state: StateSchema,
  deliveryAttempts: z.number().int(),
  deliveryAttemptLimit: z.number().int(),
  recoveryCount: z.number().int(),
  lastErrorCode: ErrorSchema,
  availableAt: z.iso.datetime(),
  leaseExpiresAt: DateSchema,
  closedAt: DateSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deliveredAt: DateSchema,
});
const PreviewSchema = OutboxSchema.extend({
  reviewVersion: z.string(),
  action: z.enum(['RETRY', 'CLOSE', 'BLOCKED']),
  blockedReason: z
    .enum([
      'NOT_QUARANTINED',
      'ACTIVE_LEASE',
      'PAYLOAD_INVALID',
      'DOMAIN_BINDING_MISMATCH',
      'CLAIM_CHANGED',
      'CLAIM_NOT_QUEUED',
      'CALL_RECONCILIATION_REQUIRED',
      'CALL_OBSERVATION_REQUIRED',
      'SUMMARY_RETRY_UNSAFE',
      'DELIVERY_NOT_EXHAUSTED',
    ])
    .nullable(),
  followUp: z
    .object({
      kind: z.enum(['CALL_RECONCILIATION', 'CALL_OBSERVATION']),
      intentId: z.string(),
      claimId: z.string(),
      callId: z.string().nullable(),
    })
    .nullable(),
});
const OverviewSchema = z.object({
  sampledAt: z.iso.datetime(),
  thresholds: z.object({ deliveryAgeSeconds: z.number(), observationAgeSeconds: z.number() }),
  counts: z.object({
    pending: z.number().int(),
    agedPending: z.number().int(),
    quarantined: z.number().int(),
    acceptedOverdue: z.number().int(),
    observationReview: z.number().int(),
    uncertainCalls: z.number().int(),
    legacyReadyWithoutDelivery: z.number().int(),
  }),
  oldestPendingAt: DateSchema,
  oldestQuarantinedAt: DateSchema,
});
const CallSchema = z.object({
  id: z.string(),
  claimId: z.string(),
  callId: z.string().nullable(),
  state: z.enum(['READY', 'SUBMITTING', 'UNKNOWN', 'ACCEPTED', 'TERMINAL', 'CANCELLED']),
  createdAt: z.iso.datetime(),
  submittedAt: DateSchema,
  callDeadlineAt: DateSchema,
  nextObservationAt: DateSchema,
  observationReviewAt: DateSchema,
  lastObservedAt: DateSchema,
});
const PageQuerySchema = z.object({
  cursor: z.string().min(1).max(1000).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
const OutboxQuerySchema = PageQuerySchema.extend({
  state: StateSchema.default('QUARANTINED'),
}).strict();
const CallsQuerySchema = PageQuerySchema.extend({
  kind: z.enum(['UNCERTAIN', 'OBSERVATION', 'LEGACY_READY']).default('OBSERVATION'),
}).strict();
const IdSchema = z.object({ id: z.string().min(1).max(200) }).strict();
const RecoverSchema = z
  .object({
    action: z.enum(['RETRY', 'CLOSE']),
    reviewVersion: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const CursorSchema = z
  .object({
    createdAt: z.iso.datetime(),
    id: z.string().min(1).max(200),
    filter: z.string(),
  })
  .strict();
const OutboxSelect = {
  id: true,
  kind: true,
  state: true,
  deliveryAttempts: true,
  deliveryAttemptLimit: true,
  recoveryCount: true,
  lastErrorCode: true,
  availableAt: true,
  leaseExpiresAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  deliveredAt: true,
} as const;
const CallSelect = {
  id: true,
  claimId: true,
  callId: true,
  state: true,
  createdAt: true,
  submittedAt: true,
  callDeadlineAt: true,
  nextObservationAt: true,
  observationReviewAt: true,
  lastObservedAt: true,
} as const;
type CallRow = Prisma.CallIntentGetPayload<{ select: typeof CallSelect }>;
type OutboxRow = Prisma.JobOutboxGetPayload<{ select: typeof OutboxSelect }>;
type Cursor = z.infer<typeof CursorSchema>;

function decodeCursor(value: string | undefined, filter: string): Cursor | undefined {
  if (value === undefined) return undefined;
  try {
    const result = CursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (result.filter !== filter) throw new Error('filter');
    return result;
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Refresh this list to load a valid page.');
  }
}

function page<T extends { id: string; createdAt: Date }, U>(
  rows: T[],
  limit: number,
  filter: string,
  project: (row: T) => U,
): { items: U[]; hasMore: boolean; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map(project),
    hasMore,
    nextCursor:
      hasMore && last
        ? Buffer.from(
            JSON.stringify({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
              filter,
            }),
          ).toString('base64url')
        : null,
  };
}

function cursorWhere(cursor: Cursor | undefined): {
  OR?: ({ createdAt: { gt: Date } } | { createdAt: Date; id: { gt: string } })[];
} {
  return cursor
    ? {
        OR: [
          { createdAt: { gt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
        ],
      }
    : {};
}

function outboxResponse(row: OutboxRow): z.infer<typeof OutboxSchema> {
  const error = ErrorSchema.safeParse(row.lastErrorCode);
  return {
    ...row,
    lastErrorCode: error.success ? error.data : 'UNKNOWN',
    availableAt: row.availableAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
  };
}

function callResponse(row: CallRow): z.infer<typeof CallSchema> {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    callDeadlineAt: row.callDeadlineAt?.toISOString() ?? null,
    nextObservationAt: row.nextObservationAt?.toISOString() ?? null,
    observationReviewAt: row.observationReviewAt?.toISOString() ?? null,
    lastObservedAt: row.lastObservedAt?.toISOString() ?? null,
  };
}

function legacyPredicate(orgId: string): Prisma.Sql {
  return Prisma.sql`i."organizationId" = ${orgId} AND i.state = 'READY'
    AND NOT EXISTS (SELECT 1 FROM "JobOutbox" j WHERE j."organizationId" = ${orgId}
      AND j.kind = 'CALL_PLACE' AND j."idempotencyKey" = i."idempotencyKey")`;
}

async function safeRead<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (ApiError.isApiError(error)) throw error;
    throw new ApiError('INTERNAL_ERROR', 'Operations could not be loaded. Please try again.');
  }
}

function recoveryResponse(result: JobRecoveryResult): z.infer<typeof PreviewSchema> {
  if (result.ok) return PreviewSchema.parse(result.preview);
  switch (result.code) {
    case 'FORBIDDEN':
      throw new ApiError('FORBIDDEN', 'Only an owner or admin may review recovery.');
    case 'NOT_FOUND':
      throw new ApiError('NOT_FOUND', 'Delivery not found in your organization.');
    case 'STALE_REVIEW':
      throw new ApiError(
        'CONFLICT',
        'This work changed. Review its latest state before approving again.',
      );
    case 'RECOVERY_BLOCKED':
      throw new ApiError(
        'INVALID_STATE_TRANSITION',
        'This action is unavailable. Refresh the review for the next step.',
      );
    case 'RECOVERY_FAILED':
      throw new ApiError(
        'INTERNAL_ERROR',
        'Recovery could not be saved. Refresh the review before trying again.',
      );
  }
}

function requireIdentity(request: FastifyRequest): AuthIdentity {
  const auth = request.dentabillAuth;
  if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
  return auth;
}

export function operationsRoutes(fastify: FastifyInstance): void {
  const requireAdmin = async (request: FastifyRequest): Promise<void> => {
    await safeRead(async () => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
      const actor = await getOrgScopedDb(auth.orgId).user.findFirst({
        where: { id: auth.userId },
        select: { role: true },
      });
      if (actor?.role !== 'OWNER' && actor?.role !== 'ADMIN')
        throw new ApiError('FORBIDDEN', 'Only an owner or admin may view operations.');
    });
  };
  const preHandler = [fastify.auth.requireAuth, requireAdmin];
  const security = [{ bearer: [] as string[] }];

  fastify.withTypeProvider().get(
    '/operations',
    {
      preHandler,
      schema: { security, querystring: z.object({}).strict(), response: { 200: OverviewSchema } },
    },
    async (request) =>
      safeRead(async () => {
        const orgId = requireIdentity(request).orgId;
        const now = new Date();
        const pending = { organizationId: orgId, state: 'PENDING' as const };
        const quarantined = { organizationId: orgId, state: 'QUARANTINED' as const };
        const accepted = { organizationId: orgId, state: 'ACCEPTED' as const };
        return prisma.$transaction(
          async (tx) => {
            const [
              pendingCount,
              agedPending,
              quarantinedCount,
              acceptedOverdue,
              observationReview,
              uncertainCalls,
              legacy,
              oldestPending,
              oldestQuarantined,
            ] = await Promise.all([
              tx.jobOutbox.count({ where: pending }),
              tx.jobOutbox.count({
                where: {
                  ...pending,
                  availableAt: { lte: new Date(now.getTime() - DELIVERY_AGE_SECONDS * 1000) },
                },
              }),
              tx.jobOutbox.count({ where: quarantined }),
              tx.callIntent.count({ where: { ...accepted, callDeadlineAt: { lte: now } } }),
              tx.callIntent.count({ where: { ...accepted, observationReviewAt: { not: null } } }),
              tx.callIntent.count({
                where: { organizationId: orgId, state: { in: ['UNKNOWN', 'SUBMITTING'] } },
              }),
              tx.$queryRaw<{ count: bigint }[]>(
                Prisma.sql`SELECT COUNT(*) AS count FROM "CallIntent" i WHERE ${legacyPredicate(orgId)}`,
              ),
              tx.jobOutbox.findFirst({
                where: { ...pending, availableAt: { lte: now } },
                orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
                select: { availableAt: true },
              }),
              tx.jobOutbox.findFirst({
                where: quarantined,
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                select: { createdAt: true },
              }),
            ]);
            return {
              sampledAt: now.toISOString(),
              thresholds: {
                deliveryAgeSeconds: DELIVERY_AGE_SECONDS,
                observationAgeSeconds: OBSERVATION_AGE_SECONDS,
              },
              counts: {
                pending: pendingCount,
                agedPending,
                quarantined: quarantinedCount,
                acceptedOverdue,
                observationReview,
                uncertainCalls,
                legacyReadyWithoutDelivery: Number(legacy[0]?.count ?? 0n),
              },
              oldestPendingAt: oldestPending?.availableAt.toISOString() ?? null,
              oldestQuarantinedAt: oldestQuarantined?.createdAt.toISOString() ?? null,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
        );
      }),
  );

  fastify.withTypeProvider().get(
    '/operations/outbox',
    {
      preHandler,
      schema: {
        security,
        querystring: OutboxQuerySchema,
        response: {
          200: z.object({
            items: z.array(OutboxSchema),
            nextCursor: z.string().nullable(),
            hasMore: z.boolean(),
          }),
        },
      },
    },
    async (request) =>
      safeRead(async () => {
        const query = request.query as z.infer<typeof OutboxQuerySchema>;
        const cursor = decodeCursor(query.cursor, query.state);
        const rows = await getOrgScopedDb(requireIdentity(request).orgId).jobOutbox.findMany({
          where: { state: query.state, ...cursorWhere(cursor) },
          select: OutboxSelect,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: query.limit + 1,
        });
        return page(rows, query.limit, query.state, outboxResponse);
      }),
  );

  fastify.withTypeProvider().get(
    '/operations/calls',
    {
      preHandler,
      schema: {
        security,
        querystring: CallsQuerySchema,
        response: {
          200: z.object({
            items: z.array(CallSchema),
            nextCursor: z.string().nullable(),
            hasMore: z.boolean(),
          }),
        },
      },
    },
    async (request) =>
      safeRead(async () => {
        const query = request.query as z.infer<typeof CallsQuerySchema>;
        const orgId = requireIdentity(request).orgId;
        const cursor = decodeCursor(query.cursor, query.kind);
        let rows: CallRow[];
        if (query.kind === 'LEGACY_READY') {
          const after = cursor
            ? Prisma.sql`AND (i."createdAt" > ${new Date(cursor.createdAt)} OR
        (i."createdAt" = ${new Date(cursor.createdAt)} AND i.id > ${cursor.id}))`
            : Prisma.empty;
          rows = await prisma.$queryRaw<CallRow[]>(Prisma.sql`
        SELECT i.id, i."claimId", i."callId", i.state, i."createdAt", i."submittedAt",
          i."callDeadlineAt", i."nextObservationAt", i."observationReviewAt", i."lastObservedAt"
        FROM "CallIntent" i WHERE ${legacyPredicate(orgId)} ${after}
        ORDER BY i."createdAt" ASC, i.id ASC LIMIT ${query.limit + 1}`);
        } else {
          const now = new Date();
          const filter: Prisma.CallIntentWhereInput =
            query.kind === 'UNCERTAIN'
              ? { state: { in: ['UNKNOWN', 'SUBMITTING'] } }
              : {
                  state: 'ACCEPTED',
                  OR: [
                    { callDeadlineAt: { lte: now } },
                    { observationReviewAt: { not: null } },
                    { nextObservationAt: null },
                    {
                      nextObservationAt: {
                        lte: new Date(now.getTime() - OBSERVATION_AGE_SECONDS * 1000),
                      },
                    },
                  ],
                };
          rows = await getOrgScopedDb(orgId).callIntent.findMany({
            where: { AND: [filter, cursorWhere(cursor)] },
            select: CallSelect,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: query.limit + 1,
          });
        }
        return page(rows, query.limit, query.kind, callResponse);
      }),
  );

  fastify.withTypeProvider().get(
    '/operations/outbox/:id',
    {
      preHandler,
      schema: { security, params: IdSchema, response: { 200: PreviewSchema } },
    },
    async (request) =>
      safeRead(async () => {
        const auth = requireIdentity(request);
        return recoveryResponse(
          await previewJobRecovery({
            prisma,
            organizationId: auth.orgId,
            clerkUserId: auth.clerkUserId,
            outboxId: (request.params as z.infer<typeof IdSchema>).id,
          }),
        );
      }),
  );

  fastify.withTypeProvider().post(
    '/operations/outbox/:id/recover',
    {
      preHandler,
      config: {
        rateLimit: {
          hook: 'preHandler',
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: (request): string => request.dentabillAuth?.orgId ?? request.ip,
        },
      },
      schema: { security, params: IdSchema, body: RecoverSchema, response: { 200: PreviewSchema } },
    },
    async (request) =>
      safeRead(async () => {
        const auth = requireIdentity(request);
        const body = request.body as z.infer<typeof RecoverSchema>;
        return recoveryResponse(
          await recoverJobOutbox({
            prisma,
            organizationId: auth.orgId,
            clerkUserId: auth.clerkUserId,
            outboxId: (request.params as z.infer<typeof IdSchema>).id,
            ...body,
          }),
        );
      }),
  );
}

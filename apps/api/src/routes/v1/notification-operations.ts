import { audit, prisma, Prisma } from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

const STATES = [
  'PENDING',
  'SENDING',
  'SIMULATED',
  'ACCEPTED',
  'BLOCKED',
  'QUARANTINED',
  'SUPPRESSED',
] as const;
const StateSchema = z.enum(STATES);
const ReasonSchema = z
  .enum([
    'MISSING_RECIPIENT',
    'RECIPIENT_CHANGED',
    'SOURCE_NOT_READY',
    'SOURCE_REVIEWED',
    'SOURCE_SUPERSEDED',
    'SOURCE_CHANGED',
    'DEADLINE_EXPIRED',
    'ATTEMPTS_EXHAUSTED',
    'TRANSPORT_UNKNOWN',
    'TRANSPORT_RETRYABLE',
    'IDEMPOTENCY_CONFLICT',
    'PAYLOAD_INVALID',
    'TRANSPORT_REJECTED',
    'LEASE_EXPIRED',
    'UNKNOWN',
  ])
  .nullable();
const DateSchema = z.iso.datetime().nullable();
const RowSchema = z.object({
  id: z.string(),
  purpose: z.enum(['REVIEW_AVAILABLE', 'INFERENCE_REVIEW_REQUIRED']),
  state: StateSchema,
  reason: ReasonSchema,
  recipientBinding: z.enum(['BOUND', 'MISSING', 'CHANGED']),
  generation: z.number().int().positive(),
  templateVersion: z.literal('review-available.v1'),
  claimId: z.string(),
  callId: z.string(),
  inferenceRunId: z.string(),
  observationId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  availableAt: z.iso.datetime(),
  ageSeconds: z.number().int().nonnegative(),
  attemptCount: z.number().int().nonnegative(),
  firstSubmissionAt: DateSchema,
  retryDeadlineAt: DateSchema,
  leaseExpiresAt: DateSchema,
  ambiguous: z.boolean(),
});
const PageSchema = z.object({
  sampledAt: z.iso.datetime(),
  deliveryMode: z.literal('DISABLED'),
  counts: z.object({
    pending: z.number().int().nonnegative(),
    sending: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    quarantined: z.number().int().nonnegative(),
    simulated: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    suppressed: z.number().int().nonnegative(),
    agedPending: z.number().int().nonnegative(),
  }),
  items: z.array(RowSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
const DetailSchema = z.object({
  sampledAt: z.iso.datetime(),
  deliveryMode: z.literal('DISABLED'),
  notification: RowSchema,
  attempts: z.array(
    z.object({
      id: z.string(),
      attemptNumber: z.number().int().positive(),
      mode: z.literal('SYNTHETIC'),
      startedAt: z.iso.datetime(),
      leaseExpiresAt: z.iso.datetime(),
      receipt: z
        .object({
          outcome: z.enum(['SIMULATED', 'ACCEPTED', 'UNKNOWN', 'RETRYABLE', 'CONFLICT']),
          code: ReasonSchema,
          completedAt: z.iso.datetime(),
          acceptedAt: DateSchema,
        })
        .nullable(),
    }),
  ),
});
const QuerySchema = z
  .object({
    state: z.enum(['ALL', ...STATES]).default('ALL'),
    limit: z.coerce.number().int().positive().max(50).default(20),
    cursor: z.string().min(1).max(1000).optional(),
  })
  .strict();
const ParamsSchema = z.object({ id: z.uuid() }).strict();
const CursorSchema = z
  .object({
    organizationId: z.string().min(1).max(200),
    state: z.enum(['ALL', ...STATES]),
    createdAt: z.iso.datetime(),
    id: z.uuid(),
  })
  .strict();
const IntentSelect = {
  id: true,
  organizationId: true,
  purpose: true,
  generation: true,
  templateVersion: true,
  claimId: true,
  callId: true,
  inferenceRunId: true,
  observationId: true,
  createdAt: true,
  recipientUserId: true,
  recipientRole: true,
  recipientEmail: true,
  recipient: { select: { id: true, organizationId: true, role: true, email: true } },
  delivery: {
    select: {
      state: true,
      reason: true,
      availableAt: true,
      updatedAt: true,
      attemptCount: true,
      firstSubmissionAt: true,
      retryDeadlineAt: true,
      leaseExpiresAt: true,
      ambiguous: true,
    },
  },
} as const;
type IntentRow = Prisma.ReviewNotificationIntentGetPayload<{ select: typeof IntentSelect }>;
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function safeReason(value: string | null): z.infer<typeof ReasonSchema> {
  const parsed = ReasonSchema.safeParse(value);
  return parsed.success ? parsed.data : 'UNKNOWN';
}

function project(row: IntentRow, now: Date): z.infer<typeof RowSchema> {
  if (!row.delivery) throw new Error('NOTIFICATION_DELIVERY_MISSING');
  const recipientBinding = !row.recipientUserId
    ? 'MISSING'
    : row.recipient?.id === row.recipientUserId &&
        row.recipient.organizationId === row.organizationId &&
        row.recipient.role === row.recipientRole &&
        row.recipient.email === row.recipientEmail &&
        ['OWNER', 'ADMIN'].includes(row.recipient.role)
      ? 'BOUND'
      : 'CHANGED';
  return RowSchema.parse({
    id: row.id,
    purpose: row.purpose,
    state: row.delivery.state,
    reason: safeReason(row.delivery.reason),
    recipientBinding,
    generation: row.generation,
    templateVersion: row.templateVersion,
    claimId: row.claimId,
    callId: row.callId,
    inferenceRunId: row.inferenceRunId,
    observationId: row.observationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.delivery.updatedAt.toISOString(),
    availableAt: row.delivery.availableAt.toISOString(),
    ageSeconds: Math.max(0, Math.floor((now.getTime() - row.createdAt.getTime()) / 1000)),
    attemptCount: row.delivery.attemptCount,
    firstSubmissionAt: row.delivery.firstSubmissionAt?.toISOString() ?? null,
    retryDeadlineAt: row.delivery.retryDeadlineAt?.toISOString() ?? null,
    leaseExpiresAt: row.delivery.leaseExpiresAt?.toISOString() ?? null,
    ambiguous: row.delivery.ambiguous,
  });
}

async function read<T>(
  request: FastifyRequest,
  run: (tx: Tx, orgId: string, userId: string) => Promise<T>,
): Promise<T> {
  try {
    const auth = request.dentabillAuth;
    if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
    return await prisma.$transaction(
      async (tx) => {
        const actor = await tx.user.findFirst({
          where: { id: auth.userId, organizationId: auth.orgId },
          select: { id: true, role: true },
        });
        if (actor?.role !== 'OWNER' && actor?.role !== 'ADMIN')
          throw new ApiError('FORBIDDEN', 'Only an owner or admin may view notifications.');
        return run(tx, auth.orgId, actor.id);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  } catch (error) {
    if (ApiError.isApiError(error)) throw error;
    throw new ApiError('INTERNAL_ERROR', 'Notifications could not be loaded. Please try again.');
  }
}

export function notificationOperationsRoutes(fastify: FastifyInstance): void {
  const preHandler = [fastify.auth.requireAuth];
  const security = [{ bearer: [] as string[] }];
  fastify.withTypeProvider().get(
    '/operations/notifications',
    {
      preHandler,
      schema: { security, querystring: QuerySchema, response: { 200: PageSchema } },
    },
    async (request) =>
      read(request, async (tx, organizationId, userId) => {
        const query = request.query as z.infer<typeof QuerySchema>;
        let cursor: z.infer<typeof CursorSchema> | undefined;
        if (query.cursor) {
          try {
            cursor = CursorSchema.parse(
              JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
            );
            if (cursor.organizationId !== organizationId || cursor.state !== query.state)
              throw new Error('CURSOR_SCOPE');
          } catch {
            throw new ApiError('VALIDATION_ERROR', 'Refresh notifications to load a valid page.');
          }
        }
        const now = new Date();
        const [rows, stateCounts, agedPending] = await Promise.all([
          tx.reviewNotificationIntent.findMany({
            where: {
              organizationId,
              ...(query.state === 'ALL' ? {} : { delivery: { is: { state: query.state } } }),
              ...(cursor
                ? {
                    OR: [
                      { createdAt: { gt: new Date(cursor.createdAt) } },
                      { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
                    ],
                  }
                : {}),
            },
            select: IntentSelect,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: query.limit + 1,
          }),
          Promise.all(
            STATES.map((state) =>
              tx.reviewNotificationDelivery.count({ where: { organizationId, state } }),
            ),
          ),
          tx.reviewNotificationDelivery.count({
            where: {
              organizationId,
              state: 'PENDING',
              availableAt: { lte: new Date(now.getTime() - 300_000) },
            },
          }),
        ]);
        const [
          pending = 0,
          sending = 0,
          simulated = 0,
          accepted = 0,
          blocked = 0,
          quarantined = 0,
          suppressed = 0,
        ] = stateCounts;
        const counts = {
          pending,
          sending,
          simulated,
          accepted,
          blocked,
          quarantined,
          suppressed,
          agedPending,
        };
        const items = rows.slice(0, query.limit);
        const hasMore = rows.length > query.limit;
        const last = items.at(-1);
        await audit(
          {
            organizationId,
            userId,
            action: 'notification.operations_read',
            resourceType: 'ReviewNotificationIntent',
            resourceId: organizationId,
            metadata: { operation: 'LIST', state: query.state, count: items.length },
          },
          tx,
        );
        return PageSchema.parse({
          sampledAt: now.toISOString(),
          deliveryMode: 'DISABLED',
          counts,
          items: items.map((row) => project(row, now)),
          hasMore,
          nextCursor:
            hasMore && last
              ? Buffer.from(
                  JSON.stringify({
                    organizationId,
                    state: query.state,
                    createdAt: last.createdAt.toISOString(),
                    id: last.id,
                  }),
                ).toString('base64url')
              : null,
        });
      }),
  );
  fastify.withTypeProvider().get(
    '/operations/notifications/:id',
    {
      preHandler,
      schema: {
        security,
        params: ParamsSchema,
        querystring: z.object({}).strict(),
        response: { 200: DetailSchema },
      },
    },
    async (request) =>
      read(request, async (tx, organizationId, userId) => {
        const { id } = request.params as z.infer<typeof ParamsSchema>;
        const row = await tx.reviewNotificationIntent.findFirst({
          where: { organizationId, id },
          select: IntentSelect,
        });
        if (!row) throw new ApiError('NOT_FOUND', 'Notification not found in your organization.');
        const attempts = await tx.reviewNotificationAttempt.findMany({
          where: { organizationId, notificationId: id },
          orderBy: { attemptNumber: 'asc' },
          take: 5,
          select: {
            id: true,
            attemptNumber: true,
            mode: true,
            startedAt: true,
            leaseExpiresAt: true,
            receipt: { select: { outcome: true, code: true, completedAt: true, acceptedAt: true } },
          },
        });
        const now = new Date();
        await audit(
          {
            organizationId,
            userId,
            action: 'notification.operations_read',
            resourceType: 'ReviewNotificationIntent',
            resourceId: id,
            metadata: { operation: 'DETAIL', attemptCount: attempts.length },
          },
          tx,
        );
        return DetailSchema.parse({
          sampledAt: now.toISOString(),
          deliveryMode: 'DISABLED',
          notification: project(row, now),
          attempts: attempts.map((attempt) => ({
            ...attempt,
            startedAt: attempt.startedAt.toISOString(),
            leaseExpiresAt: attempt.leaseExpiresAt.toISOString(),
            receipt: attempt.receipt
              ? {
                  outcome: attempt.receipt.outcome,
                  code: safeReason(attempt.receipt.code),
                  completedAt: attempt.receipt.completedAt.toISOString(),
                  acceptedAt: attempt.receipt.acceptedAt?.toISOString() ?? null,
                }
              : null,
          })),
        });
      }),
  );
}

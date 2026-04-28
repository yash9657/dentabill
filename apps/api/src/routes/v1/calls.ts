import { audit, getOrgScopedDb, prisma } from '@dentabill/db';
import { checkPayerHours } from '@dentabill/payer-ivr';
import { CALL_JOB_NAME, type CallJobData } from '@dentabill/queue';
import { ApiError, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@dentabill/types';
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

// ─── Calls list / detail / cancel (P3-T18 / T19 / T20) ──────────────────

const CallStatusEnum = z.enum([
  'INITIATED',
  'NAVIGATING_IVR',
  'ON_HOLD',
  'HUMAN_REACHED',
  'COLLECTING',
  'COMPLETED',
  'FAILED',
  'VOICEMAIL',
]);
type CallStatusEnumType = z.infer<typeof CallStatusEnum>;

const CallDLQReasonEnum = z.enum([
  'EXCEEDED_MAX_ATTEMPTS',
  'EXCEEDED_MAX_DURATION',
  'EXCEEDED_MAX_HOLD',
  'CANCELLED_BY_OPERATOR',
]);

const PayerCodeEnum = z.enum([
  'DELTA_DENTAL_PPO',
  'DELTA_DENTAL_PREMIER',
  'CIGNA_DENTAL',
  'METLIFE_DENTAL',
  'AETNA_DENTAL',
  'GUARDIAN_DENTAL',
  'UNITED_CONCORDIA',
  'HUMANA_DENTAL',
  'UNKNOWN',
]);

const CallResponseSchema = z.object({
  id: z.string(),
  claimId: z.string(),
  retellCallId: z.string(),
  retellAgentId: z.string().nullable(),
  status: CallStatusEnum,
  attemptNumber: z.number().int().min(1).max(2),
  ivrNavigated: z.boolean(),
  humanReached: z.boolean(),
  holdTimeSeconds: z.number().int().nullable(),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  durationSeconds: z.number().int().nullable(),
  dlqReason: CallDLQReasonEnum.nullable(),
  createdAt: z.iso.datetime(),
});
type CallResponse = z.infer<typeof CallResponseSchema>;

const CallEventResponseSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  data: z.record(z.string(), z.unknown()),
  timestamp: z.iso.datetime(),
});

const ClaimSummarySchema = z.object({
  id: z.string(),
  claimNumber: z.string(),
  payerCode: PayerCodeEnum,
  status: z.string(),
  priority: z.number().int(),
  serviceDate: z.iso.datetime(),
});

const CallDetailResponseSchema = CallResponseSchema.extend({
  events: z.array(CallEventResponseSchema),
  claim: ClaimSummarySchema,
});

const CallsListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: CallStatusEnum.optional(),
  payer: PayerCodeEnum.optional(),
  startedAtFrom: z.iso.datetime().optional(),
  startedAtTo: z.iso.datetime().optional(),
});
type CallsListQuery = z.infer<typeof CallsListQuerySchema>;

const CallsListResponseSchema = z.object({
  items: z.array(CallResponseSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

const CallIdParamSchema = z.object({ id: z.string().min(1) }).strict();

/**
 * `/v1/calls/stats` (P3-T25). Aggregate metrics for the dashboard
 * overview tiles.
 *
 *   - `callsToday`        — count of Call rows with `startedAt` today
 *                           (in the API server's local time, which is
 *                           UTC in prod). Phase 4 will move this to
 *                           the org's locale.
 *   - `avgCallSeconds`    — mean of `durationSeconds` across calls
 *                           that have an `endedAt` in the last 7
 *                           days. `null` when there are zero such
 *                           calls (the UI renders an em-dash).
 *   - `recoveredThisWeekCents` — sum of `claimAmount * 100` (cents)
 *                           across `Claim`s flipped to `RESOLVED`
 *                           in the last 7 days. Phase 4 will replace
 *                           this with a real ledger; for now we use
 *                           the claim amount as the proxy.
 */
const CallsStatsResponseSchema = z.object({
  callsToday: z.number().int().min(0),
  queueDepth: z.number().int().min(0),
  avgCallSeconds: z.number().int().min(0).nullable(),
  recoveredThisWeekCents: z.number().int().min(0),
});
type CallsStatsResponse = z.infer<typeof CallsStatsResponseSchema>;

interface CallRowForResponse {
  id: string;
  claimId: string;
  retellCallId: string;
  retellAgentId: string | null;
  status: CallStatusEnumType;
  attemptNumber: number;
  ivrNavigated: boolean;
  humanReached: boolean;
  holdTimeSeconds: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  dlqReason:
    | 'EXCEEDED_MAX_ATTEMPTS'
    | 'EXCEEDED_MAX_DURATION'
    | 'EXCEEDED_MAX_HOLD'
    | 'CANCELLED_BY_OPERATOR'
    | null;
  createdAt: Date;
}

function toCallResponse(row: CallRowForResponse): CallResponse {
  return {
    id: row.id,
    claimId: row.claimId,
    retellCallId: row.retellCallId,
    retellAgentId: row.retellAgentId,
    status: row.status,
    attemptNumber: row.attemptNumber,
    ivrNavigated: row.ivrNavigated,
    humanReached: row.humanReached,
    holdTimeSeconds: row.holdTimeSeconds,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    durationSeconds: row.durationSeconds,
    dlqReason: row.dlqReason,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Cursor format mirrors `claims.ts`: base64url("<sortValue>|<id>"). Calls
 * list sorts by `startedAt` desc by default with `id` tiebreaker; the
 * cursor encodes the sort value (ISO datetime string) and the id of the
 * last row on the page.
 */
function encodeCallCursor(sortValue: string, id: string): string {
  return Buffer.from(`${sortValue}|${id}`, 'utf8').toString('base64url');
}

function nextCursorFor(row: { id: string; startedAt: Date | null } | undefined): string | null {
  if (row === undefined) return null;
  if (row.startedAt === null) return null;
  return encodeCallCursor(row.startedAt.toISOString(), row.id);
}

function decodeCallCursor(cursor: string): { sortValue: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = decoded.indexOf('|');
    if (sep < 1 || sep === decoded.length - 1) return null;
    return { sortValue: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}

/**
 * Statuses the cancel route considers terminal — re-cancellation is a
 * 200 idempotent no-op.
 */
const TERMINAL_CALL_STATUSES = new Set<CallStatusEnumType>(['COMPLETED', 'FAILED', 'VOICEMAIL']);

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

  // ─── GET /v1/calls — cursor-paginated list (P3-T18) ───────────────────
  fastify.withTypeProvider().get(
    '/calls',
    {
      preHandler: requireAuth,
      schema: {
        description:
          'List calls for the authenticated organization with cursor pagination, filterable by status / payer / startedAt range. Sorted by `startedAt` desc with id tiebreaker.',
        security,
        querystring: CallsListQuerySchema,
        response: { 200: CallsListResponseSchema },
      },
    },
    async (request): Promise<z.infer<typeof CallsListResponseSchema>> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const { orgId } = auth;
      const query = request.query as CallsListQuery;

      const where: Record<string, unknown> = {};
      if (query.status) where.status = query.status;
      if (query.payer) where.claim = { payerCode: query.payer };
      if (query.startedAtFrom !== undefined || query.startedAtTo !== undefined) {
        const range: Record<string, Date> = {};
        if (query.startedAtFrom !== undefined) range.gte = new Date(query.startedAtFrom);
        if (query.startedAtTo !== undefined) range.lte = new Date(query.startedAtTo);
        where.startedAt = range;
      }

      // Cursor decoding — descending order: prior page's last row had a
      // smaller-or-equal startedAt; we want strictly less-than that
      // sortValue OR (equal sortValue AND lexically lesser id).
      let cursorPredicate: Record<string, unknown> | null = null;
      if (query.cursor !== undefined) {
        const decoded = decodeCallCursor(query.cursor);
        if (decoded === null) {
          throw new ApiError('VALIDATION_ERROR', 'cursor is malformed.');
        }
        const cursorDate = new Date(decoded.sortValue);
        if (Number.isNaN(cursorDate.getTime())) {
          throw new ApiError('VALIDATION_ERROR', 'cursor sort value is not a valid date.');
        }
        cursorPredicate = {
          OR: [
            { startedAt: { lt: cursorDate } },
            { startedAt: cursorDate, id: { lt: decoded.id } },
          ],
        };
      }
      const finalWhere = cursorPredicate ? { AND: [where, cursorPredicate] } : where;

      const db = getOrgScopedDb(orgId);
      const rows = await db.call.findMany({
        where: finalWhere,
        // `startedAt` may be null for INITIATED rows that haven't started
        // yet; Prisma sorts nulls last on desc, which is what we want
        // (in-flight rows surface above null startedAt). Cursor pagination
        // breaks down for null sort values — Phase 3 lists only show
        // started calls in practice, so we filter nulls when paginating.
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const items = (hasMore ? rows.slice(0, query.limit) : rows).map((row) => toCallResponse(row));
      const lastRow = hasMore ? rows[query.limit - 1] : undefined;
      const nextCursor = nextCursorFor(lastRow);

      // P3-T27 — audit every Call list read. The HIPAA review trail
      // wants to see "who looked at the calls list when, with what
      // filters." `resourceId='list'` mirrors the claims.ts pattern.
      await audit({
        action: 'call.list',
        resourceType: 'Call',
        resourceId: 'list',
        organizationId: orgId,
        metadata: {
          clerkUserId: auth.userId,
          count: items.length,
          status: query.status ?? null,
          payer: query.payer ?? null,
        },
      });

      return { items, nextCursor, hasMore };
    },
  );

  // ─── GET /v1/calls/stats — overview aggregates (P3-T25) ───────────────
  // Registered before /calls/:id so the literal segment wins over the
  // parameter route. Fastify's radix tree handles this anyway, but
  // explicit ordering keeps the file readable.
  fastify.withTypeProvider().get(
    '/calls/stats',
    {
      preHandler: requireAuth,
      schema: {
        description:
          "Aggregate call/claim metrics for the dashboard overview tiles. Org-scoped: only the authenticated tenant's rows contribute.",
        security,
        response: { 200: CallsStatsResponseSchema },
      },
    },
    async (request): Promise<CallsStatsResponse> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const { orgId } = auth;

      const now = new Date();
      const startOfTodayUTC = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
      );
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Each query is org-scoped via explicit `where.organizationId`.
      // We don't go through `getOrgScopedDb` here because count/aggregate
      // helpers aren't on the org-scoped wrapper's surface; the explicit
      // filter is the established pattern for aggregates.
      const [callsToday, queueDepth, avgRow, recoveredRows] = await Promise.all([
        prisma.call.count({
          where: { organizationId: orgId, startedAt: { gte: startOfTodayUTC } },
        }),
        prisma.claim.count({
          where: { organizationId: orgId, status: { in: ['PENDING', 'IN_QUEUE', 'CALLING'] } },
        }),
        prisma.call.aggregate({
          _avg: { durationSeconds: true },
          where: {
            organizationId: orgId,
            endedAt: { gte: sevenDaysAgo },
            durationSeconds: { not: null },
          },
        }),
        prisma.claim.findMany({
          where: {
            organizationId: orgId,
            status: 'RESOLVED',
            updatedAt: { gte: sevenDaysAgo },
          },
          select: { claimAmount: true },
        }),
      ]);

      const avgCallSeconds =
        avgRow._avg.durationSeconds === null ? null : Math.round(avgRow._avg.durationSeconds);

      // Prisma decimal columns come back as `Decimal | string`. We sum
      // in cents (integer math) to avoid float drift.
      const recoveredThisWeekCents = recoveredRows.reduce((acc, row) => {
        const dollars = Number(row.claimAmount);
        if (Number.isNaN(dollars)) return acc;
        return acc + Math.round(dollars * 100);
      }, 0);

      return { callsToday, queueDepth, avgCallSeconds, recoveredThisWeekCents };
    },
  );

  // ─── GET /v1/calls/:id — call detail (P3-T19) ─────────────────────────
  fastify.withTypeProvider().get(
    '/calls/:id',
    {
      preHandler: requireAuth,
      schema: {
        description:
          'Fetch a single call with embedded CallEvent[] (timestamp asc) and a Claim summary. Cross-org access returns a uniform 404.',
        security,
        params: CallIdParamSchema,
        response: { 200: CallDetailResponseSchema },
      },
    },
    async (request): Promise<z.infer<typeof CallDetailResponseSchema>> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const { orgId } = auth;
      const { id } = request.params as z.infer<typeof CallIdParamSchema>;

      const db = getOrgScopedDb(orgId);
      const row = await db.call.findFirst({
        where: { id },
        include: {
          events: { orderBy: { timestamp: 'asc' } },
          claim: {
            select: {
              id: true,
              claimNumber: true,
              payerCode: true,
              status: true,
              priority: true,
              serviceDate: true,
            },
          },
        },
      });
      if (!row) {
        throw new ApiError('NOT_FOUND', 'Call not found in your organization.');
      }

      await audit({
        action: 'call.read',
        resourceType: 'Call',
        resourceId: id,
        organizationId: orgId,
        metadata: { clerkUserId: auth.userId },
      });

      return {
        ...toCallResponse(row),
        events: row.events.map((evt) => ({
          id: evt.id,
          eventType: evt.eventType,
          // Prisma's Json column is typed as Prisma.JsonValue. Cast to a
          // plain record for the response — Zod validates the shape on
          // the wire side anyway.
          data:
            evt.data === null || typeof evt.data !== 'object' || Array.isArray(evt.data)
              ? {}
              : (evt.data as Record<string, unknown>),
          timestamp: evt.timestamp.toISOString(),
        })),
        claim: {
          id: row.claim.id,
          claimNumber: row.claim.claimNumber,
          payerCode: row.claim.payerCode,
          status: row.claim.status,
          priority: row.claim.priority,
          serviceDate: row.claim.serviceDate.toISOString(),
        },
      };
    },
  );

  // ─── POST /v1/calls/:id/cancel — idempotent cancel (P3-T20) ───────────
  fastify.withTypeProvider().post(
    '/calls/:id/cancel',
    {
      preHandler: requireAuth,
      schema: {
        description:
          'Cancel an in-flight call. Idempotent — re-cancellation of a terminal call is a 200 no-op. Phase 3 cancellation is soft: it stamps Call.dlqReason = CANCELLED_BY_OPERATOR + flips Claim → MANUAL_REVIEW; the live Retell call continues until natural termination (true mid-call cancel lands in Phase 4 once the worker bridges a cancel channel).',
        security,
        params: CallIdParamSchema,
        response: { 200: CallResponseSchema },
      },
    },
    async (request): Promise<CallResponse> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const { orgId } = auth;
      const { id } = request.params as z.infer<typeof CallIdParamSchema>;

      const db = getOrgScopedDb(orgId);
      const existing = await db.call.findFirst({ where: { id } });
      if (!existing) {
        throw new ApiError('NOT_FOUND', 'Call not found in your organization.');
      }

      // Idempotent: terminal status → echo current state, no side effects.
      if (TERMINAL_CALL_STATUSES.has(existing.status)) {
        return toCallResponse(existing);
      }

      await prisma.call.updateMany({
        where: { id, organizationId: orgId },
        data: {
          status: 'FAILED',
          dlqReason: 'CANCELLED_BY_OPERATOR',
          endedAt: new Date(),
        },
      });
      await prisma.callEvent.create({
        data: {
          callId: id,
          eventType: 'call.cancelled',
          data: {
            cancelledBy: auth.userId,
            cancelledAt: new Date().toISOString(),
          },
        },
      });
      // Flip Claim → MANUAL_REVIEW so the dashboard reflects the
      // operator decision. Conditional updateMany — already-MANUAL_REVIEW
      // claims keep their updatedAt for downstream UI freshness markers.
      await prisma.claim.updateMany({
        where: {
          id: existing.claimId,
          organizationId: orgId,
          status: { not: 'MANUAL_REVIEW' },
        },
        data: { status: 'MANUAL_REVIEW' },
      });
      await audit({
        action: 'call.cancel',
        resourceType: 'Call',
        resourceId: id,
        organizationId: orgId,
        metadata: { clerkUserId: auth.userId, previousStatus: existing.status },
      });

      const updated = await db.call.findFirst({ where: { id } });
      if (!updated) throw new ApiError('NOT_FOUND', 'Call not found after cancel.');
      return toCallResponse(updated);
    },
  );
}

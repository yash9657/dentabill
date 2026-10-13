import { randomUUID } from 'node:crypto';

import { enqueueJobOutbox, relayJobOutbox } from '@dentabill/call-worker';
import {
  audit,
  type CallIntent,
  getOrgScopedDb,
  parseFireworksRawResponse,
  prisma,
  type Prisma,
} from '@dentabill/db';
import { checkPayerHours, validateCallIdentity } from '@dentabill/payer-ivr';
import type { CallJobData, SummaryJobData } from '@dentabill/queue';
import { ApiError, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requestCallCancellation } from '../../lib/cancel-call.js';
import { payerHoursOverridden } from '../../lib/env.js';
import {
  unavailableVerifiedPayments,
  VerifiedPaymentsSchema,
} from '../../lib/financial-reporting.js';

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

const CallMonitoringSchema = z.object({
  deadlineAt: z.iso.datetime().nullable(),
  nextObservationAt: z.iso.datetime().nullable(),
  stopRequestedAt: z.iso.datetime().nullable(),
  stopAcknowledgedAt: z.iso.datetime().nullable(),
  reviewRequiredAt: z.iso.datetime().nullable(),
  lastCheckedAt: z.iso.datetime().nullable(),
  lastErrorCode: z.string().nullable(),
});
const OBSERVATION_ERROR_CODES = new Set([
  'PROVIDER_LOOKUP_UNAVAILABLE',
  'PROVIDER_LOOKUP_FAILED',
  'PROVIDER_IDENTITY_MISMATCH',
  'INVALID_REQUEST_SNAPSHOT',
  'STOP_UNAVAILABLE',
  'STOP_FAILED',
  'STOP_CONFIRMATION_EXPIRED',
  'STOP_ATTEMPTS_EXHAUSTED',
  'OBSERVATION_FAILED',
]);
const MONITORING_SELECT = {
  callDeadlineAt: true,
  nextObservationAt: true,
  stopRequestedAt: true,
  stopAcknowledgedAt: true,
  observationReviewAt: true,
  lastObservedAt: true,
  observationErrorCode: true,
} as const;
type MonitoringRow = Pick<CallIntent, keyof typeof MONITORING_SELECT>;

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
  cancelRequestedAt: z.iso.datetime().nullable(),
  monitoring: CallMonitoringSchema.nullable(),
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
  // Filter to a single claim's call history. Org scoping is still
  // enforced by `getOrgScopedDb` — passing another tenant's claimId
  // returns an empty list, never another tenant's calls.
  claimId: z.string().min(1).optional(),
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

// ─── Phase-4 summary surfaces (P4-T2H) ────────────────────────────────────

const NextActionEnum = z.enum([
  'RESUBMIT',
  'APPEAL',
  'SUBMIT_DOCS',
  'CALL_BACK',
  'WRITE_OFF',
  'RESOLVED',
  'MANUAL_REVIEW',
]);

const CallSummaryResponseSchema = z.object({
  id: z.string(),
  callId: z.string(),
  organizationId: z.string(),
  claimStatus: z.string(),
  denialReason: z.string().nullable(),
  denialCode: z.string().nullable(),
  nextAction: NextActionEnum,
  confidence: z.number().min(0).max(1).nullable(),
  repName: z.string().nullable(),
  referenceNumber: z.string().nullable(),
  callbackDate: z.iso.datetime().nullable(),
  amountApprovedCents: z.number().int().min(0).nullable(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

const SummaryRetryResponseSchema = z.object({
  jobId: z.string(),
  callId: z.string(),
  retryNumber: z.number().int().min(1),
  queuedAt: z.iso.datetime(),
});

const SummaryStatusResponseSchema = z.object({
  callId: z.string(),
  generation: z.literal(1),
  state: z.enum([
    'NOT_REQUESTED',
    'RESERVED',
    'SUBMITTING',
    'UNKNOWN',
    'RESPONDED',
    'REJECTED',
    'APPLIED',
  ]),
  summaryId: z.string().nullable(),
  provider: z.enum(['SYNTHETIC', 'FIREWORKS']).nullable(),
  observationId: z.string().nullable(),
  reviewRequired: z.boolean(),
  canRetry: z.boolean(),
  lastErrorCode: z.string().nullable(),
  updatedAt: z.iso.datetime().nullable(),
});

const SummaryRunSelect = {
  id: true,
  state: true,
  provider: true,
  lastErrorCode: true,
  updatedAt: true,
  leaseExpiresAt: true,
  reviewAppliedAt: true,
  resultPayload: true,
  receiptHash: true,
  observation: { select: { id: true } },
  attempts: {
    orderBy: { attemptNumber: 'desc' },
    take: 1,
    select: { id: true, responsePayload: true, responseHash: true, responseRecordedAt: true },
  },
} satisfies Prisma.InferenceRunSelect;
type ProcessingRun = Prisma.InferenceRunGetPayload<{ select: typeof SummaryRunSelect }>;

function processingDisposition(run: ProcessingRun | null, now = new Date()) {
  const activeLease = !!run?.leaseExpiresAt && run.leaseExpiresAt > now;
  const last = run?.attempts[0];
  const rawReceipt =
    run?.provider === 'FIREWORKS' &&
    !!last?.responseRecordedAt &&
    !!last.responseHash &&
    parseFireworksRawResponse(last.responsePayload) !== null;
  const resumableRaw = rawReceipt && (run.state === 'SUBMITTING' || run.state === 'UNKNOWN');
  const finalReceipt = run?.provider !== 'FIREWORKS' || (!!run.resultPayload && !!run.receiptHash);
  // A native attempt permanently fixes submission identity. Expired attempts
  // resume saved evidence or apply review effects; they never authorize a send.
  const nativeSettlement =
    run?.provider === 'FIREWORKS' &&
    (((run.state === 'UNKNOWN' || run.state === 'REJECTED') && !run.reviewAppliedAt) ||
      (run.state === 'SUBMITTING' && !!last));
  const canRetry =
    !activeLease &&
    (!run ||
      run.state === 'RESERVED' ||
      (run.state === 'RESPONDED' && finalReceipt) ||
      resumableRaw ||
      nativeSettlement);
  return {
    activeLease,
    canRetry: canRetry && !run?.observation,
    reviewRequired:
      !!run &&
      !run.observation &&
      (run.state === 'REJECTED' ||
        ((run.state === 'UNKNOWN' || (run.state === 'SUBMITTING' && !activeLease)) &&
          !resumableRaw)),
  };
}

interface CallSummaryRowForResponse {
  id: string;
  callId: string;
  organizationId: string;
  claimStatus: string;
  denialReason: string | null;
  denialCode: string | null;
  nextAction:
    | 'RESUBMIT'
    | 'APPEAL'
    | 'SUBMIT_DOCS'
    | 'CALL_BACK'
    | 'WRITE_OFF'
    | 'RESOLVED'
    | 'MANUAL_REVIEW';
  confidence: number | null;
  repName: string | null;
  referenceNumber: string | null;
  callbackDate: Date | null;
  amountApproved: { toString: () => string } | null;
  notes: string | null;
  createdAt: Date;
}

function toCallSummaryResponse(
  row: CallSummaryRowForResponse,
): z.infer<typeof CallSummaryResponseSchema> {
  return {
    id: row.id,
    callId: row.callId,
    organizationId: row.organizationId,
    claimStatus: row.claimStatus,
    denialReason: row.denialReason,
    denialCode: row.denialCode,
    nextAction: row.nextAction,
    confidence: row.confidence,
    repName: row.repName,
    referenceNumber: row.referenceNumber,
    callbackDate: row.callbackDate ? row.callbackDate.toISOString() : null,
    amountApprovedCents:
      row.amountApproved === null
        ? null
        : Math.round(Number.parseFloat(row.amountApproved.toString()) * 100),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

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
 *   - `verifiedPayments` — unavailable until a reconciled payment ledger exists.
 */
const CallsStatsResponseSchema = z.object({
  callsToday: z.number().int().min(0),
  queueDepth: z.number().int().min(0),
  avgCallSeconds: z.number().int().min(0).nullable(),
  verifiedPayments: VerifiedPaymentsSchema,
});
type CallsStatsResponse = z.infer<typeof CallsStatsResponseSchema>;

interface CallRowForResponse {
  intent?: MonitoringRow | null;
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
  cancelRequestedAt: Date | null;
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
    cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
    monitoring: row.intent
      ? {
          deadlineAt: row.intent.callDeadlineAt?.toISOString() ?? null,
          nextObservationAt: row.intent.nextObservationAt?.toISOString() ?? null,
          stopRequestedAt: row.intent.stopRequestedAt?.toISOString() ?? null,
          stopAcknowledgedAt: row.intent.stopAcknowledgedAt?.toISOString() ?? null,
          reviewRequiredAt: row.intent.observationReviewAt?.toISOString() ?? null,
          lastCheckedAt: row.intent.lastObservedAt?.toISOString() ?? null,
          lastErrorCode:
            row.intent.observationErrorCode &&
            OBSERVATION_ERROR_CODES.has(row.intent.observationErrorCode)
              ? row.intent.observationErrorCode
              : null,
        }
      : null,
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
          'Reserve an outbound payer call intent and dispatch it. Repeated requests reuse the active intent; ambiguous provider submission requires reconciliation.',
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

      const dispatchIntent = async (
        intent: CallIntent,
        commandSaved = false,
      ): Promise<EnqueueCallResponse> => {
        if (intent.state === 'SUBMITTING' || intent.state === 'UNKNOWN') {
          throw new ApiError(
            'INVALID_STATE_TRANSITION',
            'The earlier call submission needs reconciliation before another call can be placed.',
          );
        }
        if (intent.state === 'READY') {
          const data: CallJobData = {
            organizationId: orgId,
            claimId: id,
            payerCode: intent.payerCode,
            attemptNumber: intent.attemptNumber,
            claimPriority: intent.claimPriority,
            idempotencyKey: intent.idempotencyKey,
          };
          // Also backfill READY intents reserved before the outbox migration.
          if (!commandSaved)
            await enqueueJobOutbox(prisma, { organizationId: orgId, kind: 'CALL_PLACE', data });
          try {
            await relayJobOutbox({
              prisma,
              jobDispatcher: fastify.jobDispatcher,
              organizationId: orgId,
              idempotencyKey: intent.idempotencyKey,
              limit: 1,
              budgetMs: 5_000,
            });
          } catch {
            request.log.error('Call delivery remains pending in the durable outbox.');
          }
        }
        reply.code(202);
        return {
          jobId: intent.idempotencyKey,
          claimId: id,
          queuedAt: intent.createdAt.toISOString(),
          attemptNumber: intent.attemptNumber,
        };
      };
      const activeIntent = await db.callIntent.findFirst({
        where: { claimId: id, state: { in: ['READY', 'SUBMITTING', 'UNKNOWN', 'ACCEPTED'] } },
      });
      if (activeIntent) return dispatchIntent(activeIntent);

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

      // Pre-flight NPI check — mirrors the call-worker's hard requirement
      // (apps/call-worker/src/handler.ts) so the failure surfaces as a
      // typed 422 the UI can deep-link to /dashboard/settings/organization,
      // instead of letting the job die in the DLQ with a generic Error.
      // Per-payer override on PayerConfig wins; falls back to Organization.npi.
      //
      // Order: NPI runs BEFORE the business-hours guard. NPI absence is a
      // permanent data-state error the operator can fix immediately; an
      // out-of-hours response is a transient time-state error that asks
      // them to come back later. Surfacing the actionable error first
      // respects the operator's time and avoids the "wait until 8am" →
      // "now fix your NPI" two-step.
      const [orgRow, payerConfigRow] = await Promise.all([
        prisma.organization.findUnique({
          where: { id: orgId },
          select: { npi: true },
        }),
        prisma.payerConfig.findUnique({
          where: {
            organizationId_payerCode: { organizationId: orgId, payerCode: claim.payerCode },
          },
          select: { providerNpi: true },
        }),
      ]);
      const resolvedNpi = payerConfigRow?.providerNpi ?? orgRow?.npi ?? null;
      if (resolvedNpi === null || resolvedNpi.trim().length === 0) {
        throw new ApiError(
          'MISSING_PROVIDER_NPI',
          'Add your practice NPI in Settings before placing calls. The payer rep needs it to look up the claim.',
        );
      }

      const identity = validateCallIdentity({
        subscriberId: claim.subscriberId,
        providerNpi: resolvedNpi,
      });
      if (!identity.ok) {
        throw new ApiError(
          'MISSING_CALL_IDENTITY',
          'Add the subscriber ID from the source record before placing a call.',
        );
      }

      // ADR-037 — business-hours guard at enqueue, not worker pickup.
      const hours = checkPayerHours(claim.payerCode, new Date());
      if (hours.state === 'closed') {
        // The demo override is interlocked against RETELL_API_KEY (see
        // payerHoursOverridden), so a real deployment can never dial a closed
        // line. Logged at warn so it is never a silent bypass.
        if (payerHoursOverridden()) {
          request.log.warn(
            { payerCode: claim.payerCode, reason: hours.reason },
            'DEMO_IGNORE_PAYER_HOURS: enqueuing against a closed payer line',
          );
        } else {
          throw new ApiError(
            'PAYER_HOURS_CLOSED',
            `${claim.payerCode} provider line is closed (${hours.reason}). Next opening: ${hours.nextOpeningAt.toISOString()}.`,
          );
        }
      }
      if (hours.state === 'unsupported_payer') {
        throw new ApiError(
          'UNSUPPORTED_PAYER',
          `Payer ${claim.payerCode} business-hours metadata is missing.`,
        );
      }

      const reserved = await prisma.$transaction(async (tx) => {
        const queued = await tx.claim.updateMany({
          where: { id, organizationId: orgId, status: claim.status, updatedAt: claim.updatedAt },
          data: { status: 'IN_QUEUE' },
        });
        if (queued.count === 0) {
          const concurrent = await tx.callIntent.findFirst({
            where: {
              organizationId: orgId,
              claimId: id,
              state: { in: ['READY', 'SUBMITTING', 'UNKNOWN', 'ACCEPTED'] },
            },
          });
          if (concurrent) {
            if (concurrent.state === 'READY')
              await enqueueJobOutbox(tx, {
                organizationId: orgId,
                kind: 'CALL_PLACE',
                data: {
                  organizationId: orgId,
                  claimId: id,
                  payerCode: concurrent.payerCode,
                  attemptNumber: concurrent.attemptNumber,
                  claimPriority: concurrent.claimPriority,
                  idempotencyKey: concurrent.idempotencyKey,
                },
              });
            return concurrent;
          }
          throw new ApiError(
            'INVALID_STATE_TRANSITION',
            'Claim changed before the call was queued.',
          );
        }
        const legacyActive = await tx.call.count({
          where: {
            organizationId: orgId,
            claimId: id,
            status: { notIn: ['COMPLETED', 'FAILED', 'VOICEMAIL'] },
          },
        });
        if (legacyActive > 0) {
          throw new ApiError('INVALID_STATE_TRANSITION', 'An earlier call is still active.');
        }
        const todayUtcStart = new Date();
        todayUtcStart.setUTCHours(0, 0, 0, 0);
        const attemptsToday =
          (await tx.callIntent.count({
            where: {
              organizationId: orgId,
              claimId: id,
              OR: [{ createdAt: { gte: todayUtcStart } }, { submittedAt: { gte: todayUtcStart } }],
            },
          })) +
          (await tx.call.count({
            where: {
              organizationId: orgId,
              claimId: id,
              createdAt: { gte: todayUtcStart },
              intent: null,
            },
          }));
        if (attemptsToday >= 2) {
          throw new ApiError(
            'RATE_LIMITED',
            'This claim has already reserved its 2 dialling attempts for today.',
          );
        }
        const current = await tx.claim.findFirstOrThrow({ where: { id, organizationId: orgId } });
        const intent = await tx.callIntent.create({
          data: {
            organizationId: orgId,
            claimId: id,
            payerCode: claim.payerCode,
            attemptNumber: attemptsToday + 1,
            claimPriority: body?.priorityOverride ?? claim.priority,
            idempotencyKey: `call_${randomUUID()}`,
            claimVersion: current.updatedAt,
          },
        });
        await audit(
          {
            action: 'call.enqueue',
            resourceType: 'Claim',
            resourceId: id,
            organizationId: orgId,
            metadata: {
              clerkUserId: auth.userId,
              attemptNumber: intent.attemptNumber,
              jobId: intent.idempotencyKey,
              intentId: intent.id,
              payerCode: claim.payerCode,
            },
          },
          tx,
        );
        await enqueueJobOutbox(tx, {
          organizationId: orgId,
          kind: 'CALL_PLACE',
          data: {
            organizationId: orgId,
            claimId: id,
            payerCode: intent.payerCode,
            attemptNumber: intent.attemptNumber,
            claimPriority: intent.claimPriority,
            idempotencyKey: intent.idempotencyKey,
          },
        });
        return intent;
      });
      return dispatchIntent(reserved, true);
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
      if (query.claimId) where.claimId = query.claimId;
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
        include: { intent: { select: MONITORING_SELECT } },
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
          claimId: query.claimId ?? null,
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
      const [callsToday, queueDepth, avgRow] = await Promise.all([
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
      ]);

      const avgCallSeconds =
        avgRow._avg.durationSeconds === null ? null : Math.round(avgRow._avg.durationSeconds);

      return {
        callsToday,
        queueDepth,
        avgCallSeconds,
        verifiedPayments: unavailableVerifiedPayments,
      };
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
          intent: { select: MONITORING_SELECT },
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
          'Request cancellation of an active call. The worker observes the durable request and asks the provider to stop; status and end time await provider evidence. Repeated requests and terminal calls are idempotent.',
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

      const updated = await requestCallCancellation(prisma, {
        organizationId: orgId,
        callId: id,
        clerkUserId: auth.clerkUserId,
      });
      if (!updated) throw new ApiError('NOT_FOUND', 'Call not found in your organization.');
      const intent = await prisma.callIntent.findFirst({
        where: { organizationId: orgId, callId: updated.id },
        select: MONITORING_SELECT,
      });
      return toCallResponse({ ...updated, intent });
    },
  );

  // ─── GET /v1/calls/:id/summary — fetch CallSummary (P4-T2H) ───────────
  fastify.withTypeProvider().get(
    '/calls/:id/summary',
    {
      preHandler: requireAuth,
      schema: {
        description:
          'Fetch a saved legacy CallSummary. Returns 404 when the scoped call or summary is absent; use summary/status for processing state and native observation links.',
        security,
        params: CallIdParamSchema,
        response: { 200: CallSummaryResponseSchema },
      },
    },
    async (request): Promise<z.infer<typeof CallSummaryResponseSchema>> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const { orgId } = auth;
      const { id } = request.params as z.infer<typeof CallIdParamSchema>;

      const db = getOrgScopedDb(orgId);
      const call = await db.call.findFirst({ where: { id } });
      if (!call) {
        throw new ApiError('NOT_FOUND', 'Call not found in your organization.');
      }
      const summary = await db.callSummary.findFirst({ where: { callId: id } });
      if (!summary) {
        throw new ApiError('NOT_FOUND', 'No summary has been generated for this call yet.');
      }

      // Audit the PHI read — rawTranscript + claudeSummary count as PHI.
      // The redact list (P4-T2I) keeps these out of pino logs even if
      // the audit metadata bag accidentally serialises a payload field.
      await audit({
        action: 'callSummary.read',
        resourceType: 'CallSummary',
        resourceId: summary.id,
        organizationId: orgId,
        metadata: { clerkUserId: auth.userId, callId: id },
      });

      return toCallSummaryResponse(summary);
    },
  );

  fastify.withTypeProvider().get(
    '/calls/:id/summary/status',
    {
      preHandler: requireAuth,
      schema: {
        description:
          'Organization-scoped generation 1 analysis status. Only stored OWNER/ADMIN users may retry. No transcript, request, or provider response is returned.',
        security,
        params: CallIdParamSchema,
        response: { 200: SummaryStatusResponseSchema },
      },
    },
    async (request): Promise<z.infer<typeof SummaryStatusResponseSchema>> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'Authentication required.');
      const actor = await prisma.user.findFirst({
        where: { id: auth.userId, organizationId: auth.orgId },
        select: { role: true },
      });
      if (!actor) throw new ApiError('FORBIDDEN', 'An organization user is required.');
      const call = await prisma.call.findFirst({
        where: {
          id: (request.params as z.infer<typeof CallIdParamSchema>).id,
          organizationId: auth.orgId,
        },
        select: { id: true, status: true },
      });
      if (!call) throw new ApiError('NOT_FOUND', 'Call not found in your organization.');
      const [run, summary] = await Promise.all([
        prisma.inferenceRun.findFirst({
          where: { organizationId: auth.orgId, callId: call.id, generation: 1 },
          select: SummaryRunSelect,
        }),
        prisma.callSummary.findFirst({
          where: { organizationId: auth.orgId, callId: call.id },
          select: { id: true, createdAt: true },
        }),
      ]);
      const disposition = processingDisposition(run);
      await audit({
        organizationId: auth.orgId,
        userId: auth.userId,
        action: 'callSummary.status.read',
        resourceType: 'Call',
        resourceId: call.id,
      });
      return {
        callId: call.id,
        generation: 1,
        state: run?.state ?? (summary ? 'APPLIED' : 'NOT_REQUESTED'),
        summaryId: summary?.id ?? null,
        provider: run?.provider ?? null,
        observationId: run?.observation?.id ?? null,
        reviewRequired: disposition.reviewRequired,
        canRetry:
          ['OWNER', 'ADMIN'].includes(actor.role) &&
          (!summary || run?.provider === 'FIREWORKS') &&
          TERMINAL_CALL_STATUSES.has(call.status) &&
          disposition.canRetry,
        lastErrorCode: run?.lastErrorCode ? 'INFERENCE_REVIEW_REQUIRED' : null,
        updatedAt: (run?.updatedAt ?? summary?.createdAt)?.toISOString() ?? null,
      };
    },
  );

  // ─── POST /v1/calls/:id/summary/retry — generation 1 delivery only ───
  fastify.withTypeProvider().post(
    '/calls/:id/summary/retry',
    {
      preHandler: requireAuth,
      schema: {
        description:
          'OWNER/ADMIN-gated retry of summary generation for a terminal Call. Atomically reserves a durable delivery command and audit record; retry reservations are serialized for each call.',
        security,
        params: CallIdParamSchema,
        response: { 202: SummaryRetryResponseSchema },
      },
    },
    async (request, reply): Promise<z.infer<typeof SummaryRetryResponseSchema>> => {
      if (
        !z
          .object({})
          .strict()
          .safeParse(request.body === undefined ? {} : request.body).success
      ) {
        throw new ApiError('VALIDATION_ERROR', 'Summary retry accepts only an empty request.');
      }
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const { orgId } = auth;
      const { id } = request.params as z.infer<typeof CallIdParamSchema>;

      // OWNER/ADMIN gate — billing-staff must escalate.
      const actor = await prisma.user.findFirst({
        where: { id: auth.userId, organizationId: orgId },
        select: { role: true },
      });
      if (!actor || (actor.role !== 'OWNER' && actor.role !== 'ADMIN')) {
        throw new ApiError('FORBIDDEN', 'Only OWNER or ADMIN may retry summary generation.');
      }

      const db = getOrgScopedDb(orgId);
      const call = await db.call.findFirst({ where: { id } });
      if (!call) {
        throw new ApiError('NOT_FOUND', 'Call not found in your organization.');
      }

      if (!TERMINAL_CALL_STATUSES.has(call.status)) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Wait until the call has ended before requesting a summary.',
        );
      }

      const queued = await prisma.$transaction(async (tx) => {
        // Match the durable inference ledger's organization-first lock order.
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${orgId} FOR NO KEY UPDATE`;
        const reserved = await tx.call.updateMany({
          where: { id, organizationId: orgId, status: call.status },
          data: { status: call.status },
        });
        if (reserved.count !== 1) {
          throw new ApiError('INVALID_STATE_TRANSITION', 'Call changed before the summary retry.');
        }
        await tx.$queryRaw`SELECT id FROM "InferenceRun" WHERE "organizationId" = ${orgId} AND "callId" = ${id} AND generation = 1 FOR UPDATE`;
        const run = await tx.inferenceRun.findFirst({
          where: { organizationId: orgId, callId: id, generation: 1 },
          select: SummaryRunSelect,
        });
        const existing = await tx.callSummary.findFirst({
          where: { organizationId: orgId, callId: id },
          select: { id: true },
        });
        if (
          (existing && run?.provider !== 'FIREWORKS') ||
          run?.state === 'APPLIED' ||
          run?.observation
        )
          throw new ApiError(
            'SUMMARY_ALREADY_EXISTS',
            'Saved analysis already exists. Retrying will not replace it.',
          );
        const disposition = processingDisposition(run);
        if (
          disposition.activeLease ||
          (run?.state === 'SUBMITTING' && run.provider === 'SYNTHETIC')
        )
          throw new ApiError(
            'SUMMARY_INFERENCE_BUSY',
            'Summary processing has already started. Another inference will not be submitted.',
          );
        if (!disposition.canRetry)
          throw new ApiError(
            'SUMMARY_INFERENCE_REVIEW_REQUIRED',
            'This summary requires review. Another inference will not be submitted.',
          );
        const previousRetries = await tx.auditLog.count({
          where: {
            organizationId: orgId,
            action: 'callSummary.retry',
            resourceType: 'Call',
            resourceId: id,
          },
        });
        const retryNumber = previousRetries + 1;
        const idempotencyKey = `call.${id}.retry.${String(retryNumber)}`;
        const data: SummaryJobData = {
          organizationId: orgId,
          callId: id,
          promptVersion: 'v1',
          idempotencyKey,
        };
        const outbox = await enqueueJobOutbox(tx, {
          organizationId: orgId,
          kind: 'SUMMARY_GENERATE',
          data,
        });
        await audit(
          {
            action: 'callSummary.retry',
            resourceType: 'Call',
            resourceId: id,
            organizationId: orgId,
            metadata: { clerkUserId: auth.userId, jobId: idempotencyKey, retryNumber },
          },
          tx,
        );
        return { jobId: idempotencyKey, retryNumber, queuedAt: outbox.createdAt };
      });
      try {
        await relayJobOutbox({
          prisma,
          jobDispatcher: fastify.jobDispatcher,
          organizationId: orgId,
          idempotencyKey: queued.jobId,
          limit: 1,
          budgetMs: 5_000,
        });
      } catch {
        request.log.error('Summary retry delivery remains pending in the durable outbox.');
      }

      reply.code(202);
      return {
        jobId: queued.jobId,
        callId: id,
        retryNumber: queued.retryNumber,
        queuedAt: queued.queuedAt.toISOString(),
      };
    },
  );
}

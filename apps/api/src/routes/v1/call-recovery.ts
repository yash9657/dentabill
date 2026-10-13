import {
  getCallIntentReconciliationEligibility,
  reconcileCallIntent,
} from '@dentabill/call-worker';
import { prisma, type CallIntent } from '@dentabill/db';
import {
  createRetellReconciliationClient,
  type RetellReconciliationClient,
} from '@dentabill/payer-ivr';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getEnv } from '../../lib/env.js';

export interface CallRecoveryRoutesOptions {
  /** Undefined uses the configured client lazily; null explicitly disables lookup. */
  readonly provider?: RetellReconciliationClient | null;
}

const IdSchema = z.object({ id: z.string().min(1).max(200) }).strict();
const OutcomeSchema = z.enum([
  'RECOVERED',
  'ALREADY_BOUND',
  'NO_MATCH',
  'REVIEW_REQUIRED',
  'LOOKUP_FAILED',
  'NOT_READY',
  'IN_PROGRESS',
  'NOT_FOUND',
]);
const IntentSchema = z.object({
  id: z.string(),
  state: z.enum(['READY', 'SUBMITTING', 'UNKNOWN', 'ACCEPTED', 'TERMINAL', 'CANCELLED']),
  attemptNumber: z.number().int(),
  createdAt: z.iso.datetime(),
  submittedAt: z.iso.datetime().nullable(),
  callId: z.string().nullable(),
  lastCheckedAt: z.iso.datetime().nullable(),
  lastCheckOutcome: OutcomeSchema.nullable(),
  nextCheckAt: z.iso.datetime().nullable(),
});
const RecoverySchema = z.object({
  intent: IntentSchema.nullable(),
  canCheck: z.boolean(),
  canReview: z.boolean(),
  availability: z.enum(['AVAILABLE', 'NOT_CONFIGURED']),
});
const ReconcileResponseSchema = RecoverySchema.extend({ outcome: OutcomeSchema });
type RecoveryResponse = z.infer<typeof RecoverySchema>;

const INTENT_SELECT = {
  id: true,
  state: true,
  attemptNumber: true,
  createdAt: true,
  submittedAt: true,
  callId: true,
  reconciledAt: true,
  reconcileOutcome: true,
  reconcileAvailableAt: true,
  reconcileLeaseExpiresAt: true,
} as const;
type SafeIntent = Pick<CallIntent, keyof typeof INTENT_SELECT>;

function toRecoveryResponse(
  intent: SafeIntent | null,
  canReview: boolean,
  configured: boolean,
): RecoveryResponse {
  const eligibility = intent ? getCallIntentReconciliationEligibility(intent) : null;
  const outcome = OutcomeSchema.safeParse(intent?.reconcileOutcome);
  return {
    intent: intent
      ? {
          id: intent.id,
          state: intent.state,
          attemptNumber: intent.attemptNumber,
          createdAt: intent.createdAt.toISOString(),
          submittedAt: intent.submittedAt?.toISOString() ?? null,
          callId: intent.callId,
          lastCheckedAt: intent.reconciledAt?.toISOString() ?? null,
          lastCheckOutcome: outcome.success ? outcome.data : null,
          nextCheckAt: eligibility?.nextCheckAt?.toISOString() ?? null,
        }
      : null,
    canCheck: canReview && configured && Boolean(eligibility?.canCheck),
    canReview,
    availability: configured ? 'AVAILABLE' : 'NOT_CONFIGURED',
  };
}

export function callRecoveryRoutes(
  fastify: FastifyInstance,
  options: CallRecoveryRoutesOptions,
): void {
  let configuredProvider: RetellReconciliationClient | undefined;
  const isConfigured = (): boolean =>
    options.provider !== undefined ? options.provider !== null : Boolean(getEnv().RETELL_API_KEY);
  const provider = (): RetellReconciliationClient | null => {
    if (options.provider !== undefined) return options.provider;
    const apiKey = getEnv().RETELL_API_KEY;
    if (!apiKey) return null;
    return (configuredProvider ??= createRetellReconciliationClient({ apiKey }));
  };
  const canReview = async (userId: string, organizationId: string): Promise<boolean> => {
    const actor = await prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { role: true },
    });
    return actor?.role === 'OWNER' || actor?.role === 'ADMIN';
  };

  fastify.withTypeProvider().get(
    '/claims/:id/call-recovery',
    {
      preHandler: fastify.auth.requireAuth,
      schema: {
        description:
          'Read the current call submission status without exposing its identity snapshot.',
        security: [{ bearer: [] as string[] }],
        params: IdSchema,
        response: { 200: RecoverySchema },
      },
    },
    async (request): Promise<RecoveryResponse> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
      const { id } = request.params as z.infer<typeof IdSchema>;
      const claim = await prisma.claim.findFirst({
        where: { id, organizationId: auth.orgId },
        select: { id: true },
      });
      if (!claim) throw new ApiError('NOT_FOUND', 'Claim not found in your organization.');
      const intent = await prisma.callIntent.findFirst({
        where: {
          organizationId: auth.orgId,
          claimId: id,
          state: { in: ['READY', 'SUBMITTING', 'UNKNOWN', 'ACCEPTED'] },
        },
        select: INTENT_SELECT,
      });
      return toRecoveryResponse(intent, await canReview(auth.userId, auth.orgId), isConfigured());
    },
  );

  fastify.withTypeProvider().post(
    '/call-intents/:id/reconcile',
    {
      preHandler: fastify.auth.requireAuth,
      preValidation: (request, _reply, done): void => {
        // Fastify passes an absent body to its validator as null. Normalize
        // absence while retaining strict rejection of caller-supplied fields.
        if (request.body === undefined) request.body = {};
        done();
      },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: (request): string => request.dentabillAuth?.orgId ?? 'anon',
        },
      },
      schema: {
        description:
          'OWNER/ADMIN review of an uncertain submission. Looks up the existing call; never starts a call.',
        security: [{ bearer: [] as string[] }],
        params: IdSchema,
        body: z.object({}).strict().optional(),
        response: { 200: ReconcileResponseSchema },
      },
    },
    async (request): Promise<z.infer<typeof ReconcileResponseSchema>> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
      const { id } = request.params as z.infer<typeof IdSchema>;
      const scope = { id, organizationId: auth.orgId };
      const existing = await prisma.callIntent.findFirst({ where: scope, select: { id: true } });
      if (!existing)
        throw new ApiError('NOT_FOUND', 'Call submission not found in your organization.');
      if (!(await canReview(auth.userId, auth.orgId))) {
        throw new ApiError('FORBIDDEN', 'Only an owner or admin may check an existing call.');
      }
      const lookup = provider();
      if (!lookup) {
        throw new ApiError(
          'CALL_RECONCILIATION_UNAVAILABLE',
          'Call lookup is not configured. Contact your administrator.',
        );
      }
      const result = await reconcileCallIntent({
        prisma,
        provider: lookup,
        organizationId: auth.orgId,
        intentId: id,
        clerkUserId: auth.clerkUserId,
      });
      if (result.outcome === 'NOT_FOUND') {
        throw new ApiError('NOT_FOUND', 'Call submission not found in your organization.');
      }
      const intent = await prisma.callIntent.findFirst({ where: scope, select: INTENT_SELECT });
      return { ...toRecoveryResponse(intent, true, true), outcome: result.outcome };
    },
  );
}

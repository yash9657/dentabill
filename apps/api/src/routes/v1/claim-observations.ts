import {
  audit,
  ClaimObservationConflictError,
  getClaimObservationEligibility,
  prisma,
  reviewClaimObservation,
  type ClaimObservation,
} from '@dentabill/db';
import { publishStoredObservation } from '@dentabill/summary-worker';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const IdSchema = z.object({ id: z.string().min(1).max(128) }).strict();
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
// OpenAPI requires the API's Zod 4 schemas; the gateway's frozen v1 schemas use Zod 3.
const EvidenceSchema = z
  .object({
    sourceId: z.string().min(1).max(128),
    sourceVersion: z.string().min(1).max(128),
    start: z.number().int().min(0).max(65_536),
    end: z.number().int().min(1).max(65_536),
    quote: z.string().min(1).max(4096),
  })
  .strict();
const OutputSchema = z
  .object({
    disposition: z.enum(['OBSERVED', 'ABSTAIN']),
    claimId: z.string().min(1).max(128),
    claimVersion: z.iso.datetime(),
    status: z
      .object({
        value: z.enum(['PAID_REPORTED', 'DENIED_REPORTED', 'PENDING_REPORTED', 'UNKNOWN']),
        evidence: z.array(EvidenceSchema).max(8),
      })
      .strict(),
    payerReportedPayment: z
      .object({
        amountMinorUnits: z.number().int().min(0).max(1_000_000_000),
        currency: z.literal('USD'),
        evidence: z.array(EvidenceSchema).min(1).max(8),
      })
      .strict()
      .nullable(),
    denialCodes: z
      .array(
        z
          .object({
            system: z.enum(['CARC', 'RARC', 'PAYER_LOCAL', 'UNKNOWN']),
            code: z.string().min(1).max(64),
            evidence: z.array(EvidenceSchema).min(1).max(8),
          })
          .strict(),
      )
      .max(16),
    proposedAction: z.enum([
      'REVIEW_PAYMENT',
      'REVIEW_DENIAL',
      'FOLLOW_UP',
      'REQUEST_INFORMATION',
      'MANUAL_REVIEW',
    ]),
    abstentionReason: z
      .enum(['INSUFFICIENT_EVIDENCE', 'CONTRADICTORY_EVIDENCE', 'UNSUPPORTED_CONTENT'])
      .nullable(),
  })
  .strict();
const SourceSchema = z.object({
  id: z.string().min(1).max(128),
  version: z.string().min(1).max(128),
  kind: z.literal('FINAL_CALL_TRANSCRIPT'),
  text: z.string().min(1).max(65_536),
});
const UsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
    cachedInputTokens: z.number().int().nonnegative().nullable(),
  })
  .strict();
const ProvenanceSchema = z
  .object({
    kind: z.enum(['FIREWORKS', 'SYNTHETIC']),
    releaseId: z.string().min(1).max(128),
    task: z.literal('claim-observation.v1'),
    promptVersion: z.literal('claim-observation-prompt.v1'),
    schemaVersion: z.literal('claim-observation-schema.v1'),
    responseId: z.string().max(128).nullable(),
    model: z.string().max(500).nullable(),
    attempts: z
      .array(
        z
          .object({
            index: z.number().int().min(1).max(2),
            httpStatus: z.number().int().min(100).max(599).nullable(),
            outcome: z.enum([
              'COMPLETED',
              'HTTP_ERROR',
              'NETWORK_ERROR',
              'DEADLINE_EXCEEDED',
              'CANCELLED',
              'INVALID_RESPONSE',
            ]),
            acceptance: z.enum(['NOT_SENT', 'POSSIBLE', 'RESPONDED']),
            elapsedMs: z.number().nonnegative(),
            usage: UsageSchema,
          })
          .strict(),
      )
      .max(2),
    usage: UsageSchema,
    elapsedMs: z.number().nonnegative(),
  })
  .strict();
const ReviewSchema = z
  .object({
    decision: z.enum(['ACKNOWLEDGED', 'DISMISSED']),
    note: z.string().max(1000).nullable(),
    reviewedAt: z.iso.datetime(),
    reviewedByUserId: z.string(),
  })
  .strict();
const ObservationSchema = z
  .object({
    id: z.string(),
    claimId: z.string(),
    callId: z.string(),
    version: z.number().int().positive(),
    claimVersion: z.iso.datetime(),
    digest: DigestSchema,
    createdAt: z.iso.datetime(),
    dataClass: z.enum(['SYNTHETIC', 'PROTECTED']),
    output: OutputSchema,
    sources: z.array(SourceSchema).min(1).max(8),
    provenance: ProvenanceSchema,
    review: ReviewSchema.nullable(),
    isCurrent: z.boolean(),
    canReview: z.boolean(),
    staleReason: z
      .enum([
        'CLAIM_CHANGED',
        'SUPERSEDED',
        'NEWER_CALL',
        'NEWER_GENERATION',
        'TRANSCRIPT_CHANGED',
        'ALREADY_REVIEWED',
      ])
      .nullable(),
  })
  .strict();
const ListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(20).default(10),
    cursor: z.string().min(1).max(1000).optional(),
  })
  .strict();
const CursorSchema = z
  .object({ claimId: z.string().min(1).max(128), version: z.number().int().positive() })
  .strict();
const PageSchema = z
  .object({
    items: z.array(ObservationSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    publishableCalls: z
      .array(z.object({ callId: z.string(), createdAt: z.iso.datetime() }).strict())
      .max(10),
  })
  .strict();
const ReviewBodySchema = z
  .object({
    expectedDigest: DigestSchema,
    expectedClaimVersion: z.iso.datetime(),
    decision: z.enum(['ACKNOWLEDGED', 'DISMISSED']),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .superRefine((body, context) => {
    if (body.decision === 'DISMISSED' && !body.note)
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'A dismissal note is required.',
      });
  });

function safeError(error: unknown): never {
  if (ApiError.isApiError(error)) throw error;
  if (error instanceof ClaimObservationConflictError) {
    if (error.code === 'NOT_FOUND')
      throw new ApiError('NOT_FOUND', 'Observation not found in your organization.');
    if (error.code === 'FORBIDDEN')
      throw new ApiError('FORBIDDEN', 'Your stored organization role cannot review observations.');
    if (error.code === 'INVALID_INPUT')
      throw new ApiError('VALIDATION_ERROR', 'Check the observation review fields.');
    throw new ApiError(
      'CONFLICT',
      'This observation is unavailable or has changed. Refresh the findings before continuing.',
    );
  }
  throw new ApiError(
    'INTERNAL_ERROR',
    'Observation work could not be completed. Try again shortly.',
  );
}

async function authorize(userId: string, organizationId: string): Promise<void> {
  const actor = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { role: true },
  });
  if (!actor || !['OWNER', 'ADMIN', 'BILLING_STAFF'].includes(actor.role))
    throw new ApiError('FORBIDDEN', 'An organization billing role is required.');
}

async function auditAccess(
  actor: { orgId: string; userId: string },
  claimId: string,
  metadata:
    | {
        accessKind: 'HISTORY';
        returnedCount: number;
        publishableCallCount: number;
        hasMore: boolean;
        cursorProvided: boolean;
      }
    | { accessKind: 'PUBLISH' | 'REVIEW'; observationId: string },
): Promise<void> {
  await audit({
    organizationId: actor.orgId,
    userId: actor.userId,
    action: 'claimObservation.accessed',
    resourceType: 'Claim',
    resourceId: claimId,
    metadata,
  });
}

async function toResponse(
  row: ClaimObservation,
  clerkUserId: string,
): Promise<z.infer<typeof ObservationSchema>> {
  const [eligibility, review] = await Promise.all([
    getClaimObservationEligibility(prisma, {
      organizationId: row.organizationId,
      observationId: row.id,
      clerkUserId,
    }),
    prisma.claimObservationReview.findFirst({
      where: { organizationId: row.organizationId, observationId: row.id },
    }),
  ]);
  const parsed = ObservationSchema.safeParse({
    id: row.id,
    claimId: row.claimId,
    callId: row.callId,
    version: row.version,
    claimVersion: row.claimVersion.toISOString(),
    digest: row.digest,
    createdAt: row.createdAt.toISOString(),
    dataClass: row.dataClass,
    output: row.output,
    sources: row.sources,
    provenance: row.provenance,
    review: review
      ? {
          decision: review.decision,
          note: review.note,
          reviewedAt: review.reviewedAt.toISOString(),
          reviewedByUserId: review.reviewedByUserId,
        }
      : null,
    isCurrent: eligibility.isCurrent,
    canReview: eligibility.canReview && !review,
    staleReason: eligibility.staleReason ?? (review ? 'ALREADY_REVIEWED' : null),
  });
  if (!parsed.success)
    throw new ApiError('INTERNAL_ERROR', 'Stored observation could not be displayed.');
  return parsed.data;
}

export function claimObservationRoutes(fastify: FastifyInstance): void {
  fastify.withTypeProvider().get(
    '/claims/:id/observations',
    {
      preHandler: fastify.auth.requireAuth,
      schema: {
        description:
          'Immutable claim findings and evidence. Acknowledgment never verifies payment.',
        security: [{ bearer: [] as string[] }],
        params: IdSchema,
        querystring: ListQuerySchema,
        response: { 200: PageSchema },
      },
    },
    async (request): Promise<z.infer<typeof PageSchema>> => {
      try {
        const auth = request.dentabillAuth;
        if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
        await authorize(auth.userId, auth.orgId);
        const { id } = request.params as z.infer<typeof IdSchema>;
        const query = request.query as z.infer<typeof ListQuerySchema>;
        let cursor: z.infer<typeof CursorSchema> | undefined;
        if (query.cursor) {
          try {
            cursor = CursorSchema.parse(
              JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
            );
          } catch {
            throw new ApiError('VALIDATION_ERROR', 'Invalid observation cursor.');
          }
          if (cursor.claimId !== id)
            throw new ApiError('VALIDATION_ERROR', 'Invalid observation cursor.');
        }
        const claim = await prisma.claim.findFirst({
          where: { id, organizationId: auth.orgId },
          select: { id: true },
        });
        if (!claim) throw new ApiError('NOT_FOUND', 'Claim not found in your organization.');
        const rows = await prisma.claimObservation.findMany({
          where: {
            organizationId: auth.orgId,
            claimId: id,
            ...(cursor ? { version: { lt: cursor.version } } : {}),
          },
          orderBy: { version: 'desc' },
          take: query.limit + 1,
        });
        const items = await Promise.all(
          rows.slice(0, query.limit).map((row) => toResponse(row, auth.clerkUserId)),
        );
        const runs = await prisma.inferenceRun.findMany({
          where: {
            organizationId: auth.orgId,
            claimId: id,
            provider: 'FIREWORKS',
            state: { in: ['RESPONDED', 'APPLIED'] },
            observation: { is: null },
            OR: [
              { resultPayload: { path: ['status'], equals: 'VALIDATED' } },
              { resultPayload: { path: ['status'], equals: 'ABSTAINED' } },
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 10,
          select: { id: true, callId: true, createdAt: true },
        });
        const last = items.at(-1);
        await auditAccess(auth, id, {
          accessKind: 'HISTORY',
          returnedCount: items.length,
          publishableCallCount: runs.length,
          hasMore: rows.length > query.limit,
          cursorProvided: query.cursor !== undefined,
        });
        return {
          items,
          hasMore: rows.length > query.limit,
          nextCursor:
            rows.length > query.limit && last
              ? Buffer.from(JSON.stringify({ claimId: id, version: last.version })).toString(
                  'base64url',
                )
              : null,
          publishableCalls: runs.map((run) => ({
            callId: run.callId,
            createdAt: run.createdAt.toISOString(),
          })),
        };
      } catch (error) {
        return safeError(error);
      }
    },
  );

  fastify.withTypeProvider().post(
    '/observations/:id/review',
    {
      preHandler: fastify.auth.requireAuth,
      schema: {
        description:
          'Record a review against an unchanged current finding. Does not update claim status or financial values.',
        security: [{ bearer: [] as string[] }],
        params: IdSchema,
        body: ReviewBodySchema,
        response: { 200: ObservationSchema },
      },
    },
    async (request): Promise<z.infer<typeof ObservationSchema>> => {
      try {
        const auth = request.dentabillAuth;
        if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
        await authorize(auth.userId, auth.orgId);
        const { id } = request.params as z.infer<typeof IdSchema>;
        const body = request.body as z.infer<typeof ReviewBodySchema>;
        await reviewClaimObservation(prisma, {
          organizationId: auth.orgId,
          clerkUserId: auth.clerkUserId,
          observationId: id,
          expectedObservationDigest: body.expectedDigest,
          expectedClaimVersion: new Date(body.expectedClaimVersion),
          decision: body.decision,
          ...(body.note ? { note: body.note } : {}),
        });
        const row = await prisma.claimObservation.findFirst({
          where: { organizationId: auth.orgId, id },
        });
        if (!row) throw new ApiError('NOT_FOUND', 'Observation not found in your organization.');
        const response = await toResponse(row, auth.clerkUserId);
        await auditAccess(auth, row.claimId, { accessKind: 'REVIEW', observationId: row.id });
        return response;
      } catch (error) {
        return safeError(error);
      }
    },
  );

  fastify.withTypeProvider().post(
    '/calls/:id/observations/publish',
    {
      preHandler: fastify.auth.requireAuth,
      preValidation: (request, _reply, done): void => {
        if (request.body === undefined) request.body = {};
        done();
      },
      schema: {
        description:
          'Publish findings from an existing saved inference receipt. Never sends a model request.',
        security: [{ bearer: [] as string[] }],
        params: IdSchema,
        body: z.object({}).strict().optional(),
        response: { 200: ObservationSchema, 201: ObservationSchema },
      },
    },
    async (request, reply): Promise<z.infer<typeof ObservationSchema>> => {
      try {
        const auth = request.dentabillAuth;
        if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
        await authorize(auth.userId, auth.orgId);
        const { id } = request.params as z.infer<typeof IdSchema>;
        const call = await prisma.call.findFirst({
          where: { id, organizationId: auth.orgId },
          select: { id: true },
        });
        if (!call) throw new ApiError('NOT_FOUND', 'Call not found in your organization.');
        const run = await prisma.inferenceRun.findFirst({
          where: {
            organizationId: auth.orgId,
            callId: id,
            generation: 1,
            provider: 'FIREWORKS',
            state: { in: ['RESPONDED', 'APPLIED'] },
          },
          select: { id: true },
        });
        if (!run) throw new ApiError('CONFLICT', 'No saved finding is available for this call.');
        const result = await publishStoredObservation({
          prisma,
          organizationId: auth.orgId,
          runId: run.id,
        });
        const response = await toResponse(result.observation, auth.clerkUserId);
        await auditAccess(auth, result.observation.claimId, {
          accessKind: 'PUBLISH',
          observationId: result.observation.id,
        });
        reply.code(result.kind === 'PUBLISHED' ? 201 : 200);
        return response;
      } catch (error) {
        return safeError(error);
      }
    },
  );
}

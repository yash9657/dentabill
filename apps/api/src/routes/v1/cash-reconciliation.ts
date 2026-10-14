import { ApiError } from '@dentabill/types';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  CashMatchListSchema,
  CashMatchReceiptSchema,
  MatchCandidateSchema,
  MatchDecisionSchema,
  MatchPreviewSchema,
  ReleaseCandidateSchema,
  ReleaseDecisionSchema,
  ReleasePreviewSchema,
  ReleaseReceiptSchema,
  type MatchDecision,
  type ReleaseDecision,
} from '../../lib/cash-reconciliation/contract.js';
import {
  createMatch,
  listMatches,
  previewMatch,
  previewRelease,
  releaseMatch,
  safeReconciliationError,
  type ReconciliationScope,
} from '../../lib/cash-reconciliation/service.js';

const IdParams = z.strictObject({ id: z.uuid() });
const ListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(20).default(10),
  cursor: z.string().min(1).max(2048).optional(),
});
const security = [{ bearer: [] as string[] }];
function scope(request: FastifyRequest): ReconciliationScope {
  const auth = request.dentabillAuth;
  if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
  return { organizationId: auth.orgId, userId: auth.userId };
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function cashReconciliationRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler((error, request, reply) => {
    if (ApiError.isApiError(error)) return reply.code(error.statusCode).send(error.toJson());
    const status =
      error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const validation = error && typeof error === 'object' && 'validation' in error;
    if (validation || status === 400 || status === 413)
      return reply
        .code(status === 413 ? 413 : 400)
        .send(
          new ApiError(
            'VALIDATION_ERROR',
            'Check the source match, signed amount, preview and retry fields.',
          ).toJson(),
        );
    if (status === 429)
      return reply
        .code(429)
        .send(new ApiError('RATE_LIMITED', 'Too many requests. Try again shortly.').toJson());
    request.log.error(
      { requestId: request.id, code: 'RECONCILIATION_REQUEST_FAILED' },
      'Reconciliation request failed',
    );
    return reply
      .code(500)
      .send(
        new ApiError(
          'INTERNAL_ERROR',
          'Reconciliation could not be completed. Retry the same request or refresh the evidence.',
        ).toJson(),
      );
  });
  fastify.withTypeProvider().get(
    '/cash-reconciliations',
    {
      preHandler: fastify.auth.requireAuth,
      schema: { security, querystring: ListQuery, response: { 200: CashMatchListSchema } },
    },
    async (request): Promise<z.infer<typeof CashMatchListSchema>> => {
      try {
        const query = request.query as z.infer<typeof ListQuery>;
        return await listMatches(scope(request), query.limit, query.cursor);
      } catch (error) {
        return safeReconciliationError(error);
      }
    },
  );
  fastify.withTypeProvider().post(
    '/cash-reconciliations/preview',
    {
      preHandler: fastify.auth.requireAuth,
      bodyLimit: 4096,
      schema: { security, body: MatchCandidateSchema, response: { 200: MatchPreviewSchema } },
    },
    async (request): Promise<z.infer<typeof MatchPreviewSchema>> => {
      try {
        return await previewMatch(scope(request), request.body);
      } catch (error) {
        return safeReconciliationError(error);
      }
    },
  );
  fastify.withTypeProvider().post(
    '/cash-reconciliations',
    {
      preHandler: fastify.auth.requireAuth,
      bodyLimit: 4096,
      schema: {
        security,
        body: MatchDecisionSchema,
        response: { 200: CashMatchReceiptSchema, 201: CashMatchReceiptSchema },
        description:
          'Record a reviewed signed match between current accepted manual cash evidence and an accepted remittance batch. Reserves both capacities; does not verify bank receipt, allocate claim cash, post payments or establish settlement.',
      },
    },
    async (request, reply): Promise<z.infer<typeof CashMatchReceiptSchema>> => {
      try {
        const result = await createMatch(scope(request), request.body as MatchDecision);
        reply.code(result.created ? 201 : 200);
        return result.receipt;
      } catch (error) {
        return safeReconciliationError(error);
      }
    },
  );
  fastify.withTypeProvider().post(
    '/cash-reconciliations/:id/release/preview',
    {
      preHandler: fastify.auth.requireAuth,
      bodyLimit: 4096,
      schema: {
        security,
        params: IdParams,
        body: ReleaseCandidateSchema,
        response: { 200: ReleasePreviewSchema },
      },
    },
    async (request): Promise<z.infer<typeof ReleasePreviewSchema>> => {
      try {
        return await previewRelease(
          scope(request),
          (request.params as z.infer<typeof IdParams>).id,
          request.body,
        );
      } catch (error) {
        return safeReconciliationError(error);
      }
    },
  );
  fastify.withTypeProvider().post(
    '/cash-reconciliations/:id/release',
    {
      preHandler: fastify.auth.requireAuth,
      bodyLimit: 4096,
      schema: {
        security,
        params: IdParams,
        body: ReleaseDecisionSchema,
        response: { 200: ReleaseReceiptSchema, 201: ReleaseReceiptSchema },
        description:
          'Explicitly release one entire source match while retaining its immutable history. Available despite stale source evidence or replacement graph limits. Does not reverse a payment or change source records.',
      },
    },
    async (request, reply): Promise<z.infer<typeof ReleaseReceiptSchema>> => {
      try {
        const result = await releaseMatch(
          scope(request),
          (request.params as z.infer<typeof IdParams>).id,
          request.body as ReleaseDecision,
        );
        reply.code(result.created ? 201 : 200);
        return result.receipt;
      } catch (error) {
        return safeReconciliationError(error);
      }
    },
  );
}

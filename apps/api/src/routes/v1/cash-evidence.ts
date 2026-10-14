import { ApiError } from '@dentabill/types';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  CashEvidenceSchema,
  CashHistorySchema,
  CashInputSchema,
  CashListSchema,
  CashPreviewSchema,
  CashReviewInputSchema,
  type CashReviewInput,
} from '../../lib/cash-evidence/contract.js';
import {
  cashEvidenceHistory,
  importCashEvidence,
  listCashEvidence,
  previewCashEvidence,
  reviewCashEvidence,
  safeCashError,
  type CashScope,
} from '../../lib/cash-evidence/service.js';
import { getEnv } from '../../lib/env.js';

const IdParams = z.strictObject({ id: z.uuid() });
const ListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(2048).optional(),
});
const security = [{ bearer: [] as string[] }];
function scope(request: FastifyRequest): CashScope {
  const auth = request.dentabillAuth;
  if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
  return { organizationId: auth.orgId, userId: auth.userId };
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function cashEvidenceRoutes(fastify: FastifyInstance): Promise<void> {
  // Parser/validation diagnostics may contain account data; keep them out of
  // the application's raw error logger as well as the public response.
  fastify.setErrorHandler((error, request, reply) => {
    if (ApiError.isApiError(error)) return reply.code(error.statusCode).send(error.toJson());
    const status =
      error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const validation = error && typeof error === 'object' && 'validation' in error;
    if (validation || status === 400 || status === 413) {
      return reply
        .code(status === 413 ? 413 : 400)
        .send(
          new ApiError(
            'VALIDATION_ERROR',
            'Check the cash evidence request format, field limits and source references.',
          ).toJson(),
        );
    }
    if (status === 429)
      return reply
        .code(429)
        .send(new ApiError('RATE_LIMITED', 'Too many requests. Try again shortly.').toJson());
    request.log.error(
      { requestId: request.id, code: 'CASH_EVIDENCE_REQUEST_FAILED' },
      'Cash evidence request failed',
    );
    return reply
      .code(500)
      .send(
        new ApiError(
          'INTERNAL_ERROR',
          'Cash evidence work could not be completed. Retry the same request or refresh the evidence.',
        ).toJson(),
      );
  });
  fastify.withTypeProvider().get(
    '/cash-evidence',
    {
      preHandler: fastify.auth.requireAuth,
      schema: { security, querystring: ListQuery, response: { 200: CashListSchema } },
    },
    async (request): Promise<z.infer<typeof CashListSchema>> => {
      try {
        const query = request.query as z.infer<typeof ListQuery>;
        return await listCashEvidence(scope(request), query.limit, query.cursor);
      } catch (error) {
        return safeCashError(error);
      }
    },
  );
  fastify.withTypeProvider().post(
    '/cash-evidence',
    {
      preHandler: fastify.auth.requireAuth,
      bodyLimit: 64 * 1024,
      schema: {
        security,
        body: CashInputSchema,
        response: { 200: CashEvidenceSchema, 201: CashEvidenceSchema },
        description:
          'Import one manual version 1 bank-account source observation. Does not verify bank receipt, allocate claims, post payments or establish settlement.',
      },
    },
    async (request, reply): Promise<z.infer<typeof CashEvidenceSchema>> => {
      try {
        const result = await importCashEvidence(
          scope(request),
          request.body,
          getEnv().DOB_HASH_SECRET,
        );
        reply.code(result.created ? 201 : 200);
        return result.evidence;
      } catch (error) {
        return safeCashError(error);
      }
    },
  );
  fastify.withTypeProvider().get(
    '/cash-evidence/transactions/:id',
    {
      preHandler: fastify.auth.requireAuth,
      schema: {
        security,
        params: IdParams,
        querystring: ListQuery,
        response: { 200: CashHistorySchema },
      },
    },
    async (request): Promise<z.infer<typeof CashHistorySchema>> => {
      try {
        const { id } = request.params as z.infer<typeof IdParams>;
        const query = request.query as z.infer<typeof ListQuery>;
        return await cashEvidenceHistory(scope(request), id, query.limit, query.cursor);
      } catch (error) {
        return safeCashError(error);
      }
    },
  );
  fastify.withTypeProvider().get(
    '/cash-evidence/:id/preview',
    {
      preHandler: fastify.auth.requireAuth,
      schema: { security, params: IdParams, response: { 200: CashPreviewSchema } },
    },
    async (request): Promise<z.infer<typeof CashPreviewSchema>> => {
      try {
        const { id } = request.params as z.infer<typeof IdParams>;
        return await previewCashEvidence(scope(request), id);
      } catch (error) {
        return safeCashError(error);
      }
    },
  );
  fastify.withTypeProvider().post(
    '/cash-evidence/:id/review',
    {
      preHandler: fastify.auth.requireAuth,
      bodyLimit: 4096,
      schema: {
        security,
        params: IdParams,
        body: CashReviewInputSchema,
        response: { 200: CashEvidenceSchema },
      },
    },
    async (request): Promise<z.infer<typeof CashEvidenceSchema>> => {
      try {
        const { id } = request.params as z.infer<typeof IdParams>;
        return await reviewCashEvidence(scope(request), id, request.body as CashReviewInput);
      } catch (error) {
        return safeCashError(error);
      }
    },
  );
}

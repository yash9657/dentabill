import { ApiError } from '@dentabill/types';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { getEnv } from '../../lib/env.js';
import {
  BatchEvidenceSchema,
  BatchHistorySchema,
  BatchInputSchema,
  BatchListSchema,
  BatchPreviewSchema,
  BatchReviewInputSchema,
  type BatchReviewInput,
} from '../../lib/remittance-batches/contract.js';
import {
  importBatchEvidence,
  listBatchHistory,
  listBatchEvidence,
  previewBatchEvidence,
  reviewBatchEvidence,
  safeBatchError,
  type BatchScope,
} from '../../lib/remittance-batches/service.js';

const IdParams = z.strictObject({ id: z.uuid() });
const ListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(20).default(10),
  cursor: z.string().min(1).max(2048).optional(),
});
const security = [{ bearer: [] as string[] }];
function scope(request: FastifyRequest): BatchScope {
  const auth = request.dentabillAuth;
  if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
  return { organizationId: auth.orgId, userId: auth.userId };
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function remittanceBatchRoutes(fastify: FastifyInstance): Promise<void> {
  // Source validation errors can contain sensitive financial fields. Never forward raw errors.
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
            'Check the batch evidence format, field limits and source references.',
          ).toJson(),
        );
    if (status === 429)
      return reply
        .code(429)
        .send(new ApiError('RATE_LIMITED', 'Too many requests. Try again shortly.').toJson());
    request.log.error(
      { requestId: request.id, code: 'BATCH_EVIDENCE_REQUEST_FAILED' },
      'Batch evidence request failed',
    );
    return reply
      .code(500)
      .send(
        new ApiError(
          'INTERNAL_ERROR',
          'Batch evidence work could not be completed. Retry the same request or refresh the evidence.',
        ).toJson(),
      );
  });
  fastify.withTypeProvider().get(
    '/remittance-batches',
    {
      preHandler: fastify.auth.requireAuth,
      schema: { security, querystring: ListQuery, response: { 200: BatchListSchema } },
    },
    async (request): Promise<z.infer<typeof BatchListSchema>> => {
      try {
        const query = request.query as z.infer<typeof ListQuery>;
        return await listBatchEvidence(scope(request), query.limit, query.cursor);
      } catch (error) {
        return safeBatchError(error);
      }
    },
  );
  fastify.withTypeProvider().post(
    '/remittance-batches',
    {
      preHandler: fastify.auth.requireAuth,
      bodyLimit: 256 * 1024,
      schema: {
        security,
        body: BatchInputSchema,
        response: { 200: BatchEvidenceSchema, 201: BatchEvidenceSchema },
        description:
          'Import an immutable manual batch observation. Version 2 corrections retain the original source batch identity and use a new source record with an explicit sequence. Source member ownership and existing cash reservations remain retained across revisions. Payer-reported net is separate from bank cash, allocation, posting and settlement.',
      },
    },
    async (request, reply): Promise<z.infer<typeof BatchEvidenceSchema>> => {
      try {
        const result = await importBatchEvidence(
          scope(request),
          request.body,
          getEnv().DOB_HASH_SECRET,
        );
        reply.code(result.created ? 201 : 200);
        return result.evidence;
      } catch (error) {
        return safeBatchError(error);
      }
    },
  );
  fastify.withTypeProvider().get(
    '/remittance-batches/:id/preview',
    {
      preHandler: fastify.auth.requireAuth,
      schema: { security, params: IdParams, response: { 200: BatchPreviewSchema } },
    },
    async (request): Promise<z.infer<typeof BatchPreviewSchema>> => {
      try {
        return await previewBatchEvidence(
          scope(request),
          (request.params as z.infer<typeof IdParams>).id,
        );
      } catch (error) {
        return safeBatchError(error);
      }
    },
  );
  fastify.withTypeProvider().get(
    '/remittance-batches/:id/history',
    {
      preHandler: fastify.auth.requireAuth,
      schema: {
        security,
        params: IdParams,
        querystring: ListQuery,
        response: { 200: BatchHistorySchema },
      },
    },
    async (request): Promise<z.infer<typeof BatchHistorySchema>> => {
      try {
        const query = request.query as z.infer<typeof ListQuery>;
        return await listBatchHistory(
          scope(request),
          (request.params as z.infer<typeof IdParams>).id,
          query.limit,
          query.cursor,
        );
      } catch (error) {
        return safeBatchError(error);
      }
    },
  );
  fastify.withTypeProvider().post(
    '/remittance-batches/:id/review',
    {
      preHandler: fastify.auth.requireAuth,
      bodyLimit: 4096,
      schema: {
        security,
        params: IdParams,
        body: BatchReviewInputSchema,
        response: { 200: BatchEvidenceSchema },
      },
    },
    async (request): Promise<z.infer<typeof BatchEvidenceSchema>> => {
      try {
        return await reviewBatchEvidence(
          scope(request),
          (request.params as z.infer<typeof IdParams>).id,
          request.body as BatchReviewInput,
        );
      } catch (error) {
        return safeBatchError(error);
      }
    },
  );
}

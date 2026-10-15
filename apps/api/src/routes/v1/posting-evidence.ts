import { ApiError } from '@dentabill/types';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { getEnv } from '../../lib/env.js';
import {
  PostingEvidenceSchema,
  PostingHistorySchema,
  PostingInputSchema,
  PostingListSchema,
  PostingPreviewSchema,
  PostingReviewInputSchema,
  type PostingReviewInput,
} from '../../lib/posting-evidence/contract.js';
import {
  postingEvidenceHistory,
  importPostingEvidence,
  listPostingEvidence,
  previewPostingEvidence,
  reviewPostingEvidence,
  safePostingError,
  type PostingScope,
} from '../../lib/posting-evidence/service.js';

const IdParams = z.strictObject({ id: z.uuid() });
const ListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(20).default(10),
  cursor: z.string().min(1).max(2048).optional(),
});
const security = [{ bearer: [] as string[] }];
function scope(request: FastifyRequest): PostingScope {
  const auth = request.dentabillAuth;
  if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
  return { organizationId: auth.orgId, userId: auth.userId };
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function postingEvidenceRoutes(fastify: FastifyInstance): Promise<void> {
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
            'Check the posting evidence request format, field limits and source references.',
          ).toJson(),
        );
    }
    if (status === 429)
      return reply
        .code(429)
        .send(new ApiError('RATE_LIMITED', 'Too many requests. Try again shortly.').toJson());
    request.log.error(
      { requestId: request.id, code: 'POSTING_EVIDENCE_REQUEST_FAILED' },
      'Posting evidence request failed',
    );
    return reply
      .code(500)
      .send(
        new ApiError(
          'INTERNAL_ERROR',
          'Posting evidence work could not be completed. Retry the same request or refresh the evidence.',
        ).toJson(),
      );
  });
  fastify.withTypeProvider().get(
    '/posting-evidence',
    {
      preHandler: fastify.auth.requireAuth,
      schema: { security, querystring: ListQuery, response: { 200: PostingListSchema } },
    },
    async (request): Promise<z.infer<typeof PostingListSchema>> => {
      try {
        const query = request.query as z.infer<typeof ListQuery>;
        return await listPostingEvidence(scope(request), query.limit, query.cursor);
      } catch (error) {
        return safePostingError(error);
      }
    },
  );
  fastify.withTypeProvider().post(
    '/posting-evidence',
    {
      preHandler: fastify.auth.requireAuth,
      bodyLimit: 256 * 1024,
      schema: {
        security,
        body: PostingInputSchema,
        response: { 200: PostingEvidenceSchema, 201: PostingEvidenceSchema },
        description:
          'Import one manual version 1 PMS posting source observation. Preserves header and entry facts without linking local claims, verifying bank receipt or issuing a payment instruction.',
      },
    },
    async (request, reply): Promise<z.infer<typeof PostingEvidenceSchema>> => {
      try {
        const result = await importPostingEvidence(
          scope(request),
          request.body,
          getEnv().DOB_HASH_SECRET,
        );
        reply.code(result.created ? 201 : 200);
        return result.evidence;
      } catch (error) {
        return safePostingError(error);
      }
    },
  );
  fastify.withTypeProvider().get(
    '/posting-evidence/receipts/:id',
    {
      preHandler: fastify.auth.requireAuth,
      schema: {
        security,
        params: IdParams,
        querystring: ListQuery,
        response: { 200: PostingHistorySchema },
      },
    },
    async (request): Promise<z.infer<typeof PostingHistorySchema>> => {
      try {
        const { id } = request.params as z.infer<typeof IdParams>;
        const query = request.query as z.infer<typeof ListQuery>;
        return await postingEvidenceHistory(scope(request), id, query.limit, query.cursor);
      } catch (error) {
        return safePostingError(error);
      }
    },
  );
  fastify.withTypeProvider().get(
    '/posting-evidence/:id/preview',
    {
      preHandler: fastify.auth.requireAuth,
      schema: { security, params: IdParams, response: { 200: PostingPreviewSchema } },
    },
    async (request): Promise<z.infer<typeof PostingPreviewSchema>> => {
      try {
        const { id } = request.params as z.infer<typeof IdParams>;
        return await previewPostingEvidence(scope(request), id);
      } catch (error) {
        return safePostingError(error);
      }
    },
  );
  fastify.withTypeProvider().post(
    '/posting-evidence/:id/review',
    {
      preHandler: fastify.auth.requireAuth,
      bodyLimit: 4096,
      schema: {
        security,
        params: IdParams,
        body: PostingReviewInputSchema,
        response: { 200: PostingEvidenceSchema },
      },
    },
    async (request): Promise<z.infer<typeof PostingEvidenceSchema>> => {
      try {
        const { id } = request.params as z.infer<typeof IdParams>;
        return await reviewPostingEvidence(scope(request), id, request.body as PostingReviewInput);
      } catch (error) {
        return safePostingError(error);
      }
    },
  );
}

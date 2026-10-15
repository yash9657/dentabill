import { ApiError } from '@dentabill/types';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  RelationshipCandidateSchema,
  RelationshipDecisionSchema,
  RelationshipListSchema,
  RelationshipPreviewSchema,
  RelationshipReceiptSchema,
  RelationshipReleaseCandidateSchema,
  RelationshipReleaseDecisionSchema,
  RelationshipReleasePreviewSchema,
  RelationshipReleaseReceiptSchema,
  RelationshipTargetsSchema,
} from '../../lib/posting-relationships/contract.js';
import {
  createRelationship,
  listRelationships,
  listRelationshipTargets,
  previewRelationship,
  previewRelationshipRelease,
  releaseRelationship,
  safeRelationshipError,
  type RelationshipScope,
} from '../../lib/posting-relationships/service.js';

const IdParams = z.strictObject({ id: z.uuid() });
const ListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(20).default(10),
  cursor: z.string().min(1).max(2048).optional(),
  receiptId: z.uuid().optional(),
});
const security = [{ bearer: [] as string[] }];
function scope(request: FastifyRequest): RelationshipScope {
  const auth = request.dentabillAuth;
  if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
  return { organizationId: auth.orgId, userId: auth.userId };
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function postingRelationshipRoutes(fastify: FastifyInstance): Promise<void> {
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
            'Check the posting entry, claim, preview and retry fields.',
          ).toJson(),
        );
    if (status === 429)
      return reply
        .code(429)
        .send(new ApiError('RATE_LIMITED', 'Too many requests. Try again shortly.').toJson());
    request.log.error(
      { requestId: request.id, code: 'POSTING_RELATIONSHIP_REQUEST_FAILED' },
      'Posting relationship request failed',
    );
    return reply
      .code(500)
      .send(
        new ApiError(
          'INTERNAL_ERROR',
          'Posting relationships could not be completed. Retry the same request or refresh the evidence.',
        ).toJson(),
      );
  });
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/posting-evidence/:id/relationship-targets',
    {
      preHandler: fastify.auth.requireAuth,
      schema: { security, params: IdParams, response: { 200: RelationshipTargetsSchema } },
    },
    async (request): Promise<z.infer<typeof RelationshipTargetsSchema>> => {
      try {
        return await listRelationshipTargets(scope(request), request.params.id);
      } catch (error) {
        return safeRelationshipError(error);
      }
    },
  );
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/posting-relationships',
    {
      preHandler: fastify.auth.requireAuth,
      schema: { security, querystring: ListQuery, response: { 200: RelationshipListSchema } },
    },
    async (request): Promise<z.infer<typeof RelationshipListSchema>> => {
      try {
        const query = request.query;
        return await listRelationships(scope(request), query.limit, query.cursor, query.receiptId);
      } catch (error) {
        return safeRelationshipError(error);
      }
    },
  );
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/posting-relationships/preview',
    {
      preHandler: fastify.auth.requireAuth,
      bodyLimit: 4096,
      schema: {
        security,
        body: RelationshipCandidateSchema,
        response: { 200: RelationshipPreviewSchema },
      },
    },
    async (request): Promise<z.infer<typeof RelationshipPreviewSchema>> => {
      try {
        return await previewRelationship(scope(request), request.body);
      } catch (error) {
        return safeRelationshipError(error);
      }
    },
  );
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/posting-relationships',
    {
      preHandler: fastify.auth.requireAuth,
      bodyLimit: 4096,
      schema: {
        security,
        body: RelationshipDecisionSchema,
        response: { 200: RelationshipReceiptSchema, 201: RelationshipReceiptSchema },
        description:
          'Review an exact source identity association from a current accepted posting entry to an imported claim and optional source line. Retains entry identity until explicit release. Does not allocate cash, verify payment or submit a posting.',
      },
    },
    async (request, reply): Promise<z.infer<typeof RelationshipReceiptSchema>> => {
      try {
        const result = await createRelationship(scope(request), request.body);
        reply.code(result.created ? 201 : 200);
        return result.receipt;
      } catch (error) {
        return safeRelationshipError(error);
      }
    },
  );
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/posting-relationships/:id/release/preview',
    {
      preHandler: fastify.auth.requireAuth,
      bodyLimit: 4096,
      schema: {
        security,
        params: IdParams,
        body: RelationshipReleaseCandidateSchema,
        response: { 200: RelationshipReleasePreviewSchema },
      },
    },
    async (request): Promise<z.infer<typeof RelationshipReleasePreviewSchema>> => {
      try {
        return await previewRelationshipRelease(
          scope(request),
          request.params.id,
          request.body.reason,
        );
      } catch (error) {
        return safeRelationshipError(error);
      }
    },
  );
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/posting-relationships/:id/release',
    {
      preHandler: fastify.auth.requireAuth,
      bodyLimit: 4096,
      schema: {
        security,
        params: IdParams,
        body: RelationshipReleaseDecisionSchema,
        response: { 200: RelationshipReleaseReceiptSchema, 201: RelationshipReleaseReceiptSchema },
      },
    },
    async (request, reply): Promise<z.infer<typeof RelationshipReleaseReceiptSchema>> => {
      try {
        const result = await releaseRelationship(scope(request), request.params.id, request.body);
        reply.code(result.created ? 201 : 200);
        return result.receipt;
      } catch (error) {
        return safeRelationshipError(error);
      }
    },
  );
}

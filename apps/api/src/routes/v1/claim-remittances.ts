import { ApiError } from '@dentabill/types';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { getEnv } from '../../lib/env.js';
import {
  EvidenceResponseSchema,
  ListResponseSchema,
  PreviewResponseSchema,
  RemittanceInputSchema,
  ReviewInputSchema,
  type ReviewInput,
} from '../../lib/remittances/contract.js';
import {
  importRemittance,
  listRemittances,
  previewRemittance,
  reviewRemittance,
  safeRemittanceError,
  type RemittanceScope,
} from '../../lib/remittances/service.js';

const ClaimParams = z.strictObject({ id: z.string().min(1).max(128) });
const EvidenceParams = z.strictObject({ claimId: z.string().min(1).max(128), id: z.uuid() });
const ListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(2048).optional(),
});
const security = [{ bearer: [] as string[] }];

function scope(request: FastifyRequest, claimId: string): RemittanceScope {
  const auth = request.dentabillAuth;
  if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
  return { organizationId: auth.orgId, userId: auth.userId, claimId };
}

// Fastify requires its promise plugin form even when registration is synchronous.
// eslint-disable-next-line @typescript-eslint/require-await
export async function claimRemittanceRoutes(fastify: FastifyInstance): Promise<void> {
  // Validation and JSON parser errors can contain source values. Keep this
  // boundary closed before any error reaches the application's raw error logger.
  fastify.setErrorHandler((error, request, reply) => {
    if (ApiError.isApiError(error)) return reply.code(error.statusCode).send(error.toJson());
    const status =
      error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const validation = error && typeof error === 'object' && 'validation' in error;
    if (validation || status === 400 || status === 413) {
      const failure = new ApiError(
        'VALIDATION_ERROR',
        'Check the remittance request format, field limits and source references.',
      );
      return reply.code(status === 413 ? 413 : 400).send(failure.toJson());
    }
    if (status === 429) {
      return reply
        .code(429)
        .send(new ApiError('RATE_LIMITED', 'Too many requests. Try again shortly.').toJson());
    }
    request.log.error(
      { requestId: request.id, code: 'REMITTANCE_REQUEST_FAILED' },
      'Remittance request failed',
    );
    return reply
      .code(500)
      .send(
        new ApiError(
          'INTERNAL_ERROR',
          'Remittance work could not be completed. Retry the same request or refresh the evidence.',
        ).toJson(),
      );
  });

  fastify.withTypeProvider().get(
    '/claims/:id/remittances',
    {
      preHandler: fastify.auth.requireAuth,
      schema: {
        security,
        params: ClaimParams,
        querystring: ListQuery,
        response: { 200: ListResponseSchema },
      },
    },
    async (request): Promise<z.infer<typeof ListResponseSchema>> => {
      try {
        const { id } = request.params as z.infer<typeof ClaimParams>;
        const query = request.query as z.infer<typeof ListQuery>;
        return await listRemittances(scope(request, id), query.limit, query.cursor);
      } catch (error) {
        return safeRemittanceError(error);
      }
    },
  );

  fastify.withTypeProvider().post(
    '/claims/:id/remittances',
    {
      preHandler: fastify.auth.requireAuth,
      bodyLimit: 1024 * 1024,
      schema: {
        description:
          'Import a custom version 1 claim-level payer report. Does not establish cash receipt, posting or settlement.',
        security,
        params: ClaimParams,
        body: RemittanceInputSchema,
        response: { 200: EvidenceResponseSchema, 201: EvidenceResponseSchema },
      },
    },
    async (request, reply): Promise<z.infer<typeof EvidenceResponseSchema>> => {
      try {
        const { id } = request.params as z.infer<typeof ClaimParams>;
        const result = await importRemittance(
          scope(request, id),
          request.body,
          getEnv().DOB_HASH_SECRET,
        );
        reply.code(result.created ? 201 : 200);
        return result.evidence;
      } catch (error) {
        return safeRemittanceError(error);
      }
    },
  );

  fastify.withTypeProvider().get(
    '/claims/:claimId/remittances/:id/preview',
    {
      preHandler: fastify.auth.requireAuth,
      schema: { security, params: EvidenceParams, response: { 200: PreviewResponseSchema } },
    },
    async (request): Promise<z.infer<typeof PreviewResponseSchema>> => {
      try {
        const { claimId, id } = request.params as z.infer<typeof EvidenceParams>;
        return await previewRemittance(scope(request, claimId), id);
      } catch (error) {
        return safeRemittanceError(error);
      }
    },
  );

  fastify.withTypeProvider().post(
    '/claims/:claimId/remittances/:id/review',
    {
      preHandler: fastify.auth.requireAuth,
      schema: {
        security,
        params: EvidenceParams,
        body: ReviewInputSchema,
        response: { 200: EvidenceResponseSchema },
      },
    },
    async (request): Promise<z.infer<typeof EvidenceResponseSchema>> => {
      try {
        const { claimId, id } = request.params as z.infer<typeof EvidenceParams>;
        return await reviewRemittance(scope(request, claimId), id, request.body as ReviewInput);
      } catch (error) {
        return safeRemittanceError(error);
      }
    },
  );
}

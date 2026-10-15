import {
  audit,
  prisma,
  ClaimObservationConflictError,
  ObservationRegenerationError,
} from '@dentabill/db';
import {
  createObservationRegenerationService,
  REGENERATION_REASON_CODES,
  RegenerationUnavailableError,
  type ObservationRegenerationConfig,
} from '@dentabill/summary-worker';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { getEnv } from '../../lib/env.js';
import type { AuthIdentity } from '../../plugins/auth.js';

export interface ObservationRegenerationRoutesOptions {
  /** Trusted server configuration only. Null disables new provider work in fixtures. */
  readonly config?: ObservationRegenerationConfig | null;
}
const IdSchema = z.object({ id: z.string().min(1).max(128) }).strict();
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const StatusSchema = z
  .object({
    id: z.string().min(1).max(128),
    state: z.enum([
      'READY',
      'RUNNING',
      'RESULT_SAVED',
      'PUBLISHED',
      'REVIEW_REQUIRED',
      'PROVEN_UNSENT_FAILED',
      'FAILED',
      'EXPIRED',
      'UNAVAILABLE',
    ]),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    canResume: z.boolean(),
    observationId: z.string().min(1).max(128).nullable(),
    reasonCode: z.enum(REGENERATION_REASON_CODES).nullable(),
  })
  .strict();
const PreviewSchema = z
  .object({
    observationId: z.string(),
    claimId: z.string(),
    callId: z.string(),
    canRegenerate: z.boolean(),
    blockedReason: z
      .enum([
        'CONFIGURATION_UNAVAILABLE',
        'RELEASE_UNAVAILABLE',
        'SOURCE_UNAVAILABLE',
        'WORK_NOT_READY',
      ])
      .nullable(),
    previewDigest: HashSchema.nullable(),
    dataClass: z.enum(['SYNTHETIC', 'PROTECTED']),
    nextGeneration: z.number().int().min(2).nullable(),
    claimVersion: z.iso.datetime(),
    source: z
      .object({
        id: z.string().min(1).max(128),
        version: z.string().min(1).max(128),
        text: z.string().min(1).max(65_536),
      })
      .strict()
      .nullable(),
    release: z
      .object({
        id: z.string().min(1).max(128),
        model: z.string().min(1).max(256),
        policyHash: HashSchema,
        tokenAllowance: z.number().int().nonnegative(),
        maxAttempts: z.union([z.literal(1), z.literal(2)]),
        deadlineMs: z.number().int().min(1).max(30_000),
      })
      .strict()
      .nullable(),
    activeAuthorization: StatusSchema.nullable(),
  })
  .strict();
const RegenerateBodySchema = z
  .object({
    expectedPreviewDigest: HashSchema,
    idempotencyKey: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_.-]+$/),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

function toSafeError(error: unknown): never {
  if (ApiError.isApiError(error)) throw error;
  if (error instanceof RegenerationUnavailableError)
    throw new ApiError(
      'OBSERVATION_REGENERATION_UNAVAILABLE',
      'Regeneration is not available with the current server configuration.',
    );
  if (
    error instanceof ClaimObservationConflictError ||
    error instanceof ObservationRegenerationError
  ) {
    if (error.code === 'NOT_FOUND')
      throw new ApiError('NOT_FOUND', 'Observation work not found in your organization.');
    if (error.code === 'FORBIDDEN')
      throw new ApiError('FORBIDDEN', 'Only an owner or admin may authorize regeneration.');
    if (error.code === 'INVALID_INPUT')
      throw new ApiError('VALIDATION_ERROR', 'Check the regeneration request fields.');
    throw new ApiError(
      'CONFLICT',
      'The reviewed snapshot or authorization changed. Refresh before continuing.',
    );
  }
  throw new ApiError(
    'INTERNAL_ERROR',
    'Regeneration work could not be completed. Check its saved status before trying again.',
  );
}

async function requireOwner(request: FastifyRequest): Promise<AuthIdentity> {
  const auth = request.dentabillAuth;
  if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'Sign in to continue.');
  const actor = await prisma.user.findFirst({
    where: { id: auth.userId, organizationId: auth.orgId },
    select: { role: true },
  });
  if (actor?.role !== 'OWNER' && actor?.role !== 'ADMIN')
    throw new ApiError('FORBIDDEN', 'Only an owner or admin may authorize regeneration.');
  return auth;
}

async function recordAccess(
  auth: AuthIdentity,
  resourceId: string,
  operation: 'PREVIEW' | 'REGENERATE' | 'RESUME',
): Promise<void> {
  await audit({
    organizationId: auth.orgId,
    userId: auth.userId,
    action: 'observationRegeneration.accessed',
    resourceType: operation === 'PREVIEW' ? 'ClaimObservation' : 'ObservationRegeneration',
    resourceId,
    metadata: { operation },
  });
}

async function executeBounded<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  const disconnected = (): void => {
    if (!reply.raw.writableEnded) abort();
  };
  request.raw.once('aborted', abort);
  reply.raw.once('close', disconnected);
  let rejectDeadline: ((error: ApiError) => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => {
    abort();
    rejectDeadline?.(
      new ApiError(
        'OBSERVATION_REGENERATION_UNAVAILABLE',
        'The request time limit was reached. Check its saved status before trying again.',
      ),
    );
  }, 30_000);
  timer.unref();
  try {
    if (request.raw.destroyed && !request.raw.complete) abort();
    // Promise.race observes a later execution rejection too. A late database
    // commit can remain discoverable, while the aborted signal prevents a send.
    return await Promise.race([execute(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    request.raw.off('aborted', abort);
    reply.raw.off('close', disconnected);
  }
}

export function observationRegenerationRoutes(
  fastify: FastifyInstance,
  options: ObservationRegenerationRoutesOptions,
): void {
  const env = getEnv();
  const config: ObservationRegenerationConfig = options.config ?? {
    dailyTokenLimit: env.SUMMARIZER_DAILY_TOKEN_BUDGET,
    ...(options.config !== null && env.FIREWORKS_API_KEY ? { apiKey: env.FIREWORKS_API_KEY } : {}),
    ...(options.config !== null && env.OBSERVATION_IMPLEMENTATION_ARTIFACT_SHA256
      ? { implementationArtifactSha256: env.OBSERVATION_IMPLEMENTATION_ARTIFACT_SHA256 }
      : {}),
  };
  const service = createObservationRegenerationService({ prisma, config });
  const security = [{ bearer: [] as string[] }];
  fastify.withTypeProvider().get(
    '/observations/:id/regeneration-preview',
    {
      preHandler: fastify.auth.requireAuth,
      schema: {
        description:
          'Owner/Admin review of an exact new-generation snapshot and any already saved authorization. Token allowance is an operational bound, not a dollar quote.',
        security,
        params: IdSchema,
        response: { 200: PreviewSchema },
      },
    },
    async (request): Promise<z.infer<typeof PreviewSchema>> => {
      try {
        const auth = await requireOwner(request);
        const { id } = request.params as z.infer<typeof IdSchema>;
        const preview = await service.preview({
          organizationId: auth.orgId,
          clerkUserId: auth.clerkUserId,
          observationId: id,
        });
        const parsed = PreviewSchema.safeParse(preview);
        if (!parsed.success)
          throw new ApiError('INTERNAL_ERROR', 'Regeneration preview could not be displayed.');
        await recordAccess(auth, id, 'PREVIEW');
        return parsed.data;
      } catch (error) {
        return toSafeError(error);
      }
    },
  );
  fastify.withTypeProvider().post(
    '/observations/:id/regenerate',
    {
      preHandler: fastify.auth.requireAuth,
      schema: {
        description:
          'Persist explicit Owner/Admin authorization before bounded model work. Identical keys resume that same authorization; no automatic background queue is created.',
        security,
        params: IdSchema,
        body: RegenerateBodySchema,
        response: { 200: StatusSchema },
      },
    },
    async (request, reply): Promise<z.infer<typeof StatusSchema>> => {
      try {
        const auth = await requireOwner(request);
        const { id } = request.params as z.infer<typeof IdSchema>;
        const body = request.body as z.infer<typeof RegenerateBodySchema>;
        const result = await executeBounded(request, reply, (signal) =>
          service.regenerate({
            organizationId: auth.orgId,
            clerkUserId: auth.clerkUserId,
            observationId: id,
            ...body,
            signal,
          }),
        );
        const parsed = StatusSchema.safeParse(result);
        if (!parsed.success)
          throw new ApiError('INTERNAL_ERROR', 'Saved regeneration status could not be displayed.');
        await recordAccess(auth, parsed.data.id, 'REGENERATE');
        return parsed.data;
      } catch (error) {
        return toSafeError(error);
      }
    },
  );
  fastify.withTypeProvider().post(
    '/observation-regenerations/:id/resume',
    {
      preHandler: fastify.auth.requireAuth,
      preValidation: (request, _reply, done): void => {
        if (request.body === undefined) request.body = {};
        done();
      },
      schema: {
        description:
          'Resume only an existing saved authorization. Never creates a new inference generation.',
        security,
        params: IdSchema,
        body: z.object({}).strict().optional(),
        response: { 200: StatusSchema },
      },
    },
    async (request, reply): Promise<z.infer<typeof StatusSchema>> => {
      try {
        const auth = await requireOwner(request);
        const { id } = request.params as z.infer<typeof IdSchema>;
        const result = await executeBounded(request, reply, (signal) =>
          service.resume({
            organizationId: auth.orgId,
            clerkUserId: auth.clerkUserId,
            authorizationId: id,
            signal,
          }),
        );
        const parsed = StatusSchema.safeParse(result);
        if (!parsed.success)
          throw new ApiError('INTERNAL_ERROR', 'Saved regeneration status could not be displayed.');
        await recordAccess(auth, parsed.data.id, 'RESUME');
        return parsed.data;
      } catch (error) {
        return toSafeError(error);
      }
    },
  );
}

import { createHash } from 'node:crypto';

import {
  authorizeObservationRegeneration,
  audit,
  markInferenceReviewed,
  ObservationRegenerationError,
  previewObservationRegeneration,
  reserveFireworksInferenceRun,
  type ObservationRegeneration,
  type PreviewObservationRegenerationInput,
  type Prisma,
  type prisma,
} from '@dentabill/db';
import {
  buildObservationRequestBody,
  createReleaseRegistry,
  GatewayRequestSchema,
  ReleaseSchema,
  releasePolicyHash,
  validateGatewayInput,
  type FireworksTransport,
  type GatewayRequest,
  type ModelRelease,
} from '@dentabill/model-gateway';
import { selectCallTranscript } from '@dentabill/types';

import { createDurableObservationGateway } from './observation-inference.js';
import { publishStoredObservation } from './observation-publication.js';
import { observationSourceVersion } from './observation-source.js';

type Db = typeof prisma;
export interface ObservationRegenerationConfig {
  readonly apiKey?: string;
  readonly implementationArtifactSha256?: string;
  readonly dailyTokenLimit: number;
  readonly releases?: readonly ModelRelease[];
  /** Trusted local fixture seam, never supplied by a caller. */
  readonly transport?: FireworksTransport;
}
export const REGENERATION_REASON_CODES = [
  'AWAITING_EXECUTION',
  'PROCESSING',
  'PUBLICATION_REQUIRED',
  'APPROVAL_EXPIRED',
  'INFERENCE_REVIEW_REQUIRED',
  'INFERENCE_FAILED',
  'CONFIGURATION_UNAVAILABLE',
  'RELEASE_UNAVAILABLE',
  'BUDGET_EXCEEDED',
  'CLAIM_OR_SOURCE_CHANGED',
  'CANCELLED',
] as const;
type ReasonCode = (typeof REGENERATION_REASON_CODES)[number];
type UnavailableCode =
  | 'CONFIGURATION_UNAVAILABLE'
  | 'RELEASE_UNAVAILABLE'
  | 'SOURCE_UNAVAILABLE'
  | 'WORK_NOT_READY';
export class RegenerationUnavailableError extends Error {
  constructor(readonly code: UnavailableCode) {
    super('Observation regeneration is unavailable.');
    this.name = 'RegenerationUnavailableError';
  }
}
export interface RegenerationStatus {
  readonly id: string;
  readonly state:
    | 'READY'
    | 'RUNNING'
    | 'RESULT_SAVED'
    | 'PUBLISHED'
    | 'REVIEW_REQUIRED'
    | 'PROVEN_UNSENT_FAILED'
    | 'FAILED'
    | 'EXPIRED'
    | 'UNAVAILABLE';
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly canResume: boolean;
  readonly observationId: string | null;
  readonly reasonCode: ReasonCode | null;
}
export interface RegenerationPreview {
  observationId: string;
  claimId: string;
  callId: string;
  canRegenerate: boolean;
  blockedReason: UnavailableCode | null;
  previewDigest: string | null;
  dataClass: 'SYNTHETIC' | 'PROTECTED';
  nextGeneration: number | null;
  claimVersion: string;
  source: { id: string; version: string; text: string } | null;
  release: {
    id: string;
    model: string;
    policyHash: string;
    tokenAllowance: number;
    maxAttempts: 1 | 2;
    deadlineMs: number;
  } | null;
  activeAuthorization: RegenerationStatus | null;
}
interface ActorInput {
  organizationId: string;
  clerkUserId: string;
}
interface PreviewInput extends ActorInput {
  observationId: string;
}
interface RegenerateInput extends PreviewInput {
  expectedPreviewDigest: string;
  idempotencyKey: string;
  reason: string;
  signal?: AbortSignal;
}
interface ResumeInput extends ActorInput {
  authorizationId: string;
  signal?: AbortSignal;
}
export interface ObservationRegenerationService {
  preview(input: PreviewInput): Promise<RegenerationPreview>;
  regenerate(input: RegenerateInput): Promise<RegenerationStatus>;
  resume(input: ResumeInput): Promise<RegenerationStatus>;
}
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
function savedRequest(auth: ObservationRegeneration): GatewayRequest {
  const request = GatewayRequestSchema.parse(auth.requestPayload);
  if (
    !validateGatewayInput(request) ||
    hash(request) !== auth.requestHash ||
    hash(request.sources) !== auth.sourceHash ||
    request.organizationId !== auth.organizationId ||
    request.claim.id !== auth.claimId ||
    request.claim.version !== auth.claimVersion.toISOString() ||
    request.releaseId !== auth.releaseId ||
    request.invocationId !== `observation.${auth.callId}.g${String(auth.generation)}`
  )
    throw new ObservationRegenerationError('AUTHORIZATION_INVALID');
  return request;
}
function savedRelease(auth: ObservationRegeneration): ModelRelease {
  if (typeof auth.releaseSnapshot !== 'string')
    throw new ObservationRegenerationError('AUTHORIZATION_INVALID');
  const release = ReleaseSchema.parse(JSON.parse(auth.releaseSnapshot));
  if (
    release.policy.id !== auth.releaseId ||
    releasePolicyHash(release.policy) !== auth.releasePolicyHash ||
    release.policy.implementationArtifactSha256 !== auth.implementationArtifactSha256
  )
    throw new ObservationRegenerationError('AUTHORIZATION_INVALID');
  return release;
}

/** Owner-approved synchronous execution; durable authorization and receipts survive HTTP disconnects. */
export function createObservationRegenerationService(options: {
  prisma: Db;
  config: ObservationRegenerationConfig;
}): ObservationRegenerationService {
  const db = options.prisma;
  const config = {
    ...options.config,
    ...(options.config.releases ? { releases: structuredClone(options.config.releases) } : {}),
  };
  const registry = createReleaseRegistry(config);
  const configured = (): boolean =>
    !!config.apiKey &&
    /^[\x21-\x7e]{1,4096}$/.test(config.apiKey) &&
    !!config.implementationArtifactSha256 &&
    /^[a-f0-9]{64}$/.test(config.implementationArtifactSha256) &&
    Number.isSafeInteger(config.dailyTokenLimit) &&
    config.dailyTokenLimit > 0;
  const actor = async (input: ActorInput) => {
    const user = await db.user.findFirst({
      where: { organizationId: input.organizationId, clerkUserId: input.clerkUserId },
    });
    if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN'))
      throw new ObservationRegenerationError('FORBIDDEN');
    return user;
  };
  const availability = (auth: ObservationRegeneration, replayOnly: boolean): ReasonCode | null => {
    if (
      (!replayOnly && !configured()) ||
      config.implementationArtifactSha256 !== auth.implementationArtifactSha256
    )
      return 'CONFIGURATION_UNAVAILABLE';
    const request = savedRequest(auth);
    const resolution = replayOnly
      ? createReleaseRegistry({
          releases: [savedRelease(auth)],
          implementationArtifactSha256: config.implementationArtifactSha256,
          replayOnly: true,
        }).resolve(request)
      : registry.resolve(request);
    return !resolution.ok || releasePolicyHash(resolution.release.policy) !== auth.releasePolicyHash
      ? 'RELEASE_UNAVAILABLE'
      : null;
  };
  const work = (auth: ObservationRegeneration) =>
    db.inferenceRun.findFirst({
      where: { organizationId: auth.organizationId, regenerationId: auth.id },
      include: {
        attempts: { orderBy: { attemptNumber: 'asc' } },
        observation: { select: { id: true } },
      },
    });
  const review = async (auth: ObservationRegeneration, runId: string): Promise<void> => {
    await db.$transaction(async (tx) => {
      if (
        !(await markInferenceReviewed(tx, {
          organizationId: auth.organizationId,
          runId,
        }))
      )
        return;
      await audit(
        {
          organizationId: auth.organizationId,
          userId: auth.createdByUserId,
          action: 'observation.inference_review_required',
          resourceType: 'InferenceRun',
          resourceId: runId,
          metadata: {
            callId: auth.callId,
            generation: auth.generation,
            regenerationId: auth.id,
          },
        },
        tx,
      );
    });
  };
  const status = async (auth: ObservationRegeneration): Promise<RegenerationStatus> => {
    const run = await work(auth);
    const base = {
      id: auth.id,
      createdAt: auth.createdAt.toISOString(),
      expiresAt: auth.expiresAt.toISOString(),
      observationId: run?.observation?.id ?? null,
    };
    const result = (
      state: RegenerationStatus['state'],
      canResume: boolean,
      reasonCode: ReasonCode | null,
    ): RegenerationStatus => ({ ...base, state, canResume, reasonCode });
    if (run?.observation) return result('PUBLISHED', false, null);
    if (run?.state === 'RESPONDED') return result('RESULT_SAVED', true, 'PUBLICATION_REQUIRED');
    if (run?.state === 'REJECTED')
      return run.attempts.length === 0 &&
        run.totalTokens === 0n &&
        run.reservedTokens === 0n &&
        run.lastErrorCode === 'DEADLINE_EXCEEDED'
        ? result('PROVEN_UNSENT_FAILED', false, 'INFERENCE_FAILED')
        : result('FAILED', false, 'INFERENCE_FAILED');
    if (run?.leaseExpiresAt && run.leaseExpiresAt.getTime() > Date.now())
      return result('RUNNING', true, 'PROCESSING');
    if (run?.attempts.at(-1)?.responseRecordedAt) {
      const unavailable = availability(auth, true);
      return unavailable
        ? result('UNAVAILABLE', false, unavailable)
        : result('RESULT_SAVED', true, 'PUBLICATION_REQUIRED');
    }
    if (run && (run.attempts.length > 0 || run.state === 'UNKNOWN' || run.state === 'APPLIED'))
      return result('REVIEW_REQUIRED', false, 'INFERENCE_REVIEW_REQUIRED');
    // An unused reservation can be recovered to close its zero-send accounting, even after expiry.
    if (run?.executionDeadlineAt && run.executionDeadlineAt.getTime() <= Date.now())
      return result('READY', true, 'AWAITING_EXECUTION');
    if (auth.expiresAt.getTime() <= Date.now()) return result('EXPIRED', false, 'APPROVAL_EXPIRED');
    const unavailable = availability(auth, false);
    return unavailable
      ? result('UNAVAILABLE', false, unavailable)
      : result('READY', true, 'AWAITING_EXECUTION');
  };
  const buildPreview = async (
    input: PreviewInput,
  ): Promise<{
    dto: RegenerationPreview;
    authorizationInput?: PreviewObservationRegenerationInput;
  }> => {
    await actor(input);
    const observation = await db.claimObservation.findFirst({
      where: { id: input.observationId, organizationId: input.organizationId },
      include: { claim: true },
    });
    if (!observation) throw new ObservationRegenerationError('NOT_FOUND');
    const [lastRun, lastAuth, events] = await Promise.all([
      db.inferenceRun.findFirst({
        where: { organizationId: input.organizationId, callId: observation.callId },
        orderBy: { generation: 'desc' },
        select: { generation: true },
      }),
      db.observationRegeneration.findFirst({
        where: { organizationId: input.organizationId, callId: observation.callId },
        orderBy: { generation: 'desc' },
      }),
      db.callEvent.findMany({
        where: {
          callId: observation.callId,
          call: { organizationId: input.organizationId, claimId: observation.claimId },
          eventType: { in: ['call.ended', 'webhook.call.ended'] },
        },
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      }),
    ]);
    const dto: RegenerationPreview = {
      observationId: observation.id,
      claimId: observation.claimId,
      callId: observation.callId,
      canRegenerate: false,
      blockedReason: null,
      previewDigest: null,
      dataClass: observation.dataClass,
      nextGeneration: Math.max(lastRun?.generation ?? 1, lastAuth?.generation ?? 1) + 1,
      claimVersion: observation.claim.updatedAt.toISOString(),
      source: null,
      release: null,
      activeAuthorization: lastAuth ? await status(lastAuth) : null,
    };
    const unavailable = (code: UnavailableCode): { dto: RegenerationPreview } => ({
      dto: { ...dto, blockedReason: code },
    });
    const event = events.find((candidate) =>
      Object.prototype.hasOwnProperty.call(candidate.data ?? {}, 'transcript'),
    );
    const transcript = selectCallTranscript(event ? [event] : []);
    if (!event || transcript.kind !== 'final' || !transcript.rawText?.trim())
      return unavailable('SOURCE_UNAVAILABLE');
    const source = {
      id: `transcript.${event.id}`,
      version: observationSourceVersion(transcript.rawText),
      text: transcript.rawText,
    };
    const parsed = GatewayRequestSchema.safeParse({
      organizationId: input.organizationId,
      invocationId: `observation.${observation.callId}.g${String(dto.nextGeneration)}`,
      releaseId: observation.releaseId,
      task: 'claim-observation.v1',
      dataClass: observation.dataClass,
      claim: {
        id: observation.claimId,
        organizationId: input.organizationId,
        version: dto.claimVersion,
        billedMinorUnits: Number(observation.claim.claimAmount.mul(100).toFixed(0)),
        currency: 'USD',
      },
      sources: [
        {
          ...source,
          organizationId: input.organizationId,
          claimId: observation.claimId,
          claimVersion: dto.claimVersion,
          kind: 'FINAL_CALL_TRANSCRIPT',
        },
      ],
    });
    if (!parsed.success || !validateGatewayInput(parsed.data))
      return unavailable('SOURCE_UNAVAILABLE');
    dto.source = source;
    if (!configured()) return unavailable('CONFIGURATION_UNAVAILABLE');
    const resolution = registry.resolve(parsed.data);
    if (!resolution.ok) return unavailable('RELEASE_UNAVAILABLE');
    const { release } = resolution;
    const bytes = Buffer.byteLength(buildObservationRequestBody(parsed.data, release), 'utf8');
    if (bytes > release.policy.limits.requestBytes) return unavailable('SOURCE_UNAVAILABLE');
    const policyHash = releasePolicyHash(release.policy);
    dto.release = {
      id: release.policy.id,
      model: release.policy.requestModel,
      policyHash,
      tokenAllowance: bytes * 2 + release.policy.limits.outputTokens,
      maxAttempts: release.policy.limits.maxAttempts,
      deadlineMs: release.policy.limits.deadlineMs,
    };
    const authorizationInput: PreviewObservationRegenerationInput = {
      ...input,
      callId: observation.callId,
      claimVersion: observation.claim.updatedAt,
      requestPayload: json(parsed.data),
      requestHash: hash(parsed.data),
      sourceHash: hash(parsed.data.sources),
      releaseId: parsed.data.releaseId,
      releasePolicyHash: policyHash,
      implementationArtifactSha256: config.implementationArtifactSha256 ?? '',
      releaseSnapshot: JSON.stringify(ReleaseSchema.parse(release)),
    };
    const preview = await previewObservationRegeneration(db, authorizationInput);
    dto.previewDigest = preview.previewDigest;
    dto.nextGeneration = preview.nextGeneration;
    dto.canRegenerate = preview.canAuthorize;
    dto.blockedReason = preview.canAuthorize ? null : 'WORK_NOT_READY';
    return { dto, authorizationInput };
  };
  const execute = async (
    auth: ObservationRegeneration,
    signal?: AbortSignal,
  ): Promise<RegenerationStatus> => {
    if (signal?.aborted) return { ...(await status(auth)), reasonCode: 'CANCELLED' };
    const run = await work(auth);
    if (run?.state === 'RESPONDED' || run?.state === 'APPLIED') {
      await publishStoredObservation({
        prisma: db,
        organizationId: auth.organizationId,
        runId: run.id,
      });
      return status(auth);
    }
    if (
      run?.state === 'REJECTED' ||
      (run?.state === 'UNKNOWN' && !run.attempts.at(-1)?.responseRecordedAt)
    ) {
      await review(auth, run.id);
      return status(auth);
    }
    if (run?.attempts.length && !run.attempts.at(-1)?.responseRecordedAt) {
      if (run.leaseExpiresAt && run.leaseExpiresAt.getTime() > Date.now()) return status(auth);
      savedRequest(auth);
      if (
        !run.executionDeadlineAt ||
        !run.releasePolicyHash ||
        !run.wireRequestHash ||
        (run.maxAttempts !== 1 && run.maxAttempts !== 2)
      )
        throw new ObservationRegenerationError('AUTHORIZATION_INVALID');
      const settled = await reserveFireworksInferenceRun(db, {
        organizationId: auth.organizationId,
        callId: auth.callId,
        claimId: run.claimId,
        claimVersion: run.claimVersion,
        sourceHash: run.sourceHash,
        requestHash: run.requestHash,
        releaseId: run.releaseId,
        promptVersion: run.promptVersion,
        requestPayload: json(run.requestPayload),
        reservationTokens: Number(run.tokenAllowance),
        dailyTokenLimit: config.dailyTokenLimit,
        maxAttempts: run.maxAttempts,
        executionDeadlineAt: run.executionDeadlineAt,
        releasePolicyHash: run.releasePolicyHash,
        wireRequestHash: run.wireRequestHash,
        regenerationId: auth.id,
        ...(typeof run.releaseSnapshot === 'string'
          ? { releaseSnapshot: run.releaseSnapshot }
          : {}),
      });
      if (settled.kind === 'BUSY') return status(auth);
      if (settled.kind !== 'REVIEW_REQUIRED' || !settled.run)
        throw new RegenerationUnavailableError('WORK_NOT_READY');
      await review(auth, settled.run.id);
      return status(auth);
    }
    const replayOnly = !!run?.attempts.at(-1)?.responseRecordedAt;
    const unusedExpired =
      !!run &&
      run.attempts.length === 0 &&
      !!run.executionDeadlineAt &&
      run.executionDeadlineAt.getTime() <= Date.now();
    if (!replayOnly && !unusedExpired && auth.expiresAt.getTime() <= Date.now())
      return status(auth);
    const unavailable = availability(auth, replayOnly || unusedExpired);
    if (unavailable)
      throw new RegenerationUnavailableError(
        unavailable === 'RELEASE_UNAVAILABLE' ? unavailable : 'CONFIGURATION_UNAVAILABLE',
      );
    const request = savedRequest(auth);
    const release = savedRelease(auth);
    if (signal?.aborted) return { ...(await status(auth)), reasonCode: 'CANCELLED' };
    const gateway = createDurableObservationGateway({
      prisma: db,
      callId: auth.callId,
      regenerationId: auth.id,
      dailyTokenLimit: config.dailyTokenLimit,
      apiKey: config.apiKey ?? '',
      releases: [release],
      implementationArtifactSha256: auth.implementationArtifactSha256,
      ...(replayOnly || unusedExpired ? { replayOnly: true } : {}),
      ...(config.transport ? { transport: config.transport } : {}),
    });
    const result = await gateway.generate(request, signal ? { signal } : {});
    if (result.status !== 'FAILED') {
      const stored = await work(auth);
      if (stored)
        await publishStoredObservation({
          prisma: db,
          organizationId: auth.organizationId,
          runId: stored.id,
        });
    } else {
      const stored = await work(auth);
      if (stored && (stored.state === 'UNKNOWN' || stored.state === 'REJECTED'))
        await review(auth, stored.id);
    }
    const current = await status(auth);
    if (result.status !== 'FAILED' || current.state !== 'READY') return current;
    if (result.code === 'BUDGET_EXCEEDED') return { ...current, reasonCode: 'BUDGET_EXCEEDED' };
    if (result.code === 'CANCELLED') return { ...current, reasonCode: 'CANCELLED' };
    if (['INVALID_REQUEST', 'INFERENCE_REVIEW_REQUIRED', 'ADMISSION_DENIED'].includes(result.code))
      return {
        ...current,
        state: 'UNAVAILABLE',
        canResume: false,
        reasonCode: 'CLAIM_OR_SOURCE_CHANGED',
      };
    return current;
  };
  return {
    async preview(input) {
      return (await buildPreview(input)).dto;
    },
    async regenerate(input) {
      const user = await actor(input);
      const existing = await db.observationRegeneration.findFirst({
        where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        if (
          existing.createdByUserId !== user.id ||
          existing.previousObservationId !== input.observationId ||
          existing.reason !== input.reason.trim() ||
          existing.previewDigest !== input.expectedPreviewDigest
        )
          throw new ObservationRegenerationError('IDEMPOTENCY_CONFLICT');
        return execute(existing, input.signal);
      }
      if (input.signal?.aborted) throw new RegenerationUnavailableError('WORK_NOT_READY');
      const { dto, authorizationInput } = await buildPreview(input);
      if (!authorizationInput)
        throw new RegenerationUnavailableError(dto.blockedReason ?? 'WORK_NOT_READY');
      const authorized = await authorizeObservationRegeneration(db, {
        ...authorizationInput,
        expectedPreviewDigest: input.expectedPreviewDigest,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
      });
      return execute(authorized.authorization, input.signal);
    },
    async resume(input) {
      await actor(input);
      const authorization = await db.observationRegeneration.findFirst({
        where: { id: input.authorizationId, organizationId: input.organizationId },
      });
      if (!authorization) throw new ObservationRegenerationError('NOT_FOUND');
      return execute(authorization, input.signal);
    },
  };
}

import { createHash } from 'node:crypto';

import {
  audit,
  markInferenceReviewed,
  reserveFireworksInferenceRun,
  type InferenceRun,
  type Prisma,
} from '@dentabill/db';
import {
  createReleaseRegistry,
  GatewayRequestSchema,
  ReleaseSchema,
  releasePolicyHash,
  validateGatewayInput,
  type FireworksTransport,
  type GatewayRequest,
  type ModelRelease,
} from '@dentabill/model-gateway';
import { SummaryJobDataSchema, type SummaryJobResult } from '@dentabill/queue';
import { selectCallTranscript } from '@dentabill/types';

import type { SummaryHandler, SummaryHandlerDeps } from './handler.js';
import { createDurableObservationGateway } from './observation-inference.js';
import { publishStoredObservation } from './observation-publication.js';
import { observationSourceVersion } from './observation-source.js';
import { ObservationJobError, SummaryInferenceBusyError } from './summary-errors.js';

export interface ObservationJobConfig {
  readonly apiKey?: string;
  readonly releaseId?: string;
  readonly implementationArtifactSha256?: string;
  readonly dailyTokenLimit: number;
  readonly releases?: readonly ModelRelease[];
  /** Trusted constructor seams for local synthetic tests, never queue/API/environment input. */
  readonly transport?: FireworksTransport;
  readonly dataClass?: 'SYNTHETIC' | 'PROTECTED';
}

const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const tokens = (value: bigint | null): number | null =>
  value !== null && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;

function savedRequest(run: InferenceRun): GatewayRequest {
  const parsed = GatewayRequestSchema.safeParse(run.requestPayload);
  if (
    !parsed.success ||
    !validateGatewayInput(parsed.data) ||
    parsed.data.organizationId !== run.organizationId ||
    parsed.data.claim.id !== run.claimId ||
    parsed.data.claim.version !== run.claimVersion.toISOString() ||
    parsed.data.releaseId !== run.releaseId ||
    hash(parsed.data) !== run.requestHash ||
    hash(parsed.data.sources) !== run.sourceHash
  )
    throw new ObservationJobError('OBSERVATION_REQUEST_INVALID');
  return parsed.data;
}

function archivedRelease(run: InferenceRun): ModelRelease | undefined {
  if (run.releaseSnapshot === null) return undefined;
  if (typeof run.releaseSnapshot !== 'string')
    throw new ObservationJobError('OBSERVATION_REQUEST_INVALID');
  const release = ReleaseSchema.parse(JSON.parse(run.releaseSnapshot));
  if (
    release.policy.id !== run.releaseId ||
    releasePolicyHash(release.policy) !== run.releasePolicyHash
  )
    throw new ObservationJobError('OBSERVATION_REQUEST_INVALID');
  return release;
}

/** Generation one only. Later generations require the separate, exact-snapshot approval flow. */
export function createObservationJobHandler(deps: SummaryHandlerDeps): SummaryHandler {
  const db = deps.prisma;
  const { transport, ...overrides } = deps.observationConfig ?? {};
  const config: ObservationJobConfig = structuredClone({
    ...(deps.env.FIREWORKS_API_KEY ? { apiKey: deps.env.FIREWORKS_API_KEY } : {}),
    ...(deps.env.OBSERVATION_RELEASE_ID ? { releaseId: deps.env.OBSERVATION_RELEASE_ID } : {}),
    ...(deps.env.OBSERVATION_IMPLEMENTATION_ARTIFACT_SHA256
      ? { implementationArtifactSha256: deps.env.OBSERVATION_IMPLEMENTATION_ARTIFACT_SHA256 }
      : {}),
    dailyTokenLimit: deps.env.SUMMARIZER_DAILY_TOKEN_BUDGET,
    ...overrides,
  });
  return async (job) => {
    try {
      const data = SummaryJobDataSchema.parse(job.data);
      const scope = { organizationId: data.organizationId, callId: data.callId, generation: 1 };
      const work = () =>
        db.inferenceRun.findFirst({
          where: scope,
          include: {
            attempts: { orderBy: { attemptNumber: 'asc' } },
            observation: { select: { id: true } },
          },
        });
      const result = (
        run: InferenceRun,
        outcome: SummaryJobResult['outcome'],
        observationId: string | null = null,
      ): SummaryJobResult => ({
        summaryId: null,
        observationId,
        outcome,
        tokensUsed: tokens(run.totalTokens),
        promptVersion: run.promptVersion,
      });
      const publish = async (run: InferenceRun): Promise<SummaryJobResult> => {
        const published = await publishStoredObservation({
          prisma: db,
          organizationId: data.organizationId,
          runId: run.id,
        });
        return result(run, 'OBSERVATION_PUBLISHED', published.observation.id);
      };
      const review = async (run: InferenceRun): Promise<SummaryJobResult> => {
        await db.$transaction(async (tx) => {
          if (
            await markInferenceReviewed(tx, { organizationId: data.organizationId, runId: run.id })
          )
            await tx.auditLog.create({
              data: {
                organizationId: data.organizationId,
                action: 'observation.inference_review_required',
                resourceType: 'InferenceRun',
                resourceId: run.id,
                metadata: { callId: data.callId, generation: 1 },
              },
            });
        });
        return result(run, 'INFERENCE_REVIEW_REQUIRED');
      };
      let run = await work();
      if (run && run.provider !== 'FIREWORKS')
        throw new ObservationJobError('OBSERVATION_REQUEST_INVALID');
      if (run) {
        await audit({
          organizationId: data.organizationId,
          action: 'observation.job_snapshot.read',
          resourceType: 'InferenceRun',
          resourceId: run.id,
          metadata: { callId: data.callId, generation: 1 },
        });
        if (run.state === 'RESPONDED' || run.state === 'APPLIED') return await publish(run);
        if (run.state === 'REJECTED') return await review(run);
        const unusedExpired =
          run.attempts.length === 0 &&
          !!run.executionDeadlineAt &&
          run.executionDeadlineAt.getTime() <= Date.now();
        if (!unusedExpired && run.leaseExpiresAt && run.leaseExpiresAt.getTime() > Date.now())
          throw new SummaryInferenceBusyError();
        // Unknown acceptance is settled using saved bindings, independent of current credentials.
        // This path requires an expired unused reservation or an attempt without a receipt.
        if (
          unusedExpired ||
          (run.attempts.length > 0 && !run.attempts.at(-1)?.responseRecordedAt)
        ) {
          savedRequest(run);
          if (
            !run.executionDeadlineAt ||
            !run.releasePolicyHash ||
            !run.wireRequestHash ||
            (run.maxAttempts !== 1 && run.maxAttempts !== 2)
          )
            throw new ObservationJobError('OBSERVATION_REQUEST_INVALID');
          const settled = await reserveFireworksInferenceRun(db, {
            ...scope,
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
            ...(typeof run.releaseSnapshot === 'string'
              ? { releaseSnapshot: run.releaseSnapshot }
              : {}),
          });
          if (settled.kind === 'BUSY') throw new SummaryInferenceBusyError();
          if (!['REVIEW_REQUIRED', 'DEADLINE_EXCEEDED'].includes(settled.kind) || !settled.run)
            throw new ObservationJobError('OBSERVATION_EXECUTION_UNCONFIRMED');
          return await review(settled.run);
        }
        if (run.state === 'UNKNOWN' && run.attempts.length === 0) return await review(run);
      }
      let request: GatewayRequest;
      if (run) request = savedRequest(run);
      else {
        const call = await db.call.findFirst({
          where: { id: data.callId, organizationId: data.organizationId },
          include: { claim: true },
        });
        if (!call || !['COMPLETED', 'FAILED', 'VOICEMAIL'].includes(call.status))
          throw new ObservationJobError('OBSERVATION_SOURCE_UNAVAILABLE');
        const events = await db.callEvent.findMany({
          where: {
            callId: call.id,
            call: { organizationId: data.organizationId },
            eventType: { in: ['call.ended', 'webhook.call.ended'] },
          },
          orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        });
        await audit({
          organizationId: data.organizationId,
          action: 'observation.job_source.read',
          resourceType: 'Call',
          resourceId: call.id,
        });
        const event = events.find((candidate) =>
          Object.prototype.hasOwnProperty.call(candidate.data ?? {}, 'transcript'),
        );
        const transcript = selectCallTranscript(event ? [event] : []);
        if (!event || transcript.kind !== 'final' || !transcript.rawText?.trim())
          throw new ObservationJobError('OBSERVATION_SOURCE_UNAVAILABLE');
        if (!config.releaseId)
          throw new ObservationJobError('OBSERVATION_CONFIGURATION_UNAVAILABLE');
        request = GatewayRequestSchema.parse({
          organizationId: data.organizationId,
          invocationId: `observation.${call.id}.g1`,
          releaseId: config.releaseId,
          task: 'claim-observation.v1',
          dataClass: config.dataClass ?? 'PROTECTED',
          claim: {
            id: call.claimId,
            organizationId: data.organizationId,
            version: call.claim.updatedAt.toISOString(),
            billedMinorUnits: Number(call.claim.claimAmount.mul(100).toFixed(0)),
            currency: 'USD',
          },
          sources: [
            {
              id: `transcript.${event.id}`,
              version: observationSourceVersion(transcript.rawText),
              text: transcript.rawText,
              organizationId: data.organizationId,
              claimId: call.claimId,
              claimVersion: call.claim.updatedAt.toISOString(),
              kind: 'FINAL_CALL_TRANSCRIPT',
            },
          ],
        });
      }
      const replayOnly =
        !!run?.attempts.at(-1)?.responseRecordedAt ||
        !!(
          run?.attempts.length === 0 &&
          run.executionDeadlineAt &&
          run.executionDeadlineAt.getTime() <= Date.now()
        );
      if (!config.implementationArtifactSha256 || (!replayOnly && !config.apiKey))
        throw new ObservationJobError('OBSERVATION_CONFIGURATION_UNAVAILABLE');
      const archived = run ? archivedRelease(run) : undefined;
      const releases = replayOnly && archived ? [archived] : config.releases;
      // Legacy null snapshots may use only a currently approved exact policy, never invented history.
      const resolution = createReleaseRegistry({
        ...(releases ? { releases } : {}),
        implementationArtifactSha256: config.implementationArtifactSha256,
        replayOnly: replayOnly && !!archived,
      }).resolve(request);
      if (
        !resolution.ok ||
        (run && releasePolicyHash(resolution.release.policy) !== run.releasePolicyHash)
      )
        throw new ObservationJobError('OBSERVATION_RELEASE_UNAVAILABLE');
      const gateway = createDurableObservationGateway({
        prisma: db,
        callId: data.callId,
        dailyTokenLimit: config.dailyTokenLimit,
        apiKey: config.apiKey ?? '',
        releases: [resolution.release],
        implementationArtifactSha256: config.implementationArtifactSha256,
        ...(transport ? { transport } : {}),
        ...(replayOnly ? { replayOnly: true } : {}),
      });
      const generated = await gateway.generate(request);
      run = await work();
      if (run?.state === 'RESPONDED' || run?.state === 'APPLIED') return await publish(run);
      if (run?.state === 'REJECTED') return await review(run);
      if (run?.state === 'UNKNOWN' && !run.attempts.at(-1)?.responseRecordedAt)
        return await review(run);
      if (generated.status === 'FAILED' && generated.code === 'INFERENCE_BUSY')
        throw new SummaryInferenceBusyError();
      if (generated.status === 'FAILED' && generated.code === 'BUDGET_EXCEEDED')
        throw new ObservationJobError('OBSERVATION_BUDGET_EXCEEDED');
      throw new ObservationJobError('OBSERVATION_EXECUTION_UNCONFIRMED');
    } catch (error) {
      if (error instanceof ObservationJobError || error instanceof SummaryInferenceBusyError)
        throw error;
      throw new ObservationJobError('OBSERVATION_EXECUTION_UNCONFIRMED');
    }
  };
}

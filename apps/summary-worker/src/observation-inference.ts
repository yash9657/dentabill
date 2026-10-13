import { createHash } from 'node:crypto';

import {
  beginFireworksAttempt,
  finalizeFireworksInference,
  finishFireworksAttempt,
  getFireworksAttemptReceipt,
  parseFireworksRawResponse,
  recordFireworksResponse,
  reserveFireworksInferenceRun,
  type InferenceAttempt,
  type Prisma,
  type prisma,
} from '@dentabill/db';
import {
  createFireworksGateway,
  GatewayResultSchema,
  PROMPT_VERSION,
  TransportAttemptSchema,
  type FireworksTransport,
  type GatewayJournalFactory,
  type GatewayJournalOpen,
  type ModelGateway,
  type ModelRelease,
  type TransportAttempt,
  type TransportReplay,
} from '@dentabill/model-gateway';

import { isStoredObservationSource } from './observation-source.js';

type Db = typeof prisma;

export interface DurableObservationGatewayOptions {
  readonly prisma: Db;
  readonly callId: string;
  readonly dailyTokenLimit: number;
  readonly apiKey: string;
  readonly releases: readonly ModelRelease[];
  readonly implementationArtifactSha256: string;
  readonly regenerationId?: string;
  readonly replayOnly?: boolean;
  /** Trusted local fixture seam; never selected through API input or an environment URL. */
  readonly transport?: FireworksTransport;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function attemptDto(attempt: InferenceAttempt): TransportAttempt {
  return TransportAttemptSchema.parse(getFireworksAttemptReceipt(attempt));
}

function responseReplay(attempts: readonly InferenceAttempt[]): TransportReplay {
  const last = attempts.at(-1);
  if (!last?.responseRecordedAt) throw new Error('Durable response is unavailable.');
  const receipt = parseFireworksRawResponse(last.responsePayload);
  if (!receipt) throw new Error('Durable response is invalid.');
  return {
    attempts: attempts.slice(0, -1).map(attemptDto),
    response: {
      index: last.attemptNumber,
      status: receipt.status,
      body: receipt.body,
      retryDelayMs: receipt.retryDelayMs ?? 0,
    },
  };
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Durable native inference only; this adapter never applies an observation to a claim. */
export function createDurableObservationGateway(
  options: DurableObservationGatewayOptions,
): ModelGateway {
  const journalFactory: GatewayJournalFactory = {
    async open(binding, context): Promise<GatewayJournalOpen> {
      if (isAborted(context.signal)) return { kind: 'DENIED', code: 'CANCELLED' };
      const { request } = binding;
      const call = await options.prisma.call.findFirst({
        where: {
          organizationId: request.organizationId,
          id: options.callId,
          claimId: request.claim.id,
          status: { in: ['COMPLETED', 'FAILED', 'VOICEMAIL'] },
        },
        include: { claim: true },
      });
      if (!call) return { kind: 'DENIED', code: 'INVALID_REQUEST' };
      const authorization = options.regenerationId
        ? await options.prisma.observationRegeneration.findFirst({
            where: {
              id: options.regenerationId,
              organizationId: request.organizationId,
              callId: call.id,
            },
          })
        : null;
      if (options.regenerationId && !authorization)
        return { kind: 'DENIED', code: 'INFERENCE_REVIEW_REQUIRED' };
      const existing = await options.prisma.inferenceRun.findFirst({
        where: {
          organizationId: request.organizationId,
          callId: call.id,
          generation: authorization?.generation ?? 1,
        },
        select: {
          id: true,
          provider: true,
          executionDeadlineAt: true,
          requestHash: true,
          releasePolicyHash: true,
          wireRequestHash: true,
          state: true,
          attempts: { orderBy: { attemptNumber: 'asc' }, select: { responseRecordedAt: true } },
        },
      });
      if (
        options.replayOnly &&
        (!existing ||
          (!['RESPONDED', 'APPLIED', 'REJECTED'].includes(existing.state) &&
            !existing.attempts.at(-1)?.responseRecordedAt &&
            !(
              existing.attempts.length === 0 &&
              existing.executionDeadlineAt &&
              existing.executionDeadlineAt.getTime() <= Date.now()
            )))
      )
        return { kind: 'DENIED', code: 'INFERENCE_REVIEW_REQUIRED' };
      if (!(await isStoredObservationSource(options.prisma, call.id, request, !existing)))
        return { kind: 'DENIED', code: 'INVALID_REQUEST' };
      if (
        existing &&
        (existing.provider !== 'FIREWORKS' ||
          existing.requestHash !== hash(request) ||
          existing.releasePolicyHash !== binding.releasePolicyHash ||
          existing.wireRequestHash !== binding.wireRequestHash ||
          !existing.executionDeadlineAt)
      )
        return { kind: 'DENIED', code: 'INFERENCE_REVIEW_REQUIRED' };
      if (
        !existing &&
        (call.claim.updatedAt.toISOString() !== request.claim.version ||
          !call.claim.claimAmount.mul(100).equals(request.claim.billedMinorUnits))
      )
        return { kind: 'DENIED', code: 'INVALID_REQUEST' };
      if (isAborted(context.signal)) return { kind: 'DENIED', code: 'CANCELLED' };
      const reservation = await reserveFireworksInferenceRun(options.prisma, {
        organizationId: request.organizationId,
        callId: call.id,
        claimId: call.claimId,
        claimVersion: new Date(request.claim.version),
        sourceHash: hash(request.sources),
        requestHash: hash(request),
        releaseId: request.releaseId,
        promptVersion: PROMPT_VERSION,
        requestPayload: json(request),
        // Operational token allowance, not an exact tokenizer estimate or monetary cap.
        reservationTokens: binding.requestBytes * 2 + binding.limits.outputTokens,
        dailyTokenLimit: options.dailyTokenLimit,
        maxAttempts: binding.limits.maxAttempts,
        executionDeadlineAt:
          existing?.executionDeadlineAt ??
          new Date(
            Math.min(
              Date.parse(binding.executionDeadlineAt),
              authorization?.expiresAt.getTime() ?? Infinity,
            ),
          ),
        releasePolicyHash: binding.releasePolicyHash,
        wireRequestHash: binding.wireRequestHash,
        ...(authorization ? { regenerationId: authorization.id } : {}),
        implementationArtifactSha256: options.implementationArtifactSha256,
      });
      if (isAborted(context.signal)) return { kind: 'DENIED', code: 'CANCELLED' };
      if (
        reservation.run &&
        (reservation.run.requestHash !== hash(request) ||
          reservation.run.sourceHash !== hash(request.sources) ||
          reservation.run.releasePolicyHash !== binding.releasePolicyHash ||
          reservation.run.wireRequestHash !== binding.wireRequestHash)
      )
        return { kind: 'DENIED', code: 'INFERENCE_REVIEW_REQUIRED' };
      const finalRun = reservation.run;
      if ((reservation.kind === 'RESUME' || reservation.kind === 'ALREADY_APPLIED') && finalRun) {
        const result = GatewayResultSchema.safeParse(finalRun.resultPayload);
        if (!result.success) return { kind: 'DENIED', code: 'INFERENCE_REVIEW_REQUIRED' };
        return { kind: 'RESULT', result: result.data };
      }
      if (reservation.kind !== 'OWNED' && reservation.kind !== 'REPLAY') {
        return {
          kind: 'DENIED',
          code:
            reservation.kind === 'BUSY'
              ? 'INFERENCE_BUSY'
              : reservation.kind === 'BUDGET_EXCEEDED'
                ? 'BUDGET_EXCEEDED'
                : reservation.kind === 'DEADLINE_EXCEEDED'
                  ? 'DEADLINE_EXCEEDED'
                  : reservation.kind === 'NOT_FOUND'
                    ? 'INVALID_REQUEST'
                    : 'INFERENCE_REVIEW_REQUIRED',
        };
      }
      const { run, leaseToken } = reservation;
      if (!run.executionDeadlineAt) return { kind: 'DENIED', code: 'INFERENCE_REVIEW_REQUIRED' };
      const ownership = { organizationId: request.organizationId, runId: run.id, leaseToken };
      let writesPending = 0;
      const write = async <T>(operation: () => Promise<T>): Promise<T> => {
        writesPending++;
        try {
          return await operation();
        } finally {
          writesPending--;
        }
      };
      return {
        kind: 'READY',
        session: {
          executionDeadlineAt: run.executionDeadlineAt.toISOString(),
          ...(reservation.kind === 'REPLAY'
            ? { replay: responseReplay(reservation.attempts) }
            : {}),
          journal: {
            async beforeAttempt(input) {
              if (options.replayOnly || isAborted(context.signal)) return 'BLOCKED';
              if (input.index !== 1 && input.index !== 2) return 'BLOCKED';
              const admission = await write(() =>
                beginFireworksAttempt(options.prisma, {
                  ...ownership,
                  attemptNumber: input.index as 1 | 2,
                  wireRequestHash: input.wireRequestHash,
                  implementationArtifactSha256: options.implementationArtifactSha256,
                }),
              );
              return isAborted(context.signal) ? 'BLOCKED' : admission.kind;
            },
            async recordResponse(receipt) {
              if (receipt.index !== 1 && receipt.index !== 2)
                throw new Error('Invalid durable attempt.');
              await write(() =>
                recordFireworksResponse(options.prisma, {
                  ...ownership,
                  attemptNumber: receipt.index as 1 | 2,
                  response: {
                    status: receipt.status,
                    body: receipt.body,
                    retryDelayMs: receipt.retryDelayMs,
                  },
                }),
              );
            },
            async completeAttempt(receipt) {
              await write(() =>
                finishFireworksAttempt(options.prisma, { ...ownership, ...receipt }),
              );
            },
          },
          async complete(result) {
            if (result.status === 'FAILED' && result.code === 'JOURNAL_ERROR') return;
            if (writesPending > 0) throw new Error('Durable inference write remains pending.');
            const validated = GatewayResultSchema.parse(result);
            await finalizeFireworksInference(options.prisma, {
              ...ownership,
              status: validated.status,
              resultPayload: json(validated),
              errorCode: validated.status === 'FAILED' ? validated.code : null,
            });
          },
        },
      };
    },
  };
  return createFireworksGateway({
    apiKey: options.apiKey,
    releases: options.releases,
    implementationArtifactSha256: options.implementationArtifactSha256,
    ...(options.transport ? { transport: options.transport } : {}),
    journalFactory,
    ...(options.replayOnly ? { replayOnly: true } : {}),
  });
}

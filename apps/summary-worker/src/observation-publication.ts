import { createHash } from 'node:crypto';

import {
  ClaimObservationConflictError,
  publishClaimObservation,
  type ClaimObservation as StoredClaimObservation,
  type Prisma,
  type prisma,
} from '@dentabill/db';
import {
  GatewayRequestSchema,
  GatewayResultSchema,
  validateGatewayInput,
  validateObservation,
  type GatewayRequest,
  type ModelGateway,
} from '@dentabill/model-gateway';

import { isStoredObservationSource } from './observation-source.js';

export interface ObservationPublication {
  readonly kind: 'PUBLISHED' | 'ALREADY_PUBLISHED';
  readonly observation: StoredClaimObservation;
}

/** Publish only validated durable evidence; callers cannot provide a replacement model response. */
export async function publishStoredObservation(options: {
  readonly prisma: typeof prisma;
  readonly organizationId: string;
  readonly runId: string;
}): Promise<ObservationPublication> {
  const run = await options.prisma.inferenceRun.findFirst({
    where: { id: options.runId, organizationId: options.organizationId },
  });
  if (!run) throw new ClaimObservationConflictError('NOT_FOUND');
  if (run.provider !== 'FIREWORKS' || !['RESPONDED', 'APPLIED'].includes(run.state))
    throw new ClaimObservationConflictError('INFERENCE_NOT_READY');
  if (run.state === 'APPLIED') {
    const observation = await options.prisma.claimObservation.findFirst({
      where: {
        organizationId: run.organizationId,
        inferenceRunId: run.id,
        claimId: run.claimId,
        callId: run.callId,
        claimVersion: run.claimVersion,
        sourceHash: run.sourceHash,
        requestHash: run.requestHash,
        releaseId: run.releaseId,
        provider: run.provider,
        promptVersion: run.promptVersion,
      },
    });
    const publicationAudit = observation
      ? await options.prisma.auditLog.findFirst({
          where: {
            organizationId: run.organizationId,
            action: 'claimObservation.published',
            resourceType: 'ClaimObservation',
            resourceId: observation.id,
            metadata: { path: ['inferenceRunId'], equals: run.id },
          },
          select: { id: true },
        })
      : null;
    if (!run.appliedAt || !observation || !publicationAudit)
      throw new ClaimObservationConflictError('INVALID_INFERENCE_RESULT');
    return { kind: 'ALREADY_PUBLISHED', observation };
  }
  const request = GatewayRequestSchema.safeParse(run.requestPayload);
  const result = GatewayResultSchema.safeParse(run.resultPayload);
  if (
    !request.success ||
    !result.success ||
    result.data.status === 'FAILED' ||
    !validateGatewayInput(request.data) ||
    request.data.organizationId !== run.organizationId ||
    request.data.claim.id !== run.claimId ||
    request.data.claim.version !== run.claimVersion.toISOString() ||
    request.data.releaseId !== run.releaseId ||
    result.data.provenance.kind !== 'FIREWORKS' ||
    result.data.provenance.releaseId !== run.releaseId ||
    (result.data.status === 'ABSTAINED') !== (result.data.output.disposition === 'ABSTAIN') ||
    !validateObservation(result.data.output, request.data).ok
  )
    throw new ClaimObservationConflictError('INVALID_INFERENCE_RESULT');
  if (!(await isStoredObservationSource(options.prisma, run.callId, request.data, false)))
    throw new ClaimObservationConflictError('INVALID_INFERENCE_RESULT');
  return publishClaimObservation(options.prisma, {
    organizationId: options.organizationId,
    runId: options.runId,
    validatedResult: JSON.parse(JSON.stringify(result.data)) as Prisma.InputJsonValue,
  });
}

/** The inference receipt remains independently recoverable if publication fails. */
export async function generateAndPublishObservation(options: {
  readonly prisma: typeof prisma;
  readonly callId: string;
  readonly gateway: ModelGateway;
  readonly request: GatewayRequest;
  readonly signal?: AbortSignal;
  readonly regenerationId?: string;
}): Promise<ObservationPublication> {
  const request = GatewayRequestSchema.safeParse(options.request);
  if (!request.success || !validateGatewayInput(request.data))
    throw new ClaimObservationConflictError('INVALID_INPUT');
  const result = await options.gateway.generate(
    request.data,
    options.signal ? { signal: options.signal } : {},
  );
  if (result.status === 'FAILED') throw new ClaimObservationConflictError('INFERENCE_NOT_READY');
  const run = await options.prisma.inferenceRun.findFirst({
    where: {
      organizationId: request.data.organizationId,
      callId: options.callId,
      ...(options.regenerationId ? { regenerationId: options.regenerationId } : { generation: 1 }),
      requestHash: createHash('sha256').update(JSON.stringify(request.data)).digest('hex'),
    },
    select: { id: true },
  });
  if (!run) throw new ClaimObservationConflictError('INFERENCE_NOT_READY');
  return publishStoredObservation({
    prisma: options.prisma,
    organizationId: options.request.organizationId,
    runId: run.id,
  });
}

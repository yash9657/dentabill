import { randomUUID } from 'node:crypto';

import type { prisma } from '@dentabill/db';
import {
  CANDIDATE_RELEASES,
  releasePolicyHash,
  type ClaimObservation,
  type GatewayRequest,
  type ModelRelease,
} from '@dentabill/model-gateway';

import { observationSourceVersion } from './observation-source.js';

export const OBSERVATION_TEST_ARTIFACT = '1'.repeat(64);
export const OBSERVATION_TEST_MODEL = 'accounts/synthetic/models/observation';

export async function seedObservation(
  db: typeof prisma,
): Promise<{ callId: string; request: GatewayRequest }> {
  const unique = randomUUID();
  const org = await db.organization.create({
    data: { name: 'Synthetic durable observation', clerkOrgId: `observation_${unique}` },
  });
  const claim = await db.claim.create({
    data: {
      organizationId: org.id,
      patientDOBHash: 'synthetic',
      claimNumber: 'SYNTHETIC-OBSERVATION',
      cdtCodes: ['D1110'],
      claimAmount: '100.00',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date('2026-10-01T00:00:00.000Z'),
      status: 'COMPLETED',
    },
  });
  const call = await db.call.create({
    data: {
      organizationId: org.id,
      claimId: claim.id,
      retellCallId: `synthetic_observation_${unique}`,
      status: 'COMPLETED',
      endedAt: new Date(),
    },
  });
  const version = claim.updatedAt.toISOString();
  const text = 'Payer: The claim is pending review.';
  const event = await db.callEvent.create({
    data: {
      callId: call.id,
      eventType: 'webhook.call.ended',
      data: { transcript: { text, turns: null } },
    },
  });
  return {
    callId: call.id,
    request: {
      organizationId: org.id,
      invocationId: `observation.${call.id}.g1`,
      releaseId: 'synthetic-durable-observation.v1',
      task: 'claim-observation.v1',
      dataClass: 'SYNTHETIC',
      claim: {
        id: claim.id,
        organizationId: org.id,
        version,
        billedMinorUnits: 10000,
        currency: 'USD',
      },
      sources: [
        {
          id: `transcript.${event.id}`,
          organizationId: org.id,
          claimId: claim.id,
          claimVersion: version,
          version: observationSourceVersion(text),
          kind: 'FINAL_CALL_TRANSCRIPT',
          text,
        },
      ],
    },
  };
}

export function observationRelease(
  organizationId: string,
  limits: Partial<ModelRelease['policy']['limits']> = {},
): ModelRelease {
  const candidate = CANDIDATE_RELEASES[0];
  if (!candidate) throw new Error('Synthetic release fixture is unavailable.');
  const policy: ModelRelease['policy'] = {
    ...structuredClone(candidate.policy),
    id: 'synthetic-durable-observation.v1',
    state: 'SYNTHETIC_EVALUATION',
    organizations: [organizationId],
    responseModels: [OBSERVATION_TEST_MODEL],
    implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
    limits: { ...candidate.policy.limits, ...limits },
    evidence: {
      publisherArtifactRevision: 'synthetic-publisher',
      licenseSha256: '2'.repeat(64),
      servingRevision: 'synthetic-serving',
      regionPolicyEvidenceId: 'synthetic-region',
      retentionPolicyEvidenceId: 'synthetic-retention',
      priceSnapshotId: 'synthetic-price',
      protectedDataApprovalId: null,
    },
  };
  return {
    policy,
    approval: {
      policySha256: releasePolicyHash(policy),
      reviewerId: 'synthetic-reviewer',
      evaluationId: 'synthetic-evaluation',
      runAuthorizationId: 'synthetic-local-only',
      reviewedAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2100-01-01T00:00:00.000Z',
    },
  };
}

export function observationOutput(request: GatewayRequest): ClaimObservation {
  const source = request.sources[0];
  if (!source) throw new Error('Synthetic observation source is unavailable.');
  return {
    disposition: 'OBSERVED',
    claimId: request.claim.id,
    claimVersion: request.claim.version,
    status: {
      value: 'PENDING_REPORTED',
      evidence: [
        {
          sourceId: source.id,
          sourceVersion: source.version,
          start: 0,
          end: source.text.length,
          quote: source.text,
        },
      ],
    },
    payerReportedPayment: null,
    denialCodes: [],
    proposedAction: 'FOLLOW_UP',
    abstentionReason: null,
  };
}

export type ObservationResponseVariant = 'valid' | 'model' | 'finish' | 'schema' | 'usage';

export function observationResponse(
  request: GatewayRequest,
  variant: ObservationResponseVariant = 'valid',
): string {
  return JSON.stringify({
    id: 'synthetic-response',
    model: variant === 'model' ? 'accounts/synthetic/models/unapproved' : OBSERVATION_TEST_MODEL,
    choices: [
      {
        index: 0,
        finish_reason: variant === 'finish' ? 'length' : 'stop',
        message: {
          role: 'assistant',
          content: JSON.stringify(
            variant === 'schema' ? { unrelated: true } : observationOutput(request),
          ),
        },
      },
    ],
    usage: { prompt_tokens: 19, completion_tokens: 12, total_tokens: variant === 'usage' ? 0 : 31 },
  });
}

import {
  FIREWORKS_ENDPOINT,
  PROMPT_VERSION,
  SCHEMA_VERSION,
  TASK_VERSION,
  type ClaimObservation,
  type GatewayRequest,
  type TransportResult,
  type TransportJournal,
  type GatewayJournalFactory,
} from './contracts.js';
import {
  CONTRACT_FINGERPRINTS,
  MAXIMUM_LIMITS,
  REQUEST_MODELS,
  releasePolicyHash,
  type ModelRelease,
} from './release.js';

export const TEST_ARTIFACT_HASH = '1'.repeat(64);

/** Explicit in-memory fixture only. Production callers must supply durable accounting. */
export function journalFixture(): TransportJournal {
  return {
    beforeAttempt: () => Promise.resolve('ADMITTED'),
    recordResponse: () => Promise.resolve(),
    completeAttempt: () => Promise.resolve(),
  };
}

export function journalFactoryFixture(): GatewayJournalFactory {
  return {
    open: (binding) =>
      Promise.resolve({
        kind: 'READY',
        session: {
          journal: journalFixture(),
          executionDeadlineAt: binding.executionDeadlineAt,
          complete: () => Promise.resolve(),
        },
      }),
  };
}

export function requestFixture(): GatewayRequest {
  return {
    organizationId: 'org-test',
    invocationId: 'invocation-test',
    releaseId: 'fixture-evaluation.v1',
    task: TASK_VERSION,
    dataClass: 'SYNTHETIC',
    claim: {
      id: 'claim-test',
      organizationId: 'org-test',
      version: '2026-10-13T12:00:00.000Z',
      billedMinorUnits: 60000,
      currency: 'USD',
    },
    sources: [
      {
        id: 'source-test',
        organizationId: 'org-test',
        claimId: 'claim-test',
        claimVersion: '2026-10-13T12:00:00.000Z',
        version: 'transcript.v1',
        kind: 'FINAL_CALL_TRANSCRIPT',
        text: 'Payer: The claim is pending review.',
      },
    ],
  };
}

export function observationFixture(request: GatewayRequest = requestFixture()): ClaimObservation {
  const source = request.sources[0];
  if (!source) throw new Error('FIXTURE_SOURCE_REQUIRED');
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

export function releaseFixture(): ModelRelease {
  const policy: ModelRelease['policy'] = {
    id: 'fixture-evaluation.v1',
    state: 'SYNTHETIC_EVALUATION',
    endpoint: FIREWORKS_ENDPOINT,
    requestModel: REQUEST_MODELS[0],
    responseModels: ['accounts/fixture/models/observed-response'],
    task: TASK_VERSION,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    fingerprints: CONTRACT_FINGERPRINTS,
    implementationArtifactSha256: TEST_ARTIFACT_HASH,
    organizations: ['org-test'],
    limits: { ...MAXIMUM_LIMITS },
    evidence: {
      publisherArtifactRevision: 'synthetic-publisher-revision',
      licenseSha256: '2'.repeat(64),
      servingRevision: 'synthetic-serving-revision',
      regionPolicyEvidenceId: 'synthetic-region-record',
      retentionPolicyEvidenceId: 'synthetic-retention-record',
      priceSnapshotId: 'synthetic-price-record',
      protectedDataApprovalId: null,
    },
  };
  return {
    policy,
    approval: {
      policySha256: releasePolicyHash(policy),
      reviewerId: 'synthetic-reviewer',
      evaluationId: 'synthetic-evaluation',
      runAuthorizationId: 'synthetic-budget',
      reviewedAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2100-01-01T00:00:00.000Z',
    },
  };
}

export function transportSuccess(output: ClaimObservation = observationFixture()): TransportResult {
  const usage = { inputTokens: 100, outputTokens: 30, totalTokens: 130, cachedInputTokens: null };
  return {
    ok: true,
    content: JSON.stringify(output),
    responseId: 'fixture-response',
    model: 'accounts/fixture/models/observed-response',
    usage,
    attempts: [
      {
        index: 1,
        httpStatus: 200,
        outcome: 'COMPLETED',
        acceptance: 'RESPONDED',
        elapsedMs: 1,
        usage,
      },
    ],
  };
}

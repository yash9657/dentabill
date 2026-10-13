import type { paths } from '@dentabill/api-sdk/types';

type ObservationList =
  paths['/v1/claims/{id}/observations']['get']['responses'][200]['content']['application/json'];
export function observationListFixture(): ObservationList {
  const quote = 'Payer: Payment of $80.00 was reported for this claim.';
  const sourceVersion = '83f1c29546a790de182bcf34698a52107ced4305a126db87941f30a5d68b92ec';
  const evidence = {
    sourceId: 'transcript-test',
    sourceVersion,
    start: 0,
    end: quote.length,
    quote,
  };
  return {
    nextCursor: null,
    hasMore: false,
    publishableCalls: [],
    items: [
      {
        id: 'observation-test',
        claimId: 'claim-test',
        callId: 'call-test',
        version: 1,
        claimVersion: '2026-10-13T00:00:00.000Z',
        digest: '1'.repeat(64),
        createdAt: '2026-10-13T01:00:00.000Z',
        dataClass: 'SYNTHETIC',
        isCurrent: true,
        canReview: true,
        staleReason: null,
        review: null,
        output: {
          disposition: 'OBSERVED',
          claimId: 'claim-test',
          claimVersion: '2026-10-13T00:00:00.000Z',
          status: { value: 'PAID_REPORTED', evidence: [evidence] },
          payerReportedPayment: { amountMinorUnits: 8000, currency: 'USD', evidence: [evidence] },
          denialCodes: [],
          proposedAction: 'REVIEW_PAYMENT',
          abstentionReason: null,
        },
        sources: [
          {
            id: 'transcript-test',
            version: sourceVersion,
            kind: 'FINAL_CALL_TRANSCRIPT',
            text: quote,
          },
        ],
        provenance: {
          kind: 'FIREWORKS',
          releaseId: 'synthetic-test.v1',
          task: 'claim-observation.v1',
          promptVersion: 'claim-observation-prompt.v1',
          schemaVersion: 'claim-observation-schema.v1',
          model: 'synthetic-observation',
          responseId: 'response-test',
          attempts: [
            {
              index: 1,
              httpStatus: 200,
              outcome: 'COMPLETED',
              acceptance: 'RESPONDED',
              elapsedMs: 1,
              usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: null },
            },
          ],
          usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: null },
          elapsedMs: 1,
        },
      },
    ],
  };
}

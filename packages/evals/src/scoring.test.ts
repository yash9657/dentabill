import {
  CANDIDATE_RELEASES,
  PROMPT_VERSION,
  SCHEMA_VERSION,
  SYNTHETIC_RELEASE_ID,
  TASK_VERSION,
  type ClaimObservation,
  type GatewayResult,
  type TransportAttempt,
  type Usage,
} from '@dentabill/model-gateway';
import { describe, expect, it } from 'vitest';

import {
  caseContentHash,
  caseInputHash,
  evaluationRequest,
  evidenceHash,
  TAGS,
  type EvaluationBundle,
  type EvaluationCase,
  type EvaluationCorpus,
  type EvaluationTarget,
} from './contracts.js';
import { evaluate, FAILURE_FLAGS } from './scoring.js';

const VERSION = '2026-01-01T00:00:00.000Z';
const UNKNOWN: Usage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  cachedInputTokens: null,
};
const SYNTHETIC: EvaluationTarget = { kind: 'SYNTHETIC_BASELINE', releaseId: SYNTHETIC_RELEASE_ID };
const textFor = (id: string): string => `Case ${id}: Payer reports payment of $450.`;

function evidence(id: string, quote = textFor(id), text = textFor(id)) {
  const start = text.indexOf(quote);
  return {
    sourceId: `source.${id}`,
    sourceVersion: `revision.${id}`,
    start,
    end: start + quote.length,
    quote,
  };
}

/** Hand-authored model prediction; never reads case.expected or a fixture gateway. */
function predictedPayment(
  id: string,
  amount = 45_000,
  quote = textFor(id),
  text = textFor(id),
): ClaimObservation {
  return {
    disposition: 'OBSERVED',
    claimId: `claim.${id}`,
    claimVersion: VERSION,
    status: { value: 'PAID_REPORTED', evidence: [evidence(id, quote, text)] },
    payerReportedPayment: {
      amountMinorUnits: amount,
      currency: 'USD',
      evidence: [evidence(id, quote, text)],
    },
    denialCodes: [],
    proposedAction: 'REVIEW_PAYMENT',
    abstentionReason: null,
  };
}

function predictedAbstention(id: string): ClaimObservation {
  return {
    disposition: 'ABSTAIN',
    claimId: `claim.${id}`,
    claimVersion: VERSION,
    status: { value: 'UNKNOWN', evidence: [] },
    payerReportedPayment: null,
    denialCodes: [],
    proposedAction: 'MANUAL_REVIEW',
    abstentionReason: 'INSUFFICIENT_EVIDENCE',
  };
}

function fixture(
  id: string,
  kind: 'payment' | 'abstention' | 'denial' = 'payment',
  text = textFor(id),
): EvaluationCase {
  // The annotation is separate from the model-output builder above.
  const sourceEvidence = {
    sourceId: `source.${id}`,
    sourceVersion: `revision.${id}`,
    start: 0,
    end: text.length,
    quote: text,
  };
  return {
    id,
    split: 'DEVELOPMENT',
    groups: {
      practice: `practice.${id}`,
      patient: `patient.${id}`,
      claim: `claim.${id}`,
      scenario: `scenario.${id}`,
    },
    tags:
      kind === 'payment'
        ? ['PAYMENT']
        : kind === 'denial'
          ? ['DENIAL', 'UNKNOWN_CODE']
          : ['MISSING_EVIDENCE'],
    request: {
      organizationId: 'org.synthetic',
      invocationId: `invocation.${id}`,
      releaseId: SYNTHETIC_RELEASE_ID,
      task: TASK_VERSION,
      dataClass: 'SYNTHETIC',
      claim: {
        id: `claim.${id}`,
        organizationId: 'org.synthetic',
        version: VERSION,
        billedMinorUnits: 90_000,
        currency: 'USD',
      },
      sources: [
        {
          id: `source.${id}`,
          organizationId: 'org.synthetic',
          claimId: `claim.${id}`,
          claimVersion: VERSION,
          version: `revision.${id}`,
          kind: 'FINAL_CALL_TRANSCRIPT',
          text,
        },
      ],
    },
    expected: {
      disposition: kind === 'abstention' ? 'ABSTAIN' : 'OBSERVED',
      claimId: `claim.${id}`,
      claimVersion: VERSION,
      status: {
        value:
          kind === 'abstention'
            ? 'UNKNOWN'
            : kind === 'denial'
              ? 'DENIED_REPORTED'
              : 'PAID_REPORTED',
        evidence: kind === 'abstention' ? [] : [sourceEvidence],
      },
      payerReportedPayment:
        kind === 'payment'
          ? { amountMinorUnits: 45_000, currency: 'USD', evidence: [sourceEvidence] }
          : null,
      denialCodes:
        kind === 'denial' ? [{ system: 'CARC', code: '16', evidence: [sourceEvidence] }] : [],
      proposedAction:
        kind === 'abstention'
          ? 'MANUAL_REVIEW'
          : kind === 'denial'
            ? 'REVIEW_DENIAL'
            : 'REVIEW_PAYMENT',
      abstentionReason: kind === 'abstention' ? 'INSUFFICIENT_EVIDENCE' : null,
    },
    rationale: 'Synthetic draft reference; domain review remains required.',
    prohibitedInterpretations: ['Payer-reported payment is not verified settlement.'],
    review: { status: 'DRAFT' },
  };
}

function success(output: ClaimObservation): Exclude<GatewayResult, { status: 'FAILED' }> {
  return {
    status: output.disposition === 'ABSTAIN' ? 'ABSTAINED' : 'VALIDATED',
    output,
    requiresHumanReview: true,
    provenance: {
      kind: 'SYNTHETIC',
      releaseId: SYNTHETIC_RELEASE_ID,
      task: TASK_VERSION,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      responseId: null,
      model: null,
      attempts: [],
      usage: UNKNOWN,
      elapsedMs: 20,
    },
  };
}

function inputs(
  cases: EvaluationCase[],
  results: unknown[],
  target: EvaluationTarget = SYNTHETIC,
): { corpus: EvaluationCorpus; bundle: EvaluationBundle } {
  const corpus: EvaluationCorpus = {
    schemaVersion: 'observation-eval-corpus.v1',
    id: 'scoring-regression',
    version: 'v1',
    task: TASK_VERSION,
    dataClass: 'SYNTHETIC',
    cases,
  };
  return {
    corpus,
    bundle: {
      schemaVersion: 'observation-eval-results.v1',
      corpusSha256: evidenceHash(corpus),
      target,
      capture: target.kind === 'SYNTHETIC_BASELINE' ? 'LOCAL_SYNTHETIC' : 'UNVERIFIED_IMPORT',
      records: cases.map((item, index) => ({
        caseId: item.id,
        requestSha256: evidenceHash(evaluationRequest(item, target)),
        result: results[index],
      })),
    },
  };
}

function score(cases: EvaluationCase[], results: unknown[], target: EvaluationTarget = SYNTHETIC) {
  const { corpus, bundle } = inputs(cases, results, target);
  return evaluate(corpus, bundle);
}

function nativeTarget(): Extract<EvaluationTarget, { kind: 'FIREWORKS_CANDIDATE' }> {
  const release = structuredClone(CANDIDATE_RELEASES[0]!);
  release.policy.responseModels = ['accounts/fireworks/models/test-model'];
  return { kind: 'FIREWORKS_CANDIDATE', release };
}

function nativeResult(
  id: string,
  target: Extract<EvaluationTarget, { kind: 'FIREWORKS_CANDIDATE' }>,
  attempts: TransportAttempt[],
): Exclude<GatewayResult, { status: 'FAILED' }> {
  return {
    ...success(predictedPayment(id)),
    provenance: {
      kind: 'FIREWORKS',
      releaseId: target.release.policy.id,
      task: TASK_VERSION,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      responseId: 'synthetic-response',
      model: 'accounts/fireworks/models/test-model',
      attempts,
      usage: { inputTokens: 9000, outputTokens: 1000, totalTokens: 10_000, cachedInputTokens: 0 },
      elapsedMs: 35,
    },
  };
}

function attempt(index = 1, usage: Usage = UNKNOWN): TransportAttempt {
  return {
    index,
    httpStatus: 200,
    outcome: 'COMPLETED',
    acceptance: 'RESPONDED',
    elapsedMs: 7,
    usage,
  };
}

describe('deterministic observation scoring', () => {
  it('reports full agreement, all tag/split denominators, and no production approval', () => {
    const { corpus, bundle } = inputs([fixture('paid')], [success(predictedPayment('paid'))]);
    const report = evaluate(corpus, bundle);
    expect(report.aggregate.fullReferenceAgreement).toEqual({
      numerator: 1,
      denominator: 1,
      rate: 1,
    });
    expect(report.aggregate.answerableCorrectCoverage.rate).toBe(1);
    expect(report.aggregate.selectiveAccuracy.rate).toBe(1);
    expect(report.aggregate.correctionProxy.fieldDifferences).toBe(0);
    expect(report.byTag.map((slice) => slice.tag)).toEqual(TAGS);
    expect(
      report.byTag.find((slice) => slice.tag === 'COB')?.metrics.fullReferenceAgreement,
    ).toEqual({ numerator: 0, denominator: 0, rate: null });
    expect(report.bySplit.map((slice) => slice.split)).toEqual([
      'DEVELOPMENT',
      'CALIBRATION',
      'HELD_OUT',
    ]);
    expect(report.productionApproval).toBe(false);
    expect(report.provenanceVerification).toBe('UNAUTHENTICATED_DECLARATION');
    expect(report.aggregate.confidenceInterval).toBeNull();
    expect(report.hashes).toEqual({
      corpus: evidenceHash(corpus),
      target: evidenceHash(bundle.target),
      bundle: evidenceHash(bundle),
    });
    expect(evaluate(structuredClone(corpus), structuredClone(bundle))).toEqual(report);
  });

  it('does not reward blanket abstention with field-null true negatives', () => {
    const report = score(
      [
        fixture('a'),
        fixture('b'),
        fixture('c', 'abstention', 'Case c: no reliable status was reported.'),
      ],
      ['a', 'b', 'c'].map((id) => success(predictedAbstention(id))),
    );
    expect(report.aggregate.fullReferenceAgreement).toEqual({
      numerator: 1,
      denominator: 3,
      rate: 1 / 3,
    });
    expect(report.aggregate.answerableCorrectCoverage).toEqual({
      numerator: 0,
      denominator: 2,
      rate: 0,
    });
    expect(report.aggregate.falseAbstentionRate).toEqual({ numerator: 2, denominator: 2, rate: 1 });
    expect(report.aggregate.selectiveAccuracy).toEqual({
      numerator: 0,
      denominator: 0,
      rate: null,
    });
    expect(report.aggregate.requiredAbstentionRecall.rate).toBe(1);
    expect(report.aggregate.requiredAbstentionPrecision).toEqual({
      numerator: 1,
      denominator: 3,
      rate: 1 / 3,
    });
    expect(report.aggregate.evidenceReferenceAgreement).toEqual({
      numerator: 0,
      denominator: 2,
      rate: 0,
    });
    expect(report.aggregate.failureCounts.FALSE_ABSTENTION).toBe(2);
  });

  it('requires the full correct abstention reason and successful runtime status', () => {
    const wrongReason = {
      ...predictedAbstention('reason'),
      abstentionReason: 'UNSUPPORTED_CONTENT' as const,
    };
    const wrongStatus = { ...success(predictedAbstention('status')), status: 'VALIDATED' };
    const report = score(
      [fixture('reason', 'abstention'), fixture('status', 'abstention')],
      [success(wrongReason), wrongStatus],
    );
    expect(report.aggregate.fullReferenceAgreement.numerator).toBe(0);
    expect(report.aggregate.requiredAbstentionRecall.rate).toBe(0);
    expect(report.cases[0]?.failureFlags).toContain('ABSTENTION_REASON_MISMATCH');
    expect(report.cases[1]?.failureFlags).toContain('PROVENANCE_MISMATCH');
    expect(report.cases[1]?.localSemanticValid).toBe(true);
  });

  it('keeps malformed declared answers and abstentions in selective denominators', () => {
    const report = score(
      [
        fixture('valid-answer'),
        fixture('bad-answer'),
        fixture('valid-abstention', 'abstention'),
        fixture('bad-abstention', 'abstention'),
      ],
      [
        success(predictedPayment('valid-answer')),
        { status: 'VALIDATED', output: { disposition: 'OBSERVED' } },
        success(predictedAbstention('valid-abstention')),
        { status: 'ABSTAINED', output: { disposition: 'ABSTAIN' } },
      ],
    );
    expect(report.aggregate.selectiveAccuracy).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
    expect(report.aggregate.requiredAbstentionPrecision).toEqual({
      numerator: 1,
      denominator: 2,
      rate: 0.5,
    });
    expect(report.aggregate.fullReferenceAgreement.rate).toBe(0.5);
  });

  it('retains failed, null, malformed, and missing model outputs in every case denominator', () => {
    const report = score(
      [fixture('failed', 'abstention'), fixture('null'), fixture('missing'), fixture('invalid')],
      [
        { status: 'FAILED', code: 'NETWORK_ERROR', attempts: [], elapsedMs: 50 },
        null,
        { status: 'VALIDATED' },
        { status: 'VALIDATED', output: { disposition: 'ABSTAIN' } },
      ],
    );
    expect(report.aggregate.fullReferenceAgreement).toEqual({
      numerator: 0,
      denominator: 4,
      rate: 0,
    });
    expect(report.aggregate.gatewaySchemaValidity).toEqual({
      numerator: 1,
      denominator: 4,
      rate: 0.25,
    });
    expect(report.aggregate.outputSchemaValidity.numerator).toBe(0);
    expect(report.aggregate.requiredAbstentionRecall.rate).toBe(0);
    expect(report.aggregate.failureCounts.RUNTIME_FAILED).toBe(1);
    expect(report.aggregate.failureCounts.OUTPUT_MISSING).toBe(3);
    expect(report.aggregate.failureCounts.OUTPUT_SCHEMA_INVALID).toBe(1);
    expect(report.aggregate.correctionProxy).toMatchObject({
      unavailableCases: 4,
      comparableCases: 0,
      casesRequiringCorrectionOrDiscard: 4,
      humanSeconds: null,
    });
    expect(report.aggregate.reportedLatency).toMatchObject({
      samples: 1,
      missingCases: 3,
      p50Ms: 50,
      p95Ms: 50,
    });
  });

  it('counts false amounts and identities even when semantic validation rejects the output', () => {
    const wrongIdentity = {
      ...predictedPayment('identity'),
      claimId: 'claim.another',
      claimVersion: '2025-01-01T00:00:00.000Z',
    };
    const wrongPayment = predictedPayment('payment', 50_000);
    const report = score(
      [fixture('identity'), fixture('payment')],
      [success(wrongIdentity), success(wrongPayment)],
    );
    expect(report.aggregate.outputSchemaValidity.rate).toBe(1);
    expect(report.aggregate.localSemanticValidity.rate).toBe(0);
    expect(report.aggregate.failureCounts.IDENTITY_MISMATCH).toBe(1);
    expect(report.aggregate.failureCounts.PAYMENT_MISMATCH).toBe(1);
    expect(report.aggregate.correctionProxy.fieldDifferences).toBe(3);
    expect(report.aggregate.fullReferenceAgreement.rate).toBe(0);
  });

  it('separates lexical validity from negation and amount reference errors', () => {
    const negatedText = 'Case negation: Payer did not report a payment of $450.';
    const amountsText = 'Case amounts: Payment $450; unrelated charge $50.';
    const negation = fixture('negation', 'abstention', negatedText);
    negation.tags = ['NEGATION', 'PAYMENT'];
    const report = score(
      [fixture('good'), negation, fixture('amounts', 'payment', amountsText)],
      [
        success(predictedPayment('good')),
        success(predictedPayment('negation', 45_000, negatedText, negatedText)),
        success(predictedPayment('amounts', 5000, amountsText, amountsText)),
      ],
    );
    expect(report.aggregate.localSemanticValidity.rate).toBe(1);
    expect(report.aggregate.fullReferenceAgreement).toEqual({
      numerator: 1,
      denominator: 3,
      rate: 1 / 3,
    });
    expect(
      report.byTag.find((slice) => slice.tag === 'NEGATION')?.metrics.fullReferenceAgreement.rate,
    ).toBe(0);
    expect(report.aggregate.failureCounts.PAYMENT_MISMATCH).toBe(2);
    expect(report.aggregate.requiredAbstentionRecall.rate).toBe(0);
    expect(report.interpretation.localValidity).toBe(
      'SCHEMA_AND_LEXICAL_RULES_NOT_DENTAL_CORRECTNESS',
    );
  });

  it('keeps exact annotated evidence agreement separate from matching field values', () => {
    const report = score([fixture('span')], [success(predictedPayment('span', 45_000, '$450'))]);
    expect(report.cases[0]).toMatchObject({
      outputSchemaValid: true,
      localSemanticValid: true,
      goldValuesMatch: true,
      evidenceReferenceMatch: false,
      correct: false,
    });
    expect(report.aggregate.goldValueAgreement.rate).toBe(1);
    expect(report.aggregate.evidenceReferenceAgreement.rate).toBe(0);
    expect(report.aggregate.correctionProxy).toMatchObject({
      fieldDifferences: 0,
      evidenceAdditionsOrRemovals: 4,
    });
    expect(report.interpretation.goldAgreement).toBe('REFERENCE_AGREEMENT_NOT_ENTAILMENT');
  });

  it('rejects forged anchors and counts action/code nomenclature differences without inventing meaning', () => {
    const deniedText = 'Case denied: denied with CARC 16.';
    const denied: ClaimObservation = {
      disposition: 'OBSERVED',
      claimId: 'claim.denied',
      claimVersion: VERSION,
      status: { value: 'DENIED_REPORTED', evidence: [evidence('denied', deniedText, deniedText)] },
      payerReportedPayment: null,
      denialCodes: [
        { system: 'UNKNOWN', code: '16', evidence: [evidence('denied', deniedText, deniedText)] },
      ],
      proposedAction: 'MANUAL_REVIEW',
      abstentionReason: null,
    };
    const forged = predictedPayment('forged');
    forged.status.evidence[0]!.start = 1;
    const report = score(
      [fixture('denied', 'denial', deniedText), fixture('forged')],
      [success(denied), success(forged)],
    );
    expect(report.cases[0]?.localSemanticValid).toBe(true);
    expect(report.aggregate.failureCounts.CODE_MISMATCH).toBe(1);
    expect(report.aggregate.failureCounts.ACTION_MISMATCH).toBe(1);
    expect(report.cases[1]?.failureFlags).toContain('OUTPUT_SEMANTIC_INVALID');
    expect(report.aggregate.fullReferenceAgreement.rate).toBe(0);
  });

  it('requires exact release and allowed response-model provenance without authenticating an import', () => {
    const target = nativeTarget();
    const wrongModel = nativeResult('model', target, [attempt()]);
    const wrongRelease = nativeResult('release', target, [attempt()]);
    const wrongKind = nativeResult('kind', target, [attempt()]);
    const report = score(
      [fixture('model'), fixture('release'), fixture('kind')],
      [
        {
          ...wrongModel,
          provenance: { ...wrongModel.provenance, model: 'accounts/fireworks/models/other-model' },
        },
        {
          ...wrongRelease,
          provenance: { ...wrongRelease.provenance, releaseId: 'different.release' },
        },
        { ...wrongKind, provenance: { ...wrongKind.provenance, kind: 'SYNTHETIC' } },
      ],
      target,
    );
    expect(report.aggregate.localSemanticValidity.rate).toBe(1);
    expect(report.aggregate.failureCounts.PROVENANCE_MISMATCH).toBe(3);
    expect(report.aggregate.fullReferenceAgreement.rate).toBe(0);
    expect(report.provenanceVerification).toBe('UNAUTHENTICATED_DECLARATION');
    expect(report.capture).toBe('UNVERIFIED_IMPORT');
    expect(report.productionApproval).toBe(false);
  });

  it('sums attempt receipts once, preserves unknowns, and never substitutes aggregate usage or costs', () => {
    const target = nativeTarget();
    const known = { inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: 3 };
    const firstAttempt = { ...attempt(), httpStatus: 503, outcome: 'HTTP_ERROR' as const };
    const result = nativeResult('usage', target, [firstAttempt, attempt(2, known)]);
    const report = score([fixture('usage')], [result], target);
    expect(report.aggregate.fullReferenceAgreement.rate).toBe(1);
    expect(report.aggregate.usage).toMatchObject({
      attempts: 2,
      knownTokenSubtotals: known,
      unknownTokenAttempts: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 1,
        cachedInputTokens: 1,
      },
      casesWithUnknownTotalTokens: 1,
      estimatedCost: null,
    });
    expect(report.aggregate.reportedLatency).toMatchObject({
      p50Ms: 35,
      p95Ms: 35,
      verification: 'UNVERIFIED_REPORTED',
    });
  });

  it('marks duplicate attempt ordinals and contradictory usage as unknown instead of zero spend', () => {
    const target = nativeTarget();
    const report = score(
      [fixture('duplicate'), fixture('contradictory')],
      [
        nativeResult('duplicate', target, [attempt(1), attempt(1)]),
        nativeResult('contradictory', target, [
          attempt(1, {
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 0,
            cachedInputTokens: 101,
          }),
        ]),
      ],
      target,
    );
    expect(report.aggregate.usage).toMatchObject({
      casesWithInvalidAttemptReceipts: 1,
      casesWithInconsistentUsage: 1,
      casesWithUnknownTotalTokens: 2,
    });
    expect(report.aggregate.usage.unknownTokenAttempts.totalTokens).toBe(1);
    expect(report.aggregate.usage.knownTokenSubtotals.totalTokens).toBe(0);
    expect(report.aggregate.usage.estimatedCost).toBeNull();
  });

  it('reports token subtotal overflow as unavailable rather than an inexact number', () => {
    const target = nativeTarget();
    const usage = {
      inputTokens: Number.MAX_SAFE_INTEGER,
      outputTokens: 0,
      totalTokens: Number.MAX_SAFE_INTEGER,
      cachedInputTokens: 0,
    };
    const report = score(
      [fixture('large')],
      [nativeResult('large', target, [attempt(1, usage), attempt(2, usage)])],
      target,
    );
    expect(report.aggregate.usage.subtotalOverflow).toBe(true);
    expect(report.aggregate.usage.knownTokenSubtotals.totalTokens).toBeNull();
  });

  it('includes empty split rates and uses deterministic nearest-rank reported latency', () => {
    const cases = [fixture('dev'), fixture('calibration'), fixture('held')];
    cases[1]!.split = 'CALIBRATION';
    cases[2]!.split = 'HELD_OUT';
    const report = score(
      cases,
      cases.map((item, index) => {
        const result = success(predictedPayment(item.id));
        return { ...result, provenance: { ...result.provenance, elapsedMs: [10, 20, 100][index] } };
      }),
    );
    expect(report.bySplit.every((slice) => slice.metrics.cases === 1)).toBe(true);
    expect(report.aggregate.reportedLatency).toMatchObject({
      samples: 3,
      p50Ms: 20,
      p95Ms: 100,
      method: 'NEAREST_RANK',
    });
  });

  it('redacts source/output text, rationale, group and reviewer identities from the deterministic report', () => {
    const item = fixture('redaction');
    item.rationale = 'SECRET_REFERENCE_RATIONALE';
    item.prohibitedInterpretations = ['SECRET_PROHIBITED_INTERPRETATION'];
    item.review = {
      status: 'ADJUDICATED',
      adjudicatorId: 'SECRET_ADJUDICATOR',
      adjudicationId: 'SECRET_ADJUDICATION',
      adjudicatedAt: '2026-01-02T00:00:00.000Z',
      caseSha256: caseContentHash(item),
      annotations: ['one', 'two'].map((suffix) => ({
        reviewerId: `SECRET_REVIEWER_${suffix}`,
        qualificationEvidenceId: `SECRET_QUALIFICATION_${suffix}`,
        recordId: `SECRET_RECORD_${suffix}`,
        inputSha256: caseInputHash(item),
        reviewedAt: '2026-01-01T00:00:00.000Z',
        expected: predictedPayment('redaction'),
      })),
    };
    const report = score([item], [success(predictedPayment('redaction'))]);
    const serialized = JSON.stringify(report);
    expect(report.corpus).toMatchObject({ adjudicatedCases: 1, draftCases: 0 });
    for (const sensitive of [
      'SECRET_',
      textFor('redaction'),
      'claim.redaction',
      'patient.redaction',
      'source.redaction',
      '$450',
    ])
      expect(serialized).not.toContain(sensitive);
    expect(
      report.cases.every((entry) =>
        entry.failureFlags.every((flag) => FAILURE_FLAGS.includes(flag)),
      ),
    ).toBe(true);
    expect(report.productionApproval).toBe(false);
  });

  it('throws only integrity errors for missing case records or mutated immutable request bindings', () => {
    const { corpus, bundle } = inputs(
      [fixture('integrity')],
      [success(predictedPayment('integrity'))],
    );
    expect(() => evaluate(corpus, { ...bundle, records: [] })).toThrow('CASE_SET_MISMATCH');
    const record = bundle.records[0]!;
    expect(() =>
      evaluate(corpus, { ...bundle, records: [{ ...record, requestSha256: '0'.repeat(64) }] }),
    ).toThrow('BINDING_MISMATCH');
    expect(() => evaluate(corpus, { ...bundle, corpusSha256: 'f'.repeat(64) })).toThrow(
      'BINDING_MISMATCH',
    );
  });
});

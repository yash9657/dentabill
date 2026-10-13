import {
  CANDIDATE_RELEASES,
  SYNTHETIC_RELEASE_ID,
  TASK_VERSION,
  type ClaimObservation,
  type GatewayRequest,
} from '@dentabill/model-gateway';
import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  caseContentHash,
  caseInputHash,
  EvaluationError,
  evidenceHash,
  evaluationRequest,
  parseCorpus,
  parseEvaluation,
  type EvaluationBundle,
  type EvaluationCase,
  type EvaluationCorpus,
  type EvaluationTarget,
} from './contracts.js';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_INPUT_NEVER_IN_ERROR';

function makeCase(id: string, split: EvaluationCase['split'] = 'HELD_OUT'): EvaluationCase {
  const request: GatewayRequest = {
    organizationId: `org.${id}`,
    invocationId: `invocation.${id}`,
    releaseId: SYNTHETIC_RELEASE_ID,
    task: TASK_VERSION,
    dataClass: 'SYNTHETIC',
    claim: {
      id: `claim.${id}`,
      organizationId: `org.${id}`,
      version: '2026-01-01T00:00:00.000Z',
      billedMinorUnits: 10000,
      currency: 'USD',
    },
    sources: [
      {
        id: `transcript.${id}`,
        organizationId: `org.${id}`,
        claimId: `claim.${id}`,
        claimVersion: '2026-01-01T00:00:00.000Z',
        version: `source-version.${id}`,
        kind: 'FINAL_CALL_TRANSCRIPT',
        text: `Payer: No claim status was available. Synthetic example ${id}.`,
      },
    ],
  };
  const expected: ClaimObservation = {
    disposition: 'ABSTAIN',
    claimId: request.claim.id,
    claimVersion: request.claim.version,
    status: { value: 'UNKNOWN', evidence: [] },
    payerReportedPayment: null,
    denialCodes: [],
    proposedAction: 'MANUAL_REVIEW',
    abstentionReason: 'INSUFFICIENT_EVIDENCE',
  };
  return {
    id,
    split,
    groups: {
      practice: `practice.${id}`,
      patient: `patient.${id}`,
      claim: `claim.${id}`,
      scenario: `scenario.${id}`,
    },
    tags: ['MISSING_EVIDENCE'],
    request,
    expected,
    rationale: 'No payer status was stated; the independently authored label requires abstention.',
    prohibitedInterpretations: ['Do not infer a denial from unavailable information.'],
    review: { status: 'DRAFT' },
  };
}

function corpus(cases = [makeCase('case.a'), makeCase('case.b')]): EvaluationCorpus {
  return {
    schemaVersion: 'observation-eval-corpus.v1',
    id: 'independent.contract-fixture',
    version: 'v1',
    task: TASK_VERSION,
    dataClass: 'SYNTHETIC',
    cases,
  };
}

function bundle(
  input: EvaluationCorpus,
  target: EvaluationTarget = { kind: 'SYNTHETIC_BASELINE', releaseId: SYNTHETIC_RELEASE_ID },
): EvaluationBundle {
  return {
    schemaVersion: 'observation-eval-results.v1',
    corpusSha256: evidenceHash(input),
    target,
    capture: target.kind === 'SYNTHETIC_BASELINE' ? 'LOCAL_SYNTHETIC' : 'UNVERIFIED_IMPORT',
    records: input.cases.map((item) => ({
      caseId: item.id,
      requestSha256: evidenceHash(evaluationRequest(item, target)),
      // Deliberately independent of expected labels: parsing must preserve failures for scoring.
      result: { status: 'FAILED', code: 'INVALID_RESPONSE', attempts: [], elapsedMs: 0 },
    })),
  };
}

function adjudicated(): EvaluationCase {
  const item = makeCase('reviewed');
  const secondExpected = structuredClone(item.expected);
  secondExpected.abstentionReason = 'UNSUPPORTED_CONTENT';
  item.review = {
    status: 'ADJUDICATED',
    annotations: [
      {
        reviewerId: 'declared.reviewer.a',
        qualificationEvidenceId: 'declared.qualification.a',
        recordId: 'annotation.a',
        inputSha256: caseInputHash(item),
        reviewedAt: '2026-10-01T00:00:00.000Z',
        expected: structuredClone(item.expected),
      },
      {
        reviewerId: 'declared.reviewer.b',
        qualificationEvidenceId: 'declared.qualification.b',
        recordId: 'annotation.b',
        inputSha256: caseInputHash(item),
        reviewedAt: '2026-10-02T00:00:00.000Z',
        expected: secondExpected,
      },
    ],
    adjudicatorId: 'declared.adjudicator',
    adjudicationId: 'adjudication.a',
    adjudicatedAt: '2026-10-03T00:00:00.000Z',
    caseSha256: caseContentHash(item),
  };
  return item;
}

function expectCode(operation: () => unknown, code: EvaluationError['code']): void {
  let caught: unknown;
  try {
    operation();
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(EvaluationError);
  if (!(caught instanceof EvaluationError)) throw new Error('EXPECTED_SAFE_EVALUATION_ERROR');
  expect(caught.code).toBe(code);
  expect(caught.message).toBe(code);
  expect(JSON.stringify(caught)).not.toContain(PRIVATE_MARKER);
  expect(caught.stack).not.toContain(PRIVATE_MARKER);
}

describe('canonical evidence hashing', () => {
  it('ignores object insertion order, preserves arrays, and sorts keys without locale dependence', () => {
    const left = { z: [1, { b: true, a: null }], a: 'é' };
    const right = { a: 'é', z: [1, { a: null, b: true }] };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(evidenceHash(left)).toBe(evidenceHash(right));
    expect(evidenceHash([1, 2])).not.toBe(evidenceHash([2, 1]));
    expect(canonicalJson({ a: 1, Z: 2, A: 3, é: 4 })).toBe('{"A":3,"Z":2,"a":1,"é":4}');
  });

  it.each([
    ['undefined', undefined],
    ['nonfinite', Number.NaN],
    ['infinite', Infinity],
    ['bigint', 1n],
    ['function', () => PRIVATE_MARKER],
    ['date', NOW],
    ['map', new Map([['private', PRIVATE_MARKER]])],
    ['sparse array', Array(1)],
    ['undefined property', { private: PRIVATE_MARKER, value: undefined }],
  ])('rejects non-JSON %s using a safe code', (_label, value) => {
    expectCode(() => canonicalJson(value), 'INVALID_INPUT');
  });

  it('rejects cycles and enforces the nesting bound without leaking values', () => {
    const cyclic: Record<string, unknown> = { private: PRIVATE_MARKER };
    cyclic.self = cyclic;
    expectCode(() => canonicalJson(cyclic), 'INVALID_INPUT');
    let nested: unknown = PRIVATE_MARKER;
    for (let i = 0; i < 40; i++) nested = [nested];
    expect(() => canonicalJson(nested)).not.toThrow();
    expectCode(() => canonicalJson([nested]), 'INVALID_INPUT');
  });
});

describe('full evaluation inventory and request binding', () => {
  it('preserves draft labels and failure outputs without silently creating model evidence', () => {
    const input = corpus();
    const replay = bundle(input);
    const parsed = parseEvaluation(input, replay);
    expect(parsed).toEqual({ corpus: input, bundle: replay });
    expect(parsed.corpus.cases.every((item) => item.review.status === 'DRAFT')).toBe(true);
    expect(
      parsed.bundle.records.every(
        (record) => (record.result as { status: string }).status === 'FAILED',
      ),
    ).toBe(true);
    expect(parsed.bundle).not.toHaveProperty('productionApproval');
  });

  it.each(['missing', 'extra', 'duplicate', 'foreign'] as const)(
    'rejects %s result cases rather than changing denominators',
    (mutation) => {
      const input = corpus();
      const replay = bundle(input);
      const first = replay.records[0]!;
      if (mutation === 'missing') replay.records.pop();
      if (mutation === 'extra') replay.records.push({ ...first, caseId: 'case.extra' });
      if (mutation === 'duplicate') replay.records[1] = structuredClone(first);
      if (mutation === 'foreign') replay.records[1] = { ...first, caseId: 'case.foreign' };
      expectCode(() => parseEvaluation(input, replay), 'CASE_SET_MISMATCH');
    },
  );

  it('allows output file ordering to differ while preserving every exact binding', () => {
    const input = corpus();
    const replay = bundle(input);
    replay.records.reverse();
    expect(parseEvaluation(input, replay).bundle.records).toEqual(replay.records);
  });

  it('rejects an omitted result property and an explicitly undefined result', () => {
    const input = corpus();
    const replay = bundle(input);
    const { result: _result, ...missing } = replay.records[0]!;
    expectCode(
      () => parseEvaluation(input, { ...replay, records: [missing, replay.records[1]] }),
      'CASE_SET_MISMATCH',
    );
    replay.records[0]!.result = undefined;
    expectCode(() => parseEvaluation(input, replay), 'INVALID_INPUT');
  });

  it('keeps malformed but bounded result content available for failure scoring', () => {
    const input = corpus();
    const replay = bundle(input);
    replay.records[0]!.result = null;
    replay.records[1]!.result = { unexpected: PRIVATE_MARKER };
    expect(parseEvaluation(input, replay).bundle.records).toEqual(replay.records);
  });

  it('rejects an oversized result tree safely before scoring', () => {
    const input = corpus();
    const replay = bundle(input);
    let nested: unknown = PRIVATE_MARKER;
    for (let i = 0; i < 41; i++) nested = { nested };
    replay.records[0]!.result = nested;
    expectCode(() => parseEvaluation(input, replay), 'INVALID_INPUT');
  });

  it.each(['labels', 'source', 'inventory', 'order'] as const)(
    'binds the entire corpus including %s',
    (mutation) => {
      const input = corpus();
      const replay = bundle(input);
      if (mutation === 'labels') input.cases[0]!.expected.abstentionReason = 'UNSUPPORTED_CONTENT';
      if (mutation === 'source') input.cases[0]!.request.sources[0]!.text += PRIVATE_MARKER;
      if (mutation === 'inventory') input.cases.pop();
      if (mutation === 'order') input.cases.reverse();
      expectCode(() => parseEvaluation(input, replay), 'BINDING_MISMATCH');
    },
  );

  it('rejects substituted requests even when the corpus hash is recomputed', () => {
    const input = corpus();
    const replay = bundle(input);
    input.cases[0]!.request.claim.billedMinorUnits += 1;
    replay.corpusSha256 = evidenceHash(input);
    expectCode(() => parseEvaluation(input, replay), 'BINDING_MISMATCH');
  });

  it('rejects records swapped between cases even when their IDs are restored', () => {
    const input = corpus();
    const replay = bundle(input);
    replay.records[0]!.requestSha256 = replay.records[1]!.requestSha256;
    expectCode(() => parseEvaluation(input, replay), 'BINDING_MISMATCH');
  });

  it('derives each request target without mutating the corpus and rejects a rebound release', () => {
    const input = corpus();
    const release = structuredClone(CANDIDATE_RELEASES[0]!);
    const target: EvaluationTarget = { kind: 'FIREWORKS_CANDIDATE', release };
    const original = structuredClone(input);
    const replay = bundle(input, target);
    expect(parseEvaluation(input, replay).bundle.capture).toBe('UNVERIFIED_IMPORT');
    expect(evaluationRequest(input.cases[0]!, target).releaseId).toBe(release.policy.id);
    expect(input).toEqual(original);
    release.policy.id = 'different-release';
    expectCode(() => parseEvaluation(input, replay), 'BINDING_MISMATCH');
  });

  it('rejects local synthetic capture claiming a Fireworks target', () => {
    const input = corpus();
    const replay = bundle(input, {
      kind: 'FIREWORKS_CANDIDATE',
      release: structuredClone(CANDIDATE_RELEASES[0]!),
    });
    replay.capture = 'LOCAL_SYNTHETIC';
    expectCode(() => parseEvaluation(input, replay), 'INVALID_BUNDLE');
  });
});

describe('corpus partitions and source identity', () => {
  it.each(['practice', 'patient', 'claim', 'scenario'] as const)(
    'rejects cross-split leakage through %s grouping',
    (axis) => {
      const first = makeCase('first', 'DEVELOPMENT');
      const second = makeCase('second', 'HELD_OUT');
      second.groups[axis] = first.groups[axis];
      expectCode(() => parseCorpus(corpus([first, second])), 'LEAKAGE_DETECTED');
    },
  );

  it('rejects shared claim identity even when declared grouping IDs hide it', () => {
    const first = makeCase('first', 'CALIBRATION');
    const second = makeCase('second', 'HELD_OUT');
    second.request.organizationId = first.request.organizationId;
    second.request.claim = structuredClone(first.request.claim);
    second.request.sources[0]!.organizationId = first.request.organizationId;
    second.request.sources[0]!.claimId = first.request.claim.id;
    second.expected.claimId = first.expected.claimId;
    expectCode(() => parseCorpus(corpus([first, second])), 'LEAKAGE_DETECTED');
  });

  it('rejects identical source text across different source IDs, tenants and splits', () => {
    const first = makeCase('first', 'DEVELOPMENT');
    const second = makeCase('second', 'CALIBRATION');
    second.request.sources[0]!.text = first.request.sources[0]!.text;
    expectCode(() => parseCorpus(corpus([first, second])), 'LEAKAGE_DETECTED');
  });

  it('permits related examples within one split and disjoint examples across splits', () => {
    const first = makeCase('first', 'DEVELOPMENT');
    const related = makeCase('related', 'DEVELOPMENT');
    related.groups = structuredClone(first.groups);
    related.request.sources[0]!.text = first.request.sources[0]!.text;
    const heldOut = makeCase('held-out', 'HELD_OUT');
    expect(parseCorpus(corpus([first, related, heldOut])).cases).toHaveLength(3);
  });

  it.each(['duplicate-case', 'duplicate-tag', 'cross-tenant-source', 'wrong-claim-label'] as const)(
    'rejects %s corruption',
    (kind) => {
      const input = corpus();
      if (kind === 'duplicate-case') input.cases[1]!.id = input.cases[0]!.id;
      if (kind === 'duplicate-tag') input.cases[0]!.tags.push('MISSING_EVIDENCE');
      if (kind === 'cross-tenant-source')
        input.cases[0]!.request.sources[0]!.organizationId = 'other-org';
      if (kind === 'wrong-claim-label') input.cases[0]!.expected.claimId = 'other-claim';
      expectCode(() => parseCorpus(input), 'INVALID_CORPUS');
    },
  );
});

describe('independent annotation records and chronology', () => {
  it('preserves both declared annotations, disagreement and final adjudicated label', () => {
    const item = adjudicated();
    const parsed = parseCorpus(corpus([item]), NOW);
    expect(parsed.cases[0]).toEqual(item);
    if (item.review.status !== 'ADJUDICATED') throw new Error('FIXTURE_NOT_ADJUDICATED');
    expect(item.review.annotations[0]!.expected).not.toEqual(item.review.annotations[1]!.expected);
    // Schema validity proves neither reviewer identity nor qualification; release review must not trust these declarations.
    expect(parsed).not.toHaveProperty('domainQualified');
  });

  it.each([
    'reviewer',
    'record',
    'input-hash',
    'case-hash',
    'annotation-claim',
    'adjudicated-label',
  ] as const)('rejects altered %s bindings', (kind) => {
    const item = adjudicated();
    if (item.review.status !== 'ADJUDICATED') throw new Error('FIXTURE_NOT_ADJUDICATED');
    const [first, second] = item.review.annotations;
    if (!first || !second) throw new Error('FIXTURE_ANNOTATION_MISSING');
    if (kind === 'reviewer') second.reviewerId = first.reviewerId;
    if (kind === 'record') second.recordId = first.recordId;
    if (kind === 'input-hash') second.inputSha256 = '0'.repeat(64);
    if (kind === 'case-hash') item.review.caseSha256 = '0'.repeat(64);
    if (kind === 'annotation-claim') second.expected.claimId = 'unrelated-claim';
    if (kind === 'adjudicated-label') item.expected.abstentionReason = 'CONTRADICTORY_EVIDENCE';
    expectCode(() => parseCorpus(corpus([item]), NOW), 'INVALID_CORPUS');
  });

  it('invalidates a captured bundle if an independent annotation is replaced after capture', () => {
    const item = adjudicated();
    const input = corpus([item]);
    const replay = bundle(input);
    if (item.review.status !== 'ADJUDICATED') throw new Error('FIXTURE_NOT_ADJUDICATED');
    item.review.annotations[1]!.expected.abstentionReason = 'CONTRADICTORY_EVIDENCE';
    expectCode(() => parseEvaluation(input, replay), 'BINDING_MISMATCH');
  });

  it.each([
    'review-after-adjudication',
    'future-adjudication',
    'future-reviews',
    'invalid-clock',
  ] as const)('rejects %s chronology', (kind) => {
    const item = adjudicated();
    if (item.review.status !== 'ADJUDICATED') throw new Error('FIXTURE_NOT_ADJUDICATED');
    if (kind === 'review-after-adjudication')
      item.review.annotations[1]!.reviewedAt = '2026-10-04T00:00:00.000Z';
    if (kind === 'future-adjudication') item.review.adjudicatedAt = '2026-10-14T00:00:00.000Z';
    if (kind === 'future-reviews') {
      item.review.annotations.forEach((annotation) => {
        annotation.reviewedAt = '2026-10-14T00:00:00.000Z';
      });
      item.review.adjudicatedAt = '2026-10-15T00:00:00.000Z';
    }
    expectCode(
      () => parseCorpus(corpus([item]), kind === 'invalid-clock' ? new Date(Number.NaN) : NOW),
      'INVALID_CORPUS',
    );
  });

  it('allows equal review/adjudication instants at the supplied current time', () => {
    const item = adjudicated();
    if (item.review.status !== 'ADJUDICATED') throw new Error('FIXTURE_NOT_ADJUDICATED');
    item.review.adjudicatedAt = NOW.toISOString();
    item.review.annotations.forEach((annotation) => {
      annotation.reviewedAt = NOW.toISOString();
    });
    expect(parseCorpus(corpus([item]), NOW).cases).toHaveLength(1);
  });
});

describe('strict input boundaries and safe errors', () => {
  it.each([
    'corpus',
    'case',
    'groups',
    'request',
    'claim',
    'source',
    'expected',
    'review',
    'annotation',
  ] as const)('rejects undeclared %s fields without exposing their value', (scope) => {
    const item = scope === 'annotation' ? adjudicated() : makeCase('strict');
    const input = corpus([item]);
    const objects: Record<string, object> = {
      corpus: input,
      case: item,
      groups: item.groups,
      request: item.request,
      claim: item.request.claim,
      source: item.request.sources[0]!,
      expected: item.expected,
      review: item.review,
    };
    if (item.review.status === 'ADJUDICATED') objects.annotation = item.review.annotations[0]!;
    Object.assign(objects[scope]!, { secret: PRIVATE_MARKER });
    expectCode(() => parseCorpus(input), 'INVALID_CORPUS');
  });

  it.each(['bundle', 'record', 'target'] as const)(
    'rejects undeclared %s fields without exposing their value',
    (scope) => {
      const input = corpus();
      const replay = bundle(input);
      const selected =
        scope === 'bundle' ? replay : scope === 'record' ? replay.records[0]! : replay.target;
      Object.assign(selected, { secret: PRIVATE_MARKER });
      expectCode(() => parseEvaluation(input, replay), 'INVALID_BUNDLE');
    },
  );

  it('rejects protected corpus and request classifications', () => {
    const input = corpus();
    expectCode(() => parseCorpus({ ...input, dataClass: 'PROTECTED' }), 'INVALID_CORPUS');
    input.cases[0]!.request.dataClass = 'PROTECTED';
    expectCode(() => parseCorpus(input), 'INVALID_CORPUS');
  });

  it('bounds corpus inventory and source strings', () => {
    expectCode(() => parseCorpus(corpus([])), 'INVALID_CORPUS');
    expectCode(
      () => parseCorpus(corpus(Array.from({ length: 10_001 }, () => makeCase('too-many')))),
      'INVALID_CORPUS',
    );
    const input = corpus();
    input.cases[0]!.request.sources[0]!.text = PRIVATE_MARKER.repeat(3000);
    expectCode(() => parseCorpus(input), 'INVALID_CORPUS');
  });
});

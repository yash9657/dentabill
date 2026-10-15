import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

import { CANDIDATE_RELEASES, buildObservationRequestBody } from '@dentabill/model-gateway';
import { describe, expect, it } from 'vitest';

import {
  CaptureAuthorizationSchema,
  createCapturePlan,
  validateCapturePlan,
  wireHash,
  type CaptureEvidence,
  type CapturePlan,
} from './capture-plan.js';
import { evidenceHash, evaluationRequest, parseCorpus } from './contracts.js';
import { createSeedCorpus } from './seed.js';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const DIRECTORY = '/synthetic-tests/private-capture';
const ARTIFACT = 'a'.repeat(64);
const CANDIDATE = CANDIDATE_RELEASES[0]!;

function corpus(count = 2) {
  const result = createSeedCorpus();
  result.cases = result.cases.slice(0, count);
  return result;
}

/** These are invented test-only account, publisher, price, and context attestations. */
function fakeEvidence(overrides: Partial<CaptureEvidence> = {}): CaptureEvidence {
  return {
    checkedAt: NOW.toISOString(),
    accountSha256: evidenceHash('TEST_ONLY_FAKE_ACCOUNT'),
    accountEvidenceSha256: evidenceHash('TEST_ONLY_FAKE_ACCOUNT_RESPONSE'),
    priceSource: 'https://docs.fireworks.ai/serverless/pricing',
    contextSource: 'https://docs.fireworks.ai/api-reference/get-model',
    model: CANDIDATE.policy.requestModel,
    serviceTier: 'STANDARD_DEFAULT',
    contextTokens: 128_000,
    inputUsdMicrosPerMillion: 600_000,
    outputUsdMicrosPerMillion: 2_400_000,
    publisherRevision: 'TEST_ONLY_FAKE_PUBLISHER_REVISION',
    publisherLicenseSha256: evidenceHash('TEST_ONLY_FAKE_LICENSE'),
    servingRevisionVerified: false,
    regionalRouteVerified: false,
    ...overrides,
  };
}

function options(overrides: Partial<Parameters<typeof createCapturePlan>[0]> = {}) {
  return {
    corpus: corpus(),
    candidateId: CANDIDATE.policy.id,
    evidence: fakeEvidence(),
    directory: DIRECTORY,
    implementationSha256: ARTIFACT,
    allowanceUsdMicros: 1_000_000,
    now: new Date(NOW),
    runId: 'synthetic-capture-plan-test',
    ...overrides,
  };
}

describe('synthetic contract-capture planning', () => {
  it('pins the exact draft corpus, candidate, host, implementation, path and wire body without approval', () => {
    const source = corpus();
    const plan = createCapturePlan(options({ corpus: source }));
    expect(plan).toMatchObject({
      schemaVersion: 'observation-contract-capture.v1',
      mode: 'UNVERIFIED_DISCOVERY',
      directory: DIRECTORY,
      hostSha256: evidenceHash(hostname()),
      implementationSha256: ARTIFACT,
      corpusSha256: evidenceHash(source),
      createdAt: NOW.toISOString(),
      expiresAt: '2026-10-14T12:00:00.000Z',
      productionApproval: false,
      target: {
        policy: {
          id: CANDIDATE.policy.id,
          state: 'CANDIDATE',
          responseModels: [],
          limits: { maxAttempts: 1 },
        },
        approval: null,
      },
    });
    expect(plan.cases).toHaveLength(2);
    for (const [index, item] of source.cases.entries()) {
      const request = evaluationRequest(item, {
        kind: 'FIREWORKS_CANDIDATE',
        release: plan.target,
      });
      const body = buildObservationRequestBody(request, plan.target);
      expect(plan.cases[index]).toEqual({
        caseId: item.id,
        storageId: evidenceHash(item.id),
        requestSha256: evidenceHash(request),
        wireRequestSha256: createHash('sha256').update(body).digest('hex'),
        requestBytes: Buffer.byteLength(body, 'utf8'),
      });
      expect(wireHash(body)).toBe(plan.cases[index]?.wireRequestSha256);
    }
    expect(source.cases.every((item) => item.review.status === 'DRAFT')).toBe(true);
    expect(plan.target).not.toBe(CANDIDATE);
    expect(CANDIDATE.policy.limits.maxAttempts).toBe(2);
    expect(validateCapturePlan(plan, source, ARTIFACT, DIRECTORY)).toEqual({
      plan,
      corpus: source,
    });
  });

  it('reserves full context on both input and output with no cache discount or refund', () => {
    const plan = createCapturePlan(options());
    expect(plan.budget).toEqual({
      currency: 'USD',
      maximumAllowanceUsdMicros: 1_000_000,
      reservedPerCaseUsdMicros: 384_000,
      reservedTotalUsdMicros: 768_000,
      inputTokenAllowance: 128_000,
      completionTokenAllowance: 128_000,
      maxAttemptsPerCase: 1,
      refunds: false,
      providerBillingCapVerified: false,
    });
    expect(plan.target.policy.limits.outputTokens).toBeLessThan(
      plan.budget.completionTokenAllowance,
    );
    const cached = { ...fakeEvidence(), cachedInputUsdMicrosPerMillion: 0 };
    expect(() => createCapturePlan(options({ evidence: cached }))).toThrow('CAPTURE_INVALID_INPUT');
  });

  it.each([
    { contextTokens: 1, input: 1, output: 1, perCase: 1 },
    { contextTokens: 500_000, input: 1, output: 1, perCase: 1 },
    { contextTokens: 500_001, input: 1, output: 1, perCase: 2 },
    { contextTokens: 333_333, input: 1_000_001, output: 2_000_001, perCase: 1_000_000 },
  ])(
    'rounds the integer micro-USD allowance upward per case: %j',
    ({ contextTokens, input, output, perCase }) => {
      const plan = createCapturePlan(
        options({
          evidence: fakeEvidence({
            contextTokens,
            inputUsdMicrosPerMillion: input,
            outputUsdMicrosPerMillion: output,
          }),
          allowanceUsdMicros: perCase * 2,
        }),
      );
      expect(plan.budget.reservedPerCaseUsdMicros).toBe(perCase);
      expect(plan.budget.reservedTotalUsdMicros).toBe(perCase * 2);
      expect(plan.budget.maximumAllowanceUsdMicros).toBe(perCase * 2);
    },
  );

  it('admits equality but rejects even a one-micro-USD total allowance overrun', () => {
    expect(
      createCapturePlan(options({ allowanceUsdMicros: 768_000 })).budget.reservedTotalUsdMicros,
    ).toBe(768_000);
    expect(() => createCapturePlan(options({ allowanceUsdMicros: 767_999 }))).toThrow(
      'CAPTURE_BUDGET_EXCEEDED',
    );
    expect(() => createCapturePlan(options({ allowanceUsdMicros: 100_000_001 }))).toThrow(
      'CAPTURE_INVALID_INPUT',
    );
  });

  it('rejects unsafe arithmetic, fractional prices, and invented free usage', () => {
    expect(() =>
      createCapturePlan(
        options({
          evidence: fakeEvidence({
            contextTokens: 10_000_000,
            inputUsdMicrosPerMillion: Number.MAX_SAFE_INTEGER,
            outputUsdMicrosPerMillion: Number.MAX_SAFE_INTEGER,
          }),
        }),
      ),
    ).toThrow('CAPTURE_INVALID_INPUT');
    for (const value of [0, -1, 0.1, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      expect(() =>
        createCapturePlan(options({ evidence: fakeEvidence({ inputUsdMicrosPerMillion: value }) })),
      ).toThrow('CAPTURE_INVALID_INPUT');
    }
  });

  it('rejects protected corpus or protected case inputs before creating a capture plan', () => {
    expect(() =>
      createCapturePlan(options({ corpus: { ...corpus(), dataClass: 'PROTECTED' } })),
    ).toThrow('INVALID_CORPUS');
    const protectedCase = corpus();
    protectedCase.cases[0]!.request.dataClass = 'PROTECTED';
    expect(() => createCapturePlan(options({ corpus: protectedCase }))).toThrow('INVALID_CORPUS');
    const crossTenant = corpus();
    crossTenant.cases[0]!.request.sources[0]!.organizationId = 'synthetic_other_tenant';
    expect(() => createCapturePlan(options({ corpus: crossTenant }))).toThrow('INVALID_CORPUS');
  });

  it('rejects empty, duplicate, and more-than-25 case inventories', () => {
    expect(() => createCapturePlan(options({ corpus: corpus(0) }))).toThrow('INVALID_CORPUS');
    const duplicate = corpus(1);
    duplicate.cases.push(structuredClone(duplicate.cases[0]!));
    expect(() => createCapturePlan(options({ corpus: duplicate }))).toThrow('INVALID_CORPUS');
    const tooMany = createSeedCorpus();
    tooMany.cases.push({ ...structuredClone(tooMany.cases[0]!), id: 'synthetic_case_26' });
    expect(parseCorpus(tooMany).cases).toHaveLength(26);
    expect(() =>
      createCapturePlan(options({ corpus: tooMany, allowanceUsdMicros: 100_000_000 })),
    ).toThrow('CAPTURE_INVALID_INPUT');
  });

  it('checks serialized request bytes rather than assuming UTF-16 characters are bytes', () => {
    const large = corpus(1);
    const item = large.cases[0]!;
    const source = item.request.sources[0]!;
    source.text += '界'.repeat(50_000);
    source.version = createHash('sha256').update(source.text).digest('hex');
    const anchors = [
      ...item.expected.status.evidence,
      ...(item.expected.payerReportedPayment?.evidence ?? []),
      ...item.expected.denialCodes.flatMap((code) => code.evidence),
    ];
    for (const anchor of anchors) anchor.sourceVersion = source.version;
    expect(source.text.length).toBeLessThan(65_536);
    expect(parseCorpus(large)).toEqual(large);
    expect(() => createCapturePlan(options({ corpus: large }))).toThrow('CAPTURE_INVALID_INPUT');
  });

  it('requires the exact registered candidate and matching evidenced request model', () => {
    expect(() => createCapturePlan(options({ candidateId: 'unregistered-guessed-model' }))).toThrow(
      'CAPTURE_INVALID_INPUT',
    );
    expect(() =>
      createCapturePlan(
        options({ evidence: fakeEvidence({ model: CANDIDATE_RELEASES[1]!.policy.requestModel }) }),
      ),
    ).toThrow('CAPTURE_INVALID_INPUT');
    expect(() =>
      createCapturePlan(
        options({ evidence: { ...fakeEvidence(), model: 'accounts/fireworks/models/guessed' } }),
      ),
    ).toThrow('CAPTURE_INVALID_INPUT');
    expect(() =>
      createCapturePlan(options({ evidence: { ...fakeEvidence(), regionalRouteVerified: true } })),
    ).toThrow('CAPTURE_INVALID_INPUT');
    expect(() =>
      createCapturePlan(
        options({ evidence: { ...fakeEvidence(), servingRevisionVerified: true } }),
      ),
    ).toThrow('CAPTURE_INVALID_INPUT');
    expect(() =>
      createCapturePlan(
        options({
          evidence: { ...fakeEvidence(), priceSource: 'https://unverified.invalid/pricing' },
        }),
      ),
    ).toThrow('CAPTURE_INVALID_INPUT');
  });

  it('rejects evidence older than 24 hours or even one millisecond in the future', () => {
    const exactBoundary = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();
    expect(
      createCapturePlan(options({ evidence: fakeEvidence({ checkedAt: exactBoundary }) })).evidence
        .checkedAt,
    ).toBe(exactBoundary);
    for (const milliseconds of [-24 * 60 * 60 * 1000 - 1, 1]) {
      expect(() =>
        createCapturePlan(
          options({
            evidence: fakeEvidence({
              checkedAt: new Date(NOW.getTime() + milliseconds).toISOString(),
            }),
          }),
        ),
      ).toThrow('CAPTURE_INVALID_INPUT');
    }
  });
});

describe('immutable capture-plan revalidation', () => {
  it.each<[string, (plan: CapturePlan) => void]>([
    [
      'wire body hash',
      (plan) => {
        plan.cases[0]!.wireRequestSha256 = '0'.repeat(64);
      },
    ],
    [
      'request hash',
      (plan) => {
        plan.cases[0]!.requestSha256 = '0'.repeat(64);
      },
    ],
    [
      'request bytes',
      (plan) => {
        plan.cases[0]!.requestBytes += 1;
      },
    ],
    [
      'storage identity',
      (plan) => {
        plan.cases[0]!.storageId = '0'.repeat(64);
      },
    ],
    [
      'case ordering',
      (plan) => {
        plan.cases.reverse();
      },
    ],
    [
      'missing case',
      (plan) => {
        plan.cases.pop();
      },
    ],
    [
      'corpus hash',
      (plan) => {
        plan.corpusSha256 = '0'.repeat(64);
      },
    ],
    [
      'case reservation',
      (plan) => {
        plan.budget.reservedPerCaseUsdMicros -= 1;
      },
    ],
    [
      'total reservation',
      (plan) => {
        plan.budget.reservedTotalUsdMicros -= 1;
      },
    ],
    [
      'output allowance',
      (plan) => {
        plan.budget.completionTokenAllowance = 4096;
      },
    ],
    [
      'tenant scope',
      (plan) => {
        plan.target.policy.organizations = ['unapproved_tenant'];
      },
    ],
    [
      'response-model allowlist',
      (plan) => {
        plan.target.policy.responseModels = ['guessed_response_identity'];
      },
    ],
    [
      'release state',
      (plan) => {
        plan.target.policy.state = 'APPROVED';
      },
    ],
    [
      'wire completion limit',
      (plan) => {
        plan.target.policy.limits.outputTokens -= 1;
      },
    ],
    [
      'host',
      (plan) => {
        plan.hostSha256 = '0'.repeat(64);
      },
    ],
    [
      'implementation',
      (plan) => {
        plan.implementationSha256 = 'b'.repeat(64);
      },
    ],
    [
      'directory',
      (plan) => {
        plan.directory = '/synthetic-tests/another-capture';
      },
    ],
    [
      'expiry',
      (plan) => {
        plan.expiresAt = '2026-10-15T12:00:00.000Z';
      },
    ],
  ])('rejects altered %s', (_name, mutate) => {
    const source = corpus();
    const plan = createCapturePlan(options({ corpus: source }));
    mutate(plan);
    expect(() => validateCapturePlan(plan, source, ARTIFACT, DIRECTORY)).toThrow(
      'CAPTURE_BINDING_MISMATCH',
    );
  });

  it('rejects changed source text or annotation even if its local schema remains valid', () => {
    const original = corpus();
    const plan = createCapturePlan(options({ corpus: original }));
    const changedSource = structuredClone(original);
    changedSource.cases[0]!.request.sources[0]!.text += ' Additional synthetic statement.';
    expect(parseCorpus(changedSource)).toEqual(changedSource);
    expect(() => validateCapturePlan(plan, changedSource, ARTIFACT, DIRECTORY)).toThrow(
      'CAPTURE_BINDING_MISMATCH',
    );
    const changedAnnotation = structuredClone(original);
    changedAnnotation.cases[0]!.expected.proposedAction = 'MANUAL_REVIEW';
    expect(parseCorpus(changedAnnotation)).toEqual(changedAnnotation);
    expect(() => validateCapturePlan(plan, changedAnnotation, ARTIFACT, DIRECTORY)).toThrow(
      'CAPTURE_BINDING_MISMATCH',
    );
  });

  it('binds execution to the current artifact and exact private run directory', () => {
    const source = corpus();
    const plan = createCapturePlan(options({ corpus: source }));
    expect(() => validateCapturePlan(plan, source, 'b'.repeat(64), DIRECTORY)).toThrow(
      'CAPTURE_BINDING_MISMATCH',
    );
    expect(() => validateCapturePlan(plan, source, ARTIFACT, '/synthetic-tests/moved')).toThrow(
      'CAPTURE_BINDING_MISMATCH',
    );
  });

  it('cannot turn planning or local authorization into authenticated production approval', () => {
    const source = corpus();
    const plan = createCapturePlan(options({ corpus: source }));
    expect(() =>
      validateCapturePlan({ ...plan, productionApproval: true }, source, ARTIFACT, DIRECTORY),
    ).toThrow('CAPTURE_INVALID_INPUT');
    expect(() =>
      validateCapturePlan(
        { ...plan, budget: { ...plan.budget, refunds: true } },
        source,
        ARTIFACT,
        DIRECTORY,
      ),
    ).toThrow('CAPTURE_INVALID_INPUT');
    expect(() =>
      validateCapturePlan(
        { ...plan, budget: { ...plan.budget, providerBillingCapVerified: true } },
        source,
        ARTIFACT,
        DIRECTORY,
      ),
    ).toThrow('CAPTURE_INVALID_INPUT');
    const authorization = {
      schemaVersion: 'observation-capture-authorization.v1',
      planSha256: evidenceHash(plan),
      authorizedAt: NOW.toISOString(),
      expiresAt: plan.expiresAt,
      authority: 'LOCAL_OPERATOR_EXPLICIT_CONFIRMATION',
      authenticatedHumanApproval: false,
    };
    expect(CaptureAuthorizationSchema.safeParse(authorization).success).toBe(true);
    expect(
      CaptureAuthorizationSchema.safeParse({ ...authorization, authenticatedHumanApproval: true })
        .success,
    ).toBe(false);
    expect(
      CaptureAuthorizationSchema.safeParse({ ...authorization, authority: 'PRODUCTION_APPROVED' })
        .success,
    ).toBe(false);
  });
});

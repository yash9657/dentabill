import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FIREWORKS_ENDPOINT,
  type FireworksTransport,
  type GatewayRequest,
  type TransportResult,
} from './contracts.js';
import { createFakeModelGateway, SYNTHETIC_RELEASE_ID } from './fake.js';
import { createFireworksGateway } from './gateway.js';
import { CANDIDATE_RELEASES, releasePolicyHash } from './release.js';
import {
  observationFixture,
  releaseFixture,
  requestFixture,
  TEST_ARTIFACT_HASH,
  transportSuccess,
} from './test-fixtures.js';
import { createFireworksTransport } from './transport.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function gateway(transport: FireworksTransport, deadlineMs = 30_000) {
  const release = releaseFixture();
  release.policy.limits.deadlineMs = deadlineMs;
  release.approval!.policySha256 = releasePolicyHash(release.policy);
  return createFireworksGateway({
    apiKey: 'synthetic-key',
    releases: [release],
    implementationArtifactSha256: TEST_ARTIFACT_HASH,
    transport,
  });
}

describe('typed Fireworks gateway', () => {
  it('credentials alone do not enable inference and missing keys never select a fake fallback', async () => {
    const transport = vi.fn<FireworksTransport>().mockResolvedValue(transportSuccess());
    const request = { ...requestFixture(), releaseId: CANDIDATE_RELEASES[0]!.policy.id };
    expect(
      await createFireworksGateway({ apiKey: 'synthetic-key', transport }).generate(request),
    ).toMatchObject({ status: 'FAILED', code: 'RELEASE_UNAPPROVED', attempts: [] });
    expect(
      await createFireworksGateway({
        releases: [releaseFixture()],
        implementationArtifactSha256: TEST_ARTIFACT_HASH,
        transport,
      }).generate(requestFixture()),
    ).toMatchObject({ status: 'FAILED', code: 'CONFIGURATION_ERROR' });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(['synthetic\r\nX-Secret: value', ' ', '\t', ''])(
    'rejects unusable credentials before network',
    async (apiKey) => {
      const transport = vi.fn<FireworksTransport>();
      const instance = createFireworksGateway({
        apiKey,
        releases: [releaseFixture()],
        implementationArtifactSha256: TEST_ARTIFACT_HASH,
        transport,
      });
      expect(await instance.generate(requestFixture())).toMatchObject({
        status: 'FAILED',
        code: 'CONFIGURATION_ERROR',
      });
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it('rejects caller overrides, missing identity, cross-tenant and stale sources before transport', async () => {
    const transport = vi.fn<FireworksTransport>();
    const requests = [
      { ...requestFixture(), model: 'closed-model' },
      { ...requestFixture(), endpoint: 'https://unapproved.invalid' },
      { ...requestFixture(), claim: { ...requestFixture().claim, id: '' } },
      { ...requestFixture(), claim: { ...requestFixture().claim, organizationId: 'other-org' } },
      {
        ...requestFixture(),
        sources: [{ ...requestFixture().sources[0]!, organizationId: 'other-org' }],
      },
      {
        ...requestFixture(),
        sources: [{ ...requestFixture().sources[0]!, claimVersion: '2026-10-12T12:00:00.000Z' }],
      },
    ];
    for (const request of requests)
      expect(await gateway(transport).generate(request)).toMatchObject({
        status: 'FAILED',
        code: 'INVALID_REQUEST',
        attempts: [],
      });
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects excessive timestamp precision before network', async () => {
    const request = requestFixture();
    request.claim.version = '2026-10-13T12:00:00.' + '1'.repeat(100_000) + 'Z';
    const transport = vi.fn<FireworksTransport>();
    expect(await gateway(transport).generate(request)).toMatchObject({
      status: 'FAILED',
      code: 'INVALID_REQUEST',
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('bounds serialized UTF-8 request bytes, not only source character count', async () => {
    const request = requestFixture();
    request.sources[0]!.text = '€'.repeat(60_000);
    const transport = vi.fn<FireworksTransport>();
    expect(await gateway(transport).generate(request)).toMatchObject({
      status: 'FAILED',
      code: 'REQUEST_TOO_LARGE',
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('constructs the exact native wire request and accepts only a reviewed, source-bound observation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'fixture-response',
          created: 1,
          model: 'accounts/fixture/models/observed-response',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: JSON.stringify(observationFixture()) },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: null,
            total_tokens: 130,
            prompt_tokens_details: { cached_tokens: null },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await gateway(createFireworksTransport({ fetch })).generate(requestFixture());
    expect(result).toMatchObject({
      status: 'VALIDATED',
      requiresHumanReview: true,
      output: observationFixture(),
      provenance: {
        kind: 'FIREWORKS',
        releaseId: 'fixture-evaluation.v1',
        usage: { inputTokens: 100, outputTokens: null, cachedInputTokens: null, totalTokens: 130 },
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(FIREWORKS_ENDPOINT);
    expect(init?.redirect).toBe('error');
    if (typeof init?.body !== 'string') throw new Error('EXPECTED_JSON_BODY');
    const body: unknown = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: 'accounts/fireworks/routers/glm-5p3-flash-us',
      stream: false,
      n: 1,
      max_tokens: 4096,
      context_length_exceeded_behavior: 'error',
      response_format: { type: 'json_schema', json_schema: { name: 'claim_observation_v1' } },
    });
    expect(Object.keys(body as object).sort()).toEqual(
      [
        'model',
        'messages',
        'stream',
        'n',
        'max_tokens',
        'context_length_exceeded_behavior',
        'response_format',
        'prompt_cache_isolation_key',
      ].sort(),
    );
    expect(JSON.stringify(body)).not.toContain('org-test');
    expect(JSON.stringify(body)).not.toContain('invocation-test');
  });

  it('isolates provider prompt cache across tenants and releases without raw IDs', async () => {
    const transport = vi.fn<FireworksTransport>().mockResolvedValue(transportSuccess());
    const first = releaseFixture();
    first.policy.organizations.push('org-other');
    first.approval!.policySha256 = releasePolicyHash(first.policy);
    const second = structuredClone(first);
    second.policy.id = 'fixture-evaluation.v2';
    second.approval!.policySha256 = releasePolicyHash(second.policy);
    const instance = createFireworksGateway({
      apiKey: 'synthetic-key',
      releases: [first, second],
      implementationArtifactSha256: TEST_ARTIFACT_HASH,
      transport,
    });
    const request = requestFixture();
    await instance.generate(request);
    const other = structuredClone(request);
    other.organizationId = 'org-other';
    other.claim.organizationId = 'org-other';
    other.sources[0]!.organizationId = 'org-other';
    await instance.generate(other);
    await instance.generate({ ...request, releaseId: second.policy.id });
    const keys = transport.mock.calls.map(([call]) => {
      const body: { prompt_cache_isolation_key: string } = JSON.parse(call.body);
      return body.prompt_cache_isolation_key;
    });
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    '{',
    '```json\n{}\n```',
    '{"claimId":"claim-test"}',
    '['.repeat(33) + '0' + ']'.repeat(33),
  ])('does not repair or retry malformed/schema-invalid content', async (content) => {
    const success = transportSuccess();
    expect(success.ok).toBe(true);
    const transport = vi
      .fn<FireworksTransport>()
      .mockResolvedValue({ ...success, content } as TransportResult);
    expect(await gateway(transport).generate(requestFixture())).toMatchObject({
      status: 'FAILED',
      code: 'OUTPUT_SCHEMA_INVALID',
      attempts: [{ acceptance: 'RESPONDED' }],
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects valid JSON with invented identity/evidence without losing incurred usage', async () => {
    const observation = observationFixture();
    observation.claimId = 'invented-claim';
    const transport = vi.fn<FireworksTransport>().mockResolvedValue(transportSuccess(observation));
    expect(await gateway(transport).generate(requestFixture())).toMatchObject({
      status: 'FAILED',
      code: 'OUTPUT_SEMANTIC_INVALID',
      attempts: [{ usage: { inputTokens: 100, outputTokens: 30 } }],
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('returns abstention distinctly with no asserted payment or completed action', async () => {
    const observation = observationFixture();
    observation.disposition = 'ABSTAIN';
    observation.status = { value: 'UNKNOWN', evidence: [] };
    observation.proposedAction = 'MANUAL_REVIEW';
    observation.abstentionReason = 'CONTRADICTORY_EVIDENCE';
    expect(
      await gateway(async () => transportSuccess(observation)).generate(requestFixture()),
    ).toMatchObject({
      status: 'ABSTAINED',
      requiresHumanReview: true,
      output: { payerReportedPayment: null, proposedAction: 'MANUAL_REVIEW' },
    });
  });

  it('cancels before send without an attempt', async () => {
    const controller = new AbortController();
    controller.abort(new Error('PRIVATE_REASON'));
    const transport = vi.fn<FireworksTransport>();
    expect(
      await gateway(transport).generate(requestFixture(), { signal: controller.signal }),
    ).toMatchObject({ status: 'FAILED', code: 'CANCELLED', attempts: [] });
    expect(transport).not.toHaveBeenCalled();
  });

  it('bounds an abort-ignoring transport and discards a late successful response', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let finish: ((value: TransportResult) => void) | undefined;
    let signal: AbortSignal | undefined;
    const transport = vi.fn<FireworksTransport>().mockImplementation((request) => {
      signal = request.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const pending = gateway(transport, 20).generate(requestFixture());
    await vi.advanceTimersByTimeAsync(21);
    const result = await pending;
    expect(result).toMatchObject({
      status: 'FAILED',
      code: 'DEADLINE_EXCEEDED',
      attempts: [{ acceptance: 'POSSIBLE', usage: { totalTokens: null } }],
    });
    expect(signal?.aborted).toBe(true);
    finish?.(transportSuccess());
    await vi.runAllTimersAsync();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('FAILED');
  });

  it('propagates cancellation to a hanging transport and keeps the failure sanitized', async () => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    const transport = vi.fn<FireworksTransport>().mockImplementation((request) => {
      signal = request.signal;
      return new Promise(() => undefined);
    });
    const pending = gateway(transport).generate(requestFixture(), { signal: controller.signal });
    controller.abort(new Error('SYNTHETIC_PRIVATE_CANCELLATION'));
    const result = await pending;
    expect(result).toMatchObject({ status: 'FAILED', code: 'CANCELLED' });
    expect(signal?.aborted).toBe(true);
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE');
  });

  it.each(['CANCELLED', 'DEADLINE_EXCEEDED'] as const)(
    'retains every actual native attempt when %s interrupts the second send',
    async (code) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const controller = new AbortController();
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(new Response('PRIVATE_ERROR_BODY', { status: 503 }))
        .mockImplementation(() => new Promise(() => undefined));
      const pending = gateway(createFireworksTransport({ fetch }), 300).generate(requestFixture(), {
        signal: controller.signal,
      });
      await vi.advanceTimersByTimeAsync(101);
      expect(fetch).toHaveBeenCalledTimes(2);
      if (code === 'CANCELLED') controller.abort();
      else await vi.advanceTimersByTimeAsync(200);
      const result = await pending;
      expect(result).toMatchObject({
        status: 'FAILED',
        code,
        attempts: [
          {
            index: 1,
            httpStatus: 503,
            outcome: 'HTTP_ERROR',
            acceptance: 'RESPONDED',
            usage: { totalTokens: null },
          },
          {
            index: 2,
            httpStatus: null,
            outcome: code,
            acceptance: 'POSSIBLE',
            usage: { totalTokens: null },
          },
        ],
      });
      expect(JSON.stringify(result)).not.toContain('PRIVATE_ERROR_BODY');
    },
  );

  it('does not invent another attempt when cancellation interrupts native backoff', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const controller = new AbortController();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('', { status: 429 }));
    const pending = gateway(createFireworksTransport({ fetch })).generate(requestFixture(), {
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(50);
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({
      status: 'FAILED',
      code: 'CANCELLED',
      attempts: [{ index: 1, httpStatus: 429, outcome: 'HTTP_ERROR' }],
    });
    if (result.status === 'FAILED') expect(result.attempts).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never logs or returns thrown provider messages, input or key in failures', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const request = requestFixture();
    request.sources[0]!.text = 'SYNTHETIC_PRIVATE_PATIENT';
    const result = await gateway(async () => {
      throw new Error('SYNTHETIC_PRIVATE_PATIENT synthetic-key');
    }).generate(request);
    expect(result).toMatchObject({
      status: 'FAILED',
      code: 'NETWORK_ERROR',
      attempts: [{ acceptance: 'POSSIBLE' }],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /SYNTHETIC_PRIVATE|synthetic-key|stack|cause|message/,
    );
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('explicit synthetic adapter', () => {
  const request = (): GatewayRequest => ({ ...requestFixture(), releaseId: SYNTHETIC_RELEASE_ID });

  it('abstains for unknown fixtures instead of inventing evidence', async () => {
    const result = await createFakeModelGateway().generate(request());
    expect(result).toMatchObject({
      status: 'ABSTAINED',
      requiresHumanReview: true,
      output: { claimId: 'claim-test', status: { value: 'UNKNOWN', evidence: [] } },
      provenance: {
        kind: 'SYNTHETIC',
        responseId: null,
        model: null,
        attempts: [],
        usage: { totalTokens: null },
      },
    });
  });

  it('binds fixture output to the entire input and returns independent copies', async () => {
    const input = request();
    const output = observationFixture(input);
    const instance = createFakeModelGateway([{ request: input, output }]);
    const first = await instance.generate(input);
    expect(first).toMatchObject({ status: 'VALIDATED', provenance: { kind: 'SYNTHETIC' } });
    if (first.status !== 'FAILED') first.output.status.value = 'PAID_REPORTED';
    expect(await instance.generate(input)).toMatchObject({
      output: { status: { value: 'PENDING_REPORTED' } },
    });
    const changed = structuredClone(input);
    changed.sources[0]!.text += ' Later evidence.';
    expect(await instance.generate(changed)).toMatchObject({ status: 'ABSTAINED' });
    expect(await instance.generate({ ...input, invocationId: 'other-invocation' })).toMatchObject({
      status: 'ABSTAINED',
    });
  });

  it('cannot consume protected data, impersonate an approved release or accept forged fixtures', async () => {
    expect(
      await createFakeModelGateway().generate({ ...request(), dataClass: 'PROTECTED' }),
    ).toMatchObject({ status: 'FAILED', code: 'RELEASE_SCOPE_MISMATCH' });
    expect(await createFakeModelGateway().generate(requestFixture())).toMatchObject({
      status: 'FAILED',
      code: 'RELEASE_SCOPE_MISMATCH',
    });
    const output = observationFixture();
    output.claimId = 'forged-claim';
    expect(() => createFakeModelGateway([{ request: request(), output }])).toThrow(
      'INVALID_SYNTHETIC_FIXTURE',
    );
  });
});

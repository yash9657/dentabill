import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GatewayJournalFactory } from './contracts.js';
import { createFireworksGateway } from './gateway.js';
import {
  journalFixture,
  observationFixture,
  releaseFixture,
  requestFixture,
  TEST_ARTIFACT_HASH,
} from './test-fixtures.js';
import { createFireworksTransport } from './transport.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function savedBody(): string {
  return JSON.stringify({
    id: 'saved-response',
    model: 'accounts/fixture/models/observed-response',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(observationFixture()) },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });
}
function journal(status = 200, replay = true): GatewayJournalFactory {
  return {
    open: async () => ({
      kind: 'READY',
      session: {
        executionDeadlineAt: '2020-01-01T00:00:00.000Z',
        journal: journalFixture(),
        complete: async () => undefined,
        ...(replay
          ? {
              replay: {
                attempts: [],
                response: {
                  index: 1,
                  status,
                  body: status === 200 ? savedBody() : null,
                  retryDelayMs: 0,
                },
              },
            }
          : {}),
      },
    }),
  };
}

describe('saved native receipt recovery', () => {
  it('validates a saved response after approval/deadline expiry without a key or HTTP', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const release = releaseFixture();
    release.approval!.expiresAt = '2021-01-01T00:00:00.000Z';
    const untrustedTransport = vi.fn();
    const gateway = createFireworksGateway({
      releases: [release],
      implementationArtifactSha256: TEST_ARTIFACT_HASH,
      replayOnly: true,
      journalFactory: journal(),
      transport: untrustedTransport,
    });
    expect(await gateway.generate(requestFixture())).toMatchObject({
      status: 'VALIDATED',
      provenance: { usage: { totalTokens: 20 } },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(untrustedTransport).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'cannot send when replayOnly has no response or a retryable saved error (%s)',
    async (replay) => {
      const fetch = vi.spyOn(globalThis, 'fetch');
      const result = await createFireworksGateway({
        releases: [releaseFixture()],
        implementationArtifactSha256: TEST_ARTIFACT_HASH,
        replayOnly: true,
        journalFactory: journal(503, replay),
      }).generate(requestFixture());
      expect(result.status).toBe('FAILED');
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('still requires the original approved policy and exact implementation to replay', async () => {
    const result = await createFireworksGateway({
      releases: [releaseFixture()],
      implementationArtifactSha256: 'f'.repeat(64),
      replayOnly: true,
      journalFactory: journal(),
    }).generate(requestFixture());
    expect(result).toMatchObject({ status: 'FAILED', code: 'RELEASE_INTEGRITY_FAILED' });
  });
  it('blocks a send when release approval expires while durable admission is awaited', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = Date.now();
    const release = releaseFixture();
    release.approval!.expiresAt = new Date(now + 1000).toISOString();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const factory: GatewayJournalFactory = {
      open: async (binding) => ({
        kind: 'READY',
        session: {
          executionDeadlineAt: binding.executionDeadlineAt,
          complete: async () => undefined,
          journal: {
            ...journalFixture(),
            beforeAttempt: async () => {
              vi.setSystemTime(now + 2000);
              return 'ADMITTED';
            },
          },
        },
      }),
    };
    const result = await createFireworksGateway({
      apiKey: 'synthetic-test',
      releases: [release],
      implementationArtifactSha256: TEST_ARTIFACT_HASH,
      journalFactory: factory,
      transport: createFireworksTransport({ fetch }),
    }).generate(requestFixture());
    expect(result.status).toBe('FAILED');
    expect(fetch).not.toHaveBeenCalled();
  });
});

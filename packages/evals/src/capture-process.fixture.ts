/* eslint-disable security/detect-non-literal-fs-filename -- Isolated synthetic process fixture paths are created by the test parent. */
import { open } from 'node:fs/promises';

import {
  createFireworksDiscoveryTransport,
  type FireworksDiscoveryTransport,
} from '@dentabill/model-gateway';

import { runCapture } from './capture-run.js';
import { CaptureStore } from './capture-store.js';
import { evidenceHash } from './contracts.js';

const fixedEndpoint = 'https://us.api.fireworks.ai/inference/v1/chat/completions';

async function execute(): Promise<void> {
  const [directory, providerUrl, mode, checkpoint] = process.argv.slice(2);
  if (
    !directory ||
    !providerUrl ||
    (mode !== 'NORMAL' && mode !== 'PAUSE_AFTER_RAW' && mode !== 'PAUSE_AFTER_CANCELLED_RAW')
  )
    throw new Error('INVALID_SYNTHETIC_FIXTURE');
  const local = new URL(providerUrl);
  if (
    local.protocol !== 'http:' ||
    local.hostname !== '127.0.0.1' ||
    !local.port ||
    local.username ||
    local.password ||
    local.pathname !== '/synthetic' ||
    local.search ||
    local.hash
  )
    throw new Error('INVALID_SYNTHETIC_PROVIDER');
  const native = createFireworksDiscoveryTransport({
    fetch: async (requested, init) => {
      if (requested !== fixedEndpoint || init?.method !== 'POST' || init.redirect !== 'error')
        throw new Error('UNEXPECTED_TRANSPORT_ENDPOINT');
      return globalThis.fetch(local, init);
    },
  });
  const transport: FireworksDiscoveryTransport = async (request) => {
    if (mode === 'NORMAL') return native(request);
    const journal = request.journal;
    if (!journal || !checkpoint) throw new Error('MISSING_SYNTHETIC_CHECKPOINT');
    return native({
      ...request,
      journal: {
        ...journal,
        async recordResponse(response) {
          // Crash only after the real filesystem journal has synced its raw receipt.
          await journal.recordResponse(response);
          if (mode === 'PAUSE_AFTER_CANCELLED_RAW') {
            // Simulate interruption before usage interpretation, with an immutable earlier
            // attempt receipt that must not hide over-allowance usage in the raw response.
            await journal.completeAttempt({
              attempt: {
                index: 1,
                httpStatus: 200,
                acceptance: 'RESPONDED',
                outcome: 'CANCELLED',
                elapsedMs: 0,
                usage: {
                  inputTokens: null,
                  outputTokens: null,
                  totalTokens: null,
                  cachedInputTokens: null,
                },
              },
              errorCode: 'CANCELLED',
            });
          }
          const marker = await open(checkpoint, 'wx', 0o600);
          try {
            await marker.writeFile('RAW_RESPONSE_DURABLE\n');
            await marker.sync();
          } finally {
            await marker.close();
          }
          await new Promise<never>(() => {
            setInterval(() => undefined, 1000);
          });
        },
      },
    });
  };
  const store = await CaptureStore.open(directory);
  await runCapture({
    store,
    implementationSha256: 'a'.repeat(64),
    authorizePlanSha256: evidenceHash(await store.read('manifest.json')),
    apiKey: 'synthetic-local-provider',
    transport,
    // Account identity is a synthetic fixture; this child must never contact account APIs.
    verifyAccount: () => Promise.resolve(),
  });
  process.stdout.write('CAPTURE_PROCESS_COMPLETED\n');
}

await execute().catch(() => {
  process.stderr.write('CAPTURE_PROCESS_FAILED\n');
  process.exitCode = 1;
});

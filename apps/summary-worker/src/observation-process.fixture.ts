import { open } from 'node:fs/promises';
import { createServer } from 'node:http';

import { prisma } from '@dentabill/db';
import {
  createFireworksTransport,
  type GatewayRequest,
  type GatewayResult,
} from '@dentabill/model-gateway';

import {
  OBSERVATION_TEST_ARTIFACT,
  observationRelease,
  observationResponse,
  type ObservationResponseVariant,
} from './observation-inference.fixtures.js';
import { createDurableObservationGateway } from './observation-inference.js';
import { publishStoredObservation } from './observation-publication.js';

export type ObservationProcessCommand =
  | {
      type: 'provider.start';
      ledgerPath: string;
      request: GatewayRequest;
      mode: ObservationResponseVariant | 'hold' | 'retry';
    }
  | {
      type: 'worker.run';
      callId: string;
      request: GatewayRequest;
      providerUrl: string;
      pause?: 'raw-response' | 'second-admission' | 'before-first-admission';
      deadlineMs?: number;
      regenerationId?: string;
    }
  | { type: 'worker.cancel' };
export type ObservationProcessReply =
  | { type: 'provider.ready'; url: string; pid: number }
  | { type: 'provider.accepted'; ordinal: number }
  | {
      type: 'worker.paused';
      boundary: 'raw-response' | 'second-admission' | 'before-first-admission';
    }
  | { type: 'worker.result'; result: GatewayResult; sends: number }
  | { type: 'fixture.failed' };

function reply(value: ObservationProcessReply): void {
  process.send?.(value);
}
let cancellation: AbortController | undefined;

async function execute(command: ObservationProcessCommand): Promise<void> {
  if (command.type === 'worker.cancel') {
    cancellation?.abort();
    return;
  }
  if (command.type === 'provider.start') {
    let ordinal = 0;
    const server = createServer((incoming, response) => {
      void (async () => {
        incoming.resume();
        const accepted = ++ordinal;
        // Private synthetic test ledger, flushed independently from the inference process.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const ledger = await open(command.ledgerPath, 'a', 0o600);
        try {
          await ledger.write(`${JSON.stringify({ ordinal: accepted })}\n`);
          await ledger.sync();
        } finally {
          await ledger.close();
        }
        reply({ type: 'provider.accepted', ordinal: accepted });
        if (command.mode === 'hold') return;
        const status = command.mode === 'retry' && accepted === 1 ? 503 : 200;
        response.writeHead(status, { 'content-type': 'application/json', 'retry-after': '0' });
        response.end(
          status === 503
            ? '{"error":"synthetic unavailable"}'
            : observationResponse(
                command.request,
                command.mode === 'retry' ? 'valid' : command.mode,
              ),
        );
      })().catch(() => {
        reply({ type: 'fixture.failed' });
        response.destroy();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reply({ type: 'fixture.failed' });
        return;
      }
      reply({
        type: 'provider.ready',
        url: `http://127.0.0.1:${String(address.port)}/synthetic-observation`,
        pid: process.pid,
      });
    });
    return;
  }
  const endpoint = new URL(command.providerUrl);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1')
    throw new Error('Local fixture endpoint required.');
  cancellation = new AbortController();
  let sends = 0;
  const pendingAdmissions: Promise<unknown>[] = [];
  const native = createFireworksTransport({
    fetch: async (url, init) => {
      if (
        (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url) !==
        'https://us.api.fireworks.ai/inference/v1/chat/completions'
      )
        throw new Error('Unexpected native endpoint.');
      sends++;
      return fetch(endpoint, init);
    },
  });
  const gateway = createDurableObservationGateway({
    prisma,
    callId: command.callId,
    ...(command.regenerationId ? { regenerationId: command.regenerationId } : {}),
    dailyTokenLimit: 1_000_000,
    apiKey: 'synthetic-local-fixture',
    releases: [
      observationRelease(
        command.request.organizationId,
        command.deadlineMs ? { deadlineMs: command.deadlineMs } : {},
      ),
    ],
    implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
    transport: (input) => {
      if (!input.journal) throw new Error('Durable journal required.');
      const original = input.journal;
      return native({
        ...input,
        journal: {
          async beforeAttempt(attempt) {
            if (command.pause === 'before-first-admission' && attempt.index === 1) {
              reply({ type: 'worker.paused', boundary: 'before-first-admission' });
              await new Promise<void>(() => undefined);
            }
            const pending = original.beforeAttempt(attempt);
            pendingAdmissions.push(pending);
            const result = await pending;
            if (
              command.pause === 'second-admission' &&
              attempt.index === 2 &&
              result === 'ADMITTED'
            ) {
              reply({ type: 'worker.paused', boundary: 'second-admission' });
              await new Promise<void>(() => undefined);
            }
            return result;
          },
          async recordResponse(receipt) {
            await original.recordResponse(receipt);
            if (command.pause === 'raw-response') {
              reply({ type: 'worker.paused', boundary: 'raw-response' });
              await new Promise<void>(() => undefined);
            }
          },
          completeAttempt: (receipt) => original.completeAttempt(receipt),
        },
      });
    },
  });
  const result = await gateway.generate(command.request, { signal: cancellation.signal });
  if (command.regenerationId && result.status !== 'FAILED') {
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: {
        organizationId: command.request.organizationId,
        callId: command.callId,
        regenerationId: command.regenerationId,
      },
    });
    await publishStoredObservation({
      prisma,
      organizationId: command.request.organizationId,
      runId: run.id,
    });
  }
  reply({ type: 'worker.result', result, sends });
  await Promise.allSettled(pendingAdmissions);
  await prisma.$disconnect();
  process.exit(0);
}

process.on('message', (command: ObservationProcessCommand) => {
  void execute(command).catch(() => {
    reply({ type: 'fixture.failed' });
    process.exitCode = 1;
  });
});

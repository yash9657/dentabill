import { createServer, type RequestListener } from 'node:http';

import { describe, expect, it } from 'vitest';

import { FIREWORKS_ENDPOINT, type FireworksTransportRequest } from './contracts.js';
import { journalFixture } from './test-fixtures.js';
import { createFireworksTransport } from './transport.js';

const model = 'accounts/synthetic/models/http-test';
const content = JSON.stringify({ note: 'Synthetic tooth 🦷' });
const body = Buffer.from(
  JSON.stringify({
    id: 'synthetic_http_response',
    model,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
  }),
);

function request(overrides: Partial<FireworksTransportRequest> = {}): FireworksTransportRequest {
  return {
    apiKey: 'synthetic-local-http-key',
    body: JSON.stringify({ model, stream: false, messages: [] }),
    expectedResponseModels: [model],
    maxResponseBytes: body.byteLength,
    deadlineAt: performance.now() + 3000,
    maxAttempts: 2,
    journal: journalFixture(),
    ...overrides,
  };
}

async function localServer(handler: RequestListener): Promise<{
  fetch: typeof globalThis.fetch;
  close: () => Promise<void>;
}> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local test server has no port');
  return {
    fetch: async (input, init) => {
      expect(input).toBe(FIREWORKS_ENDPOINT);
      expect(init?.redirect).toBe('error');
      return globalThis.fetch(`http://127.0.0.1:${String(address.port)}/synthetic`, init);
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}

async function within<T>(promise: Promise<T>, ms = 1500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Local HTTP event was not observed'));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe('Fireworks transport with native fetch over localhost only', () => {
  it('decodes chunked UTF-8 across a character boundary and enforces exact wire bytes', async () => {
    const split = body.indexOf(Buffer.from('🦷')) + 1;
    const server = await localServer((_incoming, outgoing) => {
      outgoing.writeHead(200, { 'Content-Type': 'application/json' });
      outgoing.write(body.subarray(0, split));
      setTimeout(() => outgoing.end(body.subarray(split)), 10);
    });
    try {
      const transport = createFireworksTransport({ fetch: server.fetch });
      expect(await transport(request())).toMatchObject({ ok: true, content });
      expect(await transport(request({ maxResponseBytes: body.byteLength - 1 }))).toMatchObject({
        ok: false,
        code: 'RESPONSE_TOO_LARGE',
        attempts: [{ index: 1, httpStatus: 200, acceptance: 'RESPONDED' }],
      });
    } finally {
      await server.close();
    }
  });

  it.each(['headers', 'body'] as const)(
    'aborts a hung %s connection as observed by the server',
    async (stage) => {
      let accepted: () => void = () => undefined;
      const received = new Promise<void>((resolve) => {
        accepted = resolve;
      });
      let disconnected: () => void = () => undefined;
      const closed = new Promise<void>((resolve) => {
        disconnected = resolve;
      });
      const server = await localServer((_incoming, outgoing) => {
        outgoing.once('close', disconnected);
        if (stage === 'body') {
          outgoing.writeHead(200, { 'Content-Type': 'application/json' });
          outgoing.write('{');
        }
        accepted();
      });
      try {
        const abort = new AbortController();
        const transport = createFireworksTransport({ fetch: server.fetch });
        const result = transport(
          request({
            signal: abort.signal,
            deadlineAt: performance.now() + (stage === 'body' ? 500 : 3000),
          }),
        );
        await within(received);
        if (stage === 'headers') abort.abort();
        expect(await result).toMatchObject({
          ok: false,
          code: stage === 'headers' ? 'CANCELLED' : 'DEADLINE_EXCEEDED',
          attempts: [{ index: 1, httpStatus: stage === 'body' ? 200 : null }],
        });
        await within(closed);
      } finally {
        await server.close();
      }
    },
  );

  it('preserves a real 503 response and a second accepted body when cancellation closes the socket', async () => {
    let count = 0;
    let observed: () => void = () => undefined;
    const secondHeaders = new Promise<void>((resolve) => {
      observed = resolve;
    });
    let disconnected: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => {
      disconnected = resolve;
    });
    const server = await localServer((_incoming, outgoing) => {
      count += 1;
      if (count === 1) {
        outgoing.writeHead(503, { 'Retry-After': '0' });
        outgoing.end('Synthetic unavailable response');
        return;
      }
      outgoing.once('close', disconnected);
      outgoing.writeHead(200, { 'Content-Type': 'application/json' });
      outgoing.write('{');
    });
    try {
      const abort = new AbortController();
      const transport = createFireworksTransport({ fetch: server.fetch });
      const result = transport(
        request({
          signal: abort.signal,
          onProgress: (progress) => {
            if (progress.activeAttempt?.index === 2 && progress.activeAttempt.httpStatus === 200)
              observed();
          },
        }),
      );
      await within(secondHeaders);
      abort.abort();
      expect(await result).toMatchObject({
        ok: false,
        code: 'CANCELLED',
        attempts: [
          { index: 1, httpStatus: 503, outcome: 'HTTP_ERROR', acceptance: 'RESPONDED' },
          { index: 2, httpStatus: 200, outcome: 'CANCELLED', acceptance: 'RESPONDED' },
        ],
      });
      await within(closed);
      expect(count).toBe(2);
    } finally {
      await server.close();
    }
  });
});

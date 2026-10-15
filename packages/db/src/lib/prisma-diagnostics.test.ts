import { Writable } from 'node:stream';

import { createLogger } from '@dentabill/logger';
import { PrismaClient, type Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { registerPrismaDiagnostics } from './prisma-diagnostics.js';

type DiagnosticLevel = 'error' | 'warn' | 'info';
function capture() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const log = createLogger({ stream, base: { service: 'prisma' }, level: 'info' });
  return { log, chunks };
}
function listeners(log: ReturnType<typeof createLogger>) {
  const callbacks = new Map<DiagnosticLevel, (event: Prisma.LogEvent) => void>();
  const source = {
    $on: vi.fn((level: DiagnosticLevel, callback: (event: Prisma.LogEvent) => void) => {
      callbacks.set(level, callback);
    }),
  };
  registerPrismaDiagnostics(source, log);
  expect(source.$on.mock.calls.map(([level]) => level)).toEqual(['error', 'warn', 'info']);
  return (level: DiagnosticLevel, event: Prisma.LogEvent): void => {
    const callback = callbacks.get(level);
    if (!callback) throw new Error('Missing diagnostic callback');
    callback(event);
  };
}

describe('Prisma diagnostic log boundary', () => {
  it.each(['error', 'warn', 'info'] as const)(
    'contains synthetic PHI and credentials at the registered %s callback before structured logging',
    (level) => {
      const { log, chunks } = capture();
      const emit = listeners(log);
      const event = {
        timestamp: new Date('2026-10-13T18:00:00.000Z'),
        target: 'claim.update',
        message: 'Synthetic Patient Example, DOB 1990-01-01, MEMBER-SYNTHETIC-123',
        query: 'UPDATE Claim SET notes = synthetic-private-transcript',
        params: ['Synthetic Patient Example', 'MEMBER-SYNTHETIC-123'],
        cause: { connection: 'postgresql://synthetic:synthetic-password@localhost/db' },
        stack: 'Error: synthetic-private-stack-and-credential',
        extra: { authorization: 'Bearer synthetic-token' },
        level: 'fatal',
      };
      emit(level, event);
      const output = chunks.join('');
      expect(JSON.parse(output)).toEqual({
        level,
        time: expect.any(String),
        service: 'prisma',
        prisma: { target: 'claim.update', timestamp: '2026-10-13T18:00:00.000Z' },
        msg: 'Prisma diagnostic',
      });
      expect(output).not.toMatch(
        /Patient|1990|MEMBER|transcript|password|credential|token|stack|params|query|cause/,
      );
      expect(output).not.toContain('[Redacted]');
    },
  );

  it.each([
    'claim.update Synthetic Patient Example',
    'postgresql://synthetic:synthetic-password@localhost/db',
    'inventedModel.create',
    'claim.inventedOperation',
    'query_engine::diagnostic Synthetic Patient Example',
  ])('does not trust a free-form target: %s', (target) => {
    const { log, chunks } = capture();
    listeners(log)('error', { target, message: 'Synthetic private detail', timestamp: new Date() });
    expect(JSON.parse(chunks.join(''))).toMatchObject({ prisma: { target: 'unknown' } });
    expect(chunks.join('')).not.toContain(target);
  });

  it('never enumerates or serializes diagnostic message/query/params/cause/stack fields', () => {
    const { log, chunks } = capture();
    const readPrivateField = vi.fn(() => {
      throw new Error('Sensitive field must not be read');
    });
    const event = { target: 'callIntent.updateMany', timestamp: new Date('invalid') };
    for (const field of ['message', 'query', 'params', 'cause', 'stack', 'toJSON']) {
      Object.defineProperty(event, field, { get: readPrivateField, enumerable: true });
    }
    listeners(log)('error', event as Prisma.LogEvent);
    expect(readPrivateField).not.toHaveBeenCalled();
    expect(JSON.parse(chunks.join(''))).toMatchObject({
      prisma: { target: 'callIntent.updateMany', timestamp: null },
    });
  });

  it('normalizes the event timestamp without running custom serialization', () => {
    const { log, chunks } = capture();
    const timestamp = new Date('2026-10-13T18:00:00.000Z');
    const toJSON = vi.fn(() => 'Synthetic sensitive timestamp text');
    Object.defineProperties(timestamp, {
      toJSON: { value: toJSON },
      toISOString: { value: toJSON },
    });
    listeners(log)('warn', {
      target: '$executeRaw',
      timestamp,
      message: 'Synthetic private detail',
    });
    expect(toJSON).not.toHaveBeenCalled();
    expect(JSON.parse(chunks.join(''))).toMatchObject({
      prisma: { target: '$executeRaw', timestamp: '2026-10-13T18:00:00.000Z' },
    });
  });

  it('contains an actual local Prisma query failure carrying a synthetic private SQL parameter', async () => {
    const { log, chunks } = capture();
    const database = new PrismaClient({
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'info' },
      ],
    });
    registerPrismaDiagnostics(database, log);
    const syntheticPrivateInput = 'Synthetic Patient Example MEMBER-SYNTHETIC-123';
    try {
      await expect(database.$queryRaw`SELECT ${syntheticPrivateInput}::integer`).rejects.toThrow(
        syntheticPrivateInput,
      );
      const output = chunks.join('');
      const entries = output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(entries).toContainEqual({
        level: 'error',
        time: expect.any(String),
        service: 'prisma',
        prisma: { target: '$queryRaw', timestamp: expect.any(String) },
        msg: 'Prisma diagnostic',
      });
      expect(output).not.toContain(syntheticPrivateInput);
      expect(output).not.toMatch(/SELECT|integer|Invalid|message|queryRaw.*\(/);
    } finally {
      await database.$disconnect();
    }
  });
});

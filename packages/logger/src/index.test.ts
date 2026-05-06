import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from './index.js';

function captureStream(): { stream: Writable; chunks: string[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, chunks };
}

describe('createLogger', () => {
  it('emits structured log lines', () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger({ level: 'info', stream });
    logger.info({ event: 'startup' }, 'service ready');
    const output = chunks.join('');
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.msg).toBe('service ready');
    expect(parsed.event).toBe('startup');
    expect(parsed.service).toBe('dentabill');
  });

  it('redacts PHI field names at the top level', () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger({ level: 'info', stream });
    logger.info(
      {
        patient: {
          patientName: 'John Doe',
          dob: '1990-01-01',
          ssn: '123-45-6789',
          memberId: 'M-001',
          email: 'john@example.com',
          phoneNumber: '+1-555-0100',
        },
      },
      'do not leak',
    );
    const output = chunks.join('');
    expect(output).not.toContain('John Doe');
    expect(output).not.toContain('1990-01-01');
    expect(output).not.toContain('123-45-6789');
    expect(output).not.toContain('M-001');
    expect(output).not.toContain('john@example.com');
    expect(output).not.toContain('+1-555-0100');
    expect(output).toContain('[Redacted]');
  });

  it('redacts auth headers nested under req.headers', () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger({ level: 'info', stream });
    logger.info(
      {
        req: {
          headers: {
            authorization: 'Bearer secret-token-123',
            cookie: 'session=abc123',
          },
        },
      },
      'request',
    );
    const output = chunks.join('');
    expect(output).not.toContain('secret-token-123');
    expect(output).not.toContain('session=abc123');
    expect(output).toContain('[Redacted]');
  });

  it('redacts PHI nested under req.body (Fastify shape)', () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger({ level: 'info', stream });
    logger.info(
      {
        req: {
          body: {
            patientName: 'Jane Roe',
            dob: '1985-07-04',
            ssn: '999-99-9999',
            memberId: 'M-9999',
            email: 'jane@example.com',
            phoneNumber: '+1-555-0199',
            address: '123 Main St',
          },
        },
      },
      'incoming claim',
    );
    const output = chunks.join('');
    expect(output).not.toContain('Jane Roe');
    expect(output).not.toContain('1985-07-04');
    expect(output).not.toContain('999-99-9999');
    expect(output).not.toContain('M-9999');
    expect(output).not.toContain('jane@example.com');
    expect(output).not.toContain('+1-555-0199');
    expect(output).not.toContain('123 Main St');
  });

  it('does not redact non-PHI fields like ids, codes, statuses', () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger({ level: 'info', stream });
    logger.info(
      {
        claim: {
          id: 'clm_abc123',
          claimNumber: 'CL-2026-00042',
          status: 'PENDING',
          payerCode: 'DELTA_DENTAL_PPO',
          cdtCodes: ['D2740', 'D0150'],
          claimAmount: 425.5,
        },
      },
      'claim metadata',
    );
    const output = chunks.join('');
    expect(output).toContain('clm_abc123');
    expect(output).toContain('CL-2026-00042');
    expect(output).toContain('PENDING');
    expect(output).toContain('DELTA_DENTAL_PPO');
    expect(output).toContain('D2740');
    expect(output).toContain('425.5');
  });

  it.each([
    { field: 'dtmf', value: '*123456789#' },
    { field: 'transcriptText', value: 'Patient John Doe DOB 01/01/1990 says ...' },
    { field: 'subscriberId', value: 'SUB-9999-X' },
    { field: 'memberId', value: 'MBR-7777-X' },
    { field: 'ssn', value: '987-65-4321' },
  ])('redacts the Phase-3 voice path field $field (P3-T26)', ({ field, value }) => {
    const { stream, chunks } = captureStream();
    const logger = createLogger({ level: 'info', stream });
    logger.info({ retellEvent: { [field]: value } }, 'voice event');
    const output = chunks.join('');
    expect(output).not.toContain(value);
    expect(output).toContain('[Redacted]');
  });

  // P4-T2I — Phase-4 summarizer-path redaction.
  it.each([
    { field: 'rawTranscript', value: 'Hi this is the agent. Is patient John Doe a member?' },
    { field: 'claudeSummary', value: 'Claim CL-1 paid in full per rep Lisa M.' },
    { field: 'denialReason', value: 'patient John Doe ineligible — out of network' },
    { field: 'repName', value: 'Lisa Martinez (Aetna employee badge 4321)' },
    { field: 'notes', value: 'pt DOB 01/01/1990 mentioned during call' },
  ])('redacts the Phase-4 summarizer field $field', ({ field, value }) => {
    const { stream, chunks } = captureStream();
    const logger = createLogger({ level: 'info', stream });
    logger.info({ summary: { [field]: value } }, 'summary persisted');
    const output = chunks.join('');
    expect(output).not.toContain(value);
    expect(output).toContain('[Redacted]');
  });

  it('respects the level option', () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger({ level: 'warn', stream });
    logger.debug('hidden');
    logger.info('also hidden');
    logger.warn('visible');
    const output = chunks.join('');
    expect(output).not.toContain('hidden');
    expect(output).toContain('visible');
  });
});

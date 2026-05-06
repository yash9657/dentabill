import { describe, expect, it } from 'vitest';

import { FakeClaude } from './fake.js';
import type { SummarizeInput } from './types.js';

const RESOLVED_OUTPUT = {
  claimStatus: 'paid',
  denialReason: null,
  denialCode: null,
  nextAction: 'RESOLVED',
  confidence: 0.97,
  repName: 'Lisa M.',
  referenceNumber: 'REF-1',
  callbackDate: null,
  amountApprovedCents: 24000,
  notes: null,
};

const DENIED_OUTPUT = {
  claimStatus: 'denied',
  denialReason: 'non-covered service',
  denialCode: 'CO-50',
  nextAction: 'APPEAL',
  confidence: 0.91,
  repName: 'Tom K.',
  referenceNumber: 'REF-2',
  callbackDate: '2026-05-20',
  amountApprovedCents: 0,
  notes: null,
};

function inputFor(payerCode: string, agentText: string): SummarizeInput {
  return {
    organizationId: 'org_123',
    callId: 'call_abc',
    payerCode,
    promptVersion: 'v1',
    transcriptTurns: [
      { role: 'agent', text: agentText, timestamp: new Date() },
      { role: 'representative', text: 'Yes I can help.', timestamp: new Date() },
    ],
  };
}

describe('FakeClaude', () => {
  it('returns the per-payer default when no fixture matches', async () => {
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_OUTPUT);
    const result = await fake.summarize(inputFor('DELTA_DENTAL_PPO', 'Hi this is the agent'));
    expect(result.summary.nextAction).toBe('RESOLVED');
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(result.promptVersion).toBe('v1');
    expect(result.model).toBe('fake-claude');
  });

  it('prefers an exact-key fixture over the per-payer default', async () => {
    const fake = new FakeClaude();
    fake.setDefault('CIGNA_DENTAL', RESOLVED_OUTPUT);
    const transcriptKey = 'CIGNA_DENTAL::denial probe';
    fake.setFixture(transcriptKey, DENIED_OUTPUT);

    const result = await fake.summarize(inputFor('CIGNA_DENTAL', 'denial probe'));
    expect(result.summary.nextAction).toBe('APPEAL');
    expect(result.summary.denialCode).toBe('CO-50');
  });

  it('throws when no fixture and no default are registered', async () => {
    const fake = new FakeClaude();
    await expect(fake.summarize(inputFor('METLIFE_DENTAL', 'hello'))).rejects.toThrow(/no fixture/);
  });

  it('records every invocation for spy assertions', async () => {
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', RESOLVED_OUTPUT);
    await fake.summarize(inputFor('DELTA_DENTAL_PPO', 'one'));
    await fake.summarize(inputFor('DELTA_DENTAL_PPO', 'two'));
    expect(fake.invocations).toHaveLength(2);
    expect(fake.invocations[0]?.transcriptTurns[0]?.text).toBe('one');
  });

  it('rejects fixture registration with a hallucinated denial code', () => {
    const fake = new FakeClaude();
    expect(() => {
      fake.setDefault('DELTA_DENTAL_PPO', { ...DENIED_OUTPUT, denialCode: 'CO-9999' });
    }).toThrow(/allow-list/);
  });
});

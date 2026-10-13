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
  denialReason: 'payer determined medical necessity was not established',
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

  it('preserves an unfamiliar fixture code for the worker to review', async () => {
    const fake = new FakeClaude();
    fake.setDefault('DELTA_DENTAL_PPO', { ...DENIED_OUTPUT, denialCode: 'CO-9999' });
    const result = await fake.summarize(inputFor('DELTA_DENTAL_PPO', 'unfamiliar code'));
    expect(result.summary.denialCode).toBe('CO-9999');
  });

  it('rejects an oversized fixture code without truncating it', () => {
    const fake = new FakeClaude();
    expect(() => {
      fake.setDefault('DELTA_DENTAL_PPO', { ...DENIED_OUTPUT, denialCode: 'X'.repeat(65) });
    }).toThrow(/64 characters/);
  });
});

describe('FakeClaude — demo derivation fallback', () => {
  const baseInput = {
    organizationId: 'org_1',
    callId: 'call_1',
    payerCode: 'CIGNA_DENTAL',
    promptVersion: 'v1',
  };

  function withTurns(texts: readonly string[]) {
    return {
      ...baseInput,
      transcriptTurns: texts.map((text, i) => ({
        role: i % 2 === 0 ? ('agent' as const) : ('representative' as const),
        text,
        timestamp: new Date(Date.UTC(2026, 7, 22, 12, 0, i)),
      })),
    };
  }

  // The default must keep throwing: for tests, a missing fixture is a bug and
  // a silent default would hide it.
  it('still throws when derivation is not enabled', async () => {
    const fake = new FakeClaude();
    await expect(
      fake.summarize(withTurns(['Hello', 'The claim is approved for $345.'])),
    ).rejects.toThrow(/no fixture registered/);
  });

  it('derives an approved summary with the amount and reference from the transcript', async () => {
    const fake = new FakeClaude({ deriveWhenUnregistered: true });
    const result = await fake.summarize(
      withTurns([
        'Hello, this is DentaBill calling on behalf of Bright Smile Dental.',
        'Good news — the claim is approved. The approved amount is $345 and your reference number is REF-8821.',
      ]),
    );
    expect(result.summary.claimStatus).toBe('paid');
    expect(result.summary.nextAction).toBe('RESOLVED');
    expect(result.summary.amountApprovedCents).toBe(34_500);
    expect(result.summary.referenceNumber).toBe('REF-8821');
    expect(result.summary.denialCode).toBeNull();
    expect(result.model).toBe('fake-claude');
  });

  it('derives a denial, including the code, and never reports an approved amount', async () => {
    const fake = new FakeClaude({ deriveWhenUnregistered: true });
    const result = await fake.summarize(
      withTurns([
        'Calling about claim DEMO-004.',
        'That claim was denied — code CO-50, medical necessity was not established. The amount billed was $420.',
      ]),
    );
    expect(result.summary.claimStatus).toBe('denied');
    expect(result.summary.nextAction).toBe('APPEAL');
    expect(result.summary.denialCode).toBe('CO-50');
    // A denial must not carry an approved amount even though the transcript
    // mentions a dollar figure.
    expect(result.summary.amountApprovedCents).toBeNull();
  });

  it('falls back to pending when the transcript resolves nothing', async () => {
    const fake = new FakeClaude({ deriveWhenUnregistered: true });
    const result = await fake.summarize(
      withTurns(['Are you still there?', 'Let me transfer you to another department.']),
    );
    expect(result.summary.claimStatus).toBe('pending');
    expect(result.summary.nextAction).toBe('CALL_BACK');
    expect(result.summary.confidence).toBeLessThan(0.8);
  });

  it('prefers a registered fixture over derivation', async () => {
    const fake = new FakeClaude({ deriveWhenUnregistered: true });
    fake.setDefault('CIGNA_DENTAL', {
      claimStatus: 'in_review',
      denialReason: null,
      denialCode: '',
      nextAction: 'MANUAL_REVIEW',
      confidence: 0.5,
      repName: null,
      referenceNumber: null,
      callbackDate: null,
      amountApprovedCents: null,
      notes: null,
    });
    const result = await fake.summarize(withTurns(['Hi', 'The claim is approved for $345.']));
    expect(result.summary.claimStatus).toBe('in_review');
  });

  it('is deterministic — the same transcript yields the same summary', async () => {
    const fake = new FakeClaude({ deriveWhenUnregistered: true });
    const turns = withTurns(['this is Janet', 'Approved for $1,250.00, reference REF-99.']);
    const a = await fake.summarize(turns);
    const b = await fake.summarize(turns);
    expect(a.summary).toEqual(b.summary);
    expect(a.summary.amountApprovedCents).toBe(125_000);
  });
});

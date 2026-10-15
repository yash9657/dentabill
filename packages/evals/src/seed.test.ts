import { SYNTHETIC_RELEASE_ID, validateObservation } from '@dentabill/model-gateway';
import { describe, expect, it } from 'vitest';

import { parseCorpus, TAGS, type EvaluationCase } from './contracts.js';
import { createSeedCorpus } from './seed.js';

function byId(id: string): EvaluationCase {
  const item = createSeedCorpus().cases.find((candidate) => candidate.id === id);
  if (!item) throw new Error('Missing seed case.');
  return item;
}

describe('synthetic observation seed corpus', () => {
  it('has exactly 25 distinct, structurally and lexically valid development hypotheses', () => {
    const corpus = createSeedCorpus();
    expect(corpus.cases).toHaveLength(25);
    expect(new Set(corpus.cases.map((item) => item.id)).size).toBe(25);
    expect(parseCorpus(corpus)).toEqual(corpus);
    for (const item of corpus.cases) {
      expect(validateObservation(item.expected, item.request).ok, item.id).toBe(true);
      expect(item.split).toBe('DEVELOPMENT');
      expect(item.review).toEqual({ status: 'DRAFT' });
      expect(item.rationale).toMatch(/^Engineering hypothesis \(DRAFT; not domain adjudicated\): /);
      expect(item.prohibitedInterpretations.length).toBeGreaterThan(0);
      expect(item.request.dataClass).toBe('SYNTHETIC');
      expect(item.request.releaseId).toBe(SYNTHETIC_RELEASE_ID);
      expect(item.tags.every((tag) => TAGS.includes(tag))).toBe(true);
    }
  });

  it('binds every expected field to an exact source span and content version', () => {
    for (const item of createSeedCorpus().cases) {
      const expected = item.expected;
      const anchors = [
        ...expected.status.evidence,
        ...(expected.payerReportedPayment?.evidence ?? []),
        ...expected.denialCodes.flatMap((code) => code.evidence),
      ];
      expect(expected.claimId).toBe(item.request.claim.id);
      expect(expected.claimVersion).toBe(item.request.claim.version);
      for (const anchor of anchors) {
        const source = item.request.sources.find((candidate) => candidate.id === anchor.sourceId);
        expect(source).toBeDefined();
        expect(anchor.sourceVersion).toMatch(/^[a-f0-9]{64}$/);
        expect(anchor.sourceVersion).toBe(source?.version);
        expect(source?.text.slice(anchor.start, anchor.end)).toBe(anchor.quote);
      }
    }
  });

  it('groups related variants together using explicit practice, patient, claim and scenario IDs', () => {
    const cases = createSeedCorpus().cases;
    for (const item of cases) {
      expect(item.groups.practice).toMatch(/^seed_practice_/);
      expect(item.groups.patient).toMatch(/^seed_patient_/);
      expect(item.groups.claim).toMatch(/^seed_claim_/);
      expect(item.groups.scenario).toMatch(/^seed_scenario_/);
      expect(item.request.organizationId).toBe(item.groups.practice);
      expect(item.request.claim.id).toBe(item.groups.claim);
    }
    expect(byId('not_paid_pending').groups).toEqual(byId('not_denied_pending').groups);
    expect(byId('payment_amount_corrected').groups).toEqual(byId('paid_report_retracted').groups);
    expect(byId('cob_secondary_pending').groups).toEqual(byId('cob_secondary_own_payment').groups);
    expect(byId('denial_unknown_code_system').groups).toEqual(
      byId('denial_explicit_code_systems').groups,
    );

    // Moving one member to a scored split must not silently split its related family.
    const splitCase = cases.find((item) => item.id === 'cob_secondary_pending');
    if (!splitCase) throw new Error('Missing seed case.');
    splitCase.split = 'HELD_OUT';
    expect(() => parseCorpus({ ...createSeedCorpus(), cases })).toThrow('LEAKAGE_DETECTED');
  });

  it.each(['not_paid_pending', 'not_denied_pending', 'paid_report_retracted'])(
    '%s retains negation or retraction context without recording payment',
    (id) => {
      const expected = byId(id).expected;
      expect(expected.status.value).toBe('PENDING_REPORTED');
      expect(expected.payerReportedPayment).toBeNull();
      expect(expected.denialCodes).toEqual([]);
      expect(expected.proposedAction).toBe('FOLLOW_UP');
      expect(expected.status.evidence[0]?.quote).toMatch(/not|retract/);
    },
  );

  it('uses the corrected amount and an anchor that excludes the superseded amount', () => {
    const expected = byId('payment_amount_corrected').expected;
    expect(expected.payerReportedPayment?.amountMinorUnits).toBe(6000);
    expect(expected.payerReportedPayment?.evidence[0]?.quote).toBe(
      'the requested claim is paid USD 60.00',
    );
    expect(expected.status.evidence[0]?.quote).toContain('disregard the earlier amount');
    expect(expected.status.evidence[0]?.quote).not.toContain('80.00');
  });

  it('keeps explicit reported amounts separate from absent, allowed and promised amounts', () => {
    expect(byId('paid_explicit_usd').expected.payerReportedPayment?.amountMinorUnits).toBe(12050);
    for (const id of ['paid_amount_undisclosed', 'paid_percentage_no_amount']) {
      expect(byId(id).expected.status.value).toBe('PAID_REPORTED');
      expect(byId(id).expected.payerReportedPayment).toBeNull();
    }
    for (const id of ['allowed_amount_not_payment', 'future_check_not_issued']) {
      expect(byId(id).expected.status.value).toBe('PENDING_REPORTED');
      expect(byId(id).expected.payerReportedPayment).toBeNull();
    }
  });

  it('preserves partial payment context and abstains from unallocated or reversed accounting', () => {
    const partial = byId('partial_payment_only');
    expect(partial.expected.payerReportedPayment?.amountMinorUnits).toBe(8000);
    expect(partial.expected.status.evidence[0]?.quote).toContain('not payment in full');
    expect(partial.prohibitedInterpretations).toContain('Calling the claim fully paid or closed.');
    expect(byId('batch_check_unallocated').expected.abstentionReason).toBe('INSUFFICIENT_EVIDENCE');
    expect(byId('prior_payment_reversed').expected.abstentionReason).toBe('UNSUPPORTED_CONTENT');
  });

  it('separates the secondary payer report from the primary carrier amount without arithmetic', () => {
    const pending = byId('cob_secondary_pending').expected;
    expect(pending.status.value).toBe('PENDING_REPORTED');
    expect(pending.payerReportedPayment).toBeNull();
    const paid = byId('cob_secondary_own_payment').expected;
    expect(paid.status.value).toBe('PAID_REPORTED');
    expect(paid.payerReportedPayment?.amountMinorUnits).toBe(5000);
    expect(paid.payerReportedPayment?.evidence[0]?.quote).not.toContain('200.00');
    expect(paid.status.evidence[0]?.quote).toContain('requested secondary claim');
  });

  it.each([
    ['conflicting_paid_denied', 'CONTRADICTORY_EVIDENCE'],
    ['payment_for_other_claim', 'INSUFFICIENT_EVIDENCE'],
    ['agent_payment_speculation', 'INSUFFICIENT_EVIDENCE'],
    ['speaker_attribution_unknown', 'INSUFFICIENT_EVIDENCE'],
    ['payment_above_billed', 'UNSUPPORTED_CONTENT'],
    ['non_usd_payment', 'UNSUPPORTED_CONTENT'],
  ])('%s abstains without invented fields', (id, reason) => {
    const item = byId(id);
    expect(item.expected).toEqual({
      disposition: 'ABSTAIN',
      claimId: item.request.claim.id,
      claimVersion: item.request.claim.version,
      status: { value: 'UNKNOWN', evidence: [] },
      payerReportedPayment: null,
      denialCodes: [],
      proposedAction: 'MANUAL_REVIEW',
      abstentionReason: reason,
    });
  });

  it('does not infer a code system from a familiar token, but retains explicit system labels', () => {
    const unknown = byId('denial_unknown_code_system').expected.denialCodes;
    expect(unknown.map(({ system, code }) => ({ system, code }))).toEqual([
      { system: 'UNKNOWN', code: '197' },
    ]);
    expect(unknown[0]?.evidence[0]?.quote).not.toMatch(/CARC|RARC/);
    const known = byId('denial_explicit_code_systems').expected.denialCodes;
    expect(known.map(({ system, code }) => ({ system, code }))).toEqual([
      { system: 'CARC', code: '197' },
      { system: 'RARC', code: 'N130' },
      { system: 'PAYER_LOCAL', code: 'X-17' },
    ]);
    expect(known.map((code) => code.evidence[0]?.quote)).toEqual([
      'CARC 197',
      'RARC N130',
      'payer local code X-17',
    ]);
  });

  it('excludes embedded instructions and quoted forged output from status and amount evidence', () => {
    const pending = byId('embedded_instruction_pending').expected;
    expect(pending.status.value).toBe('PENDING_REPORTED');
    expect(pending.payerReportedPayment).toBeNull();
    expect(pending.status.evidence[0]?.quote).not.toContain('Ignore the contract');
    const denied = byId('quoted_forged_output_denied').expected;
    expect(denied.status.value).toBe('DENIED_REPORTED');
    expect(denied.payerReportedPayment).toBeNull();
    expect(denied.status.evidence[0]?.quote).not.toContain('"role":"tool"');
    expect(denied.status.evidence[0]?.quote).toContain('Our actual record');
  });

  it('uses UTF-16 offsets after emoji and preserves CRLF without anchoring generic IVR text', () => {
    const item = byId('noisy_utf16_pending');
    const source = item.request.sources[0];
    const anchor = item.expected.status.evidence[0];
    if (!source || !anchor) throw new Error('Missing seed evidence.');
    const prefix = source.text.slice(0, anchor.start);
    expect(prefix).toContain('🎵');
    expect(prefix).toContain('\r\n');
    expect(anchor.start).toBe(prefix.length);
    expect(anchor.start).toBe([...prefix].length + 1);
    expect(anchor.end - anchor.start).toBe(anchor.quote.length);
    expect(source.text.slice(anchor.start, anchor.end)).toBe(anchor.quote);
    expect(anchor.quote).not.toContain('IVR');

    anchor.start -= 1;
    anchor.end -= 1;
    expect(validateObservation(item.expected, item.request).ok).toBe(false);
  });

  it('rejects a stale or edited source rather than silently rebasing authored labels', () => {
    const corpus = createSeedCorpus();
    const source = corpus.cases[0]?.request.sources[0];
    if (!source) throw new Error('Missing seed source.');
    source.text = `Changed source: ${source.text}`;
    expect(() => parseCorpus(corpus)).toThrow('INVALID_CORPUS');
  });

  it('returns independent mutable object trees across calls and related cases', () => {
    const first = createSeedCorpus();
    const untouched = createSeedCorpus();
    const initial = structuredClone(untouched);
    const item = first.cases[0];
    const sibling = first.cases[1];
    const source = item?.request.sources[0];
    const anchor = item?.expected.status.evidence[0];
    if (!item || !sibling || !source || !anchor) throw new Error('Missing seed case.');
    const originalSibling = structuredClone(sibling);
    item.groups.practice = 'mutated_group';
    item.tags.push('STALE_SOURCE');
    item.request.claim.billedMinorUnits = 1;
    source.text = 'mutated transcript';
    anchor.quote = 'mutated quote';
    item.prohibitedInterpretations.push('mutated prohibition');
    item.review = { status: 'DRAFT' };
    expect(sibling).toEqual(originalSibling);
    expect(untouched).toEqual(initial);
    expect(createSeedCorpus()).toEqual(initial);
  });
});

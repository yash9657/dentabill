import { describe, expect, it } from 'vitest';

import { applyTransitionPolicy } from './handler.js';

const BASELINE = {
  autoTransitionEnabled: true,
  confidence: 0.97,
  currentStatus: 'COMPLETED',
} as const;

describe('applyTransitionPolicy', () => {
  it('forces MANUAL_REVIEW when the kill-switch is OFF, regardless of confidence', () => {
    const result = applyTransitionPolicy({
      ...BASELINE,
      autoTransitionEnabled: false,
      nextAction: 'RESOLVED',
    });
    expect(result.autoTransitioned).toBe(false);
    expect(result.targetStatus).toBe('MANUAL_REVIEW');
  });

  it('forces MANUAL_REVIEW when confidence < 0.95', () => {
    const result = applyTransitionPolicy({
      ...BASELINE,
      confidence: 0.94999,
      nextAction: 'RESOLVED',
    });
    expect(result.autoTransitioned).toBe(false);
    expect(result.targetStatus).toBe('MANUAL_REVIEW');
  });

  it('auto-transitions Claim → RESOLVED on RESOLVED + high confidence', () => {
    const result = applyTransitionPolicy({ ...BASELINE, nextAction: 'RESOLVED' });
    expect(result.autoTransitioned).toBe(true);
    expect(result.targetStatus).toBe('RESOLVED');
  });

  it('auto-transitions Claim → NEEDS_INFO on SUBMIT_DOCS + high confidence', () => {
    const result = applyTransitionPolicy({ ...BASELINE, nextAction: 'SUBMIT_DOCS' });
    expect(result.autoTransitioned).toBe(true);
    expect(result.targetStatus).toBe('NEEDS_INFO');
  });

  it('routes APPEAL → MANUAL_REVIEW (auto-DENY is never automatic in Phase 4)', () => {
    const result = applyTransitionPolicy({ ...BASELINE, nextAction: 'APPEAL' });
    expect(result.autoTransitioned).toBe(false);
    expect(result.targetStatus).toBe('MANUAL_REVIEW');
  });

  it('routes WRITE_OFF → MANUAL_REVIEW (financially-significant; never auto)', () => {
    const result = applyTransitionPolicy({ ...BASELINE, nextAction: 'WRITE_OFF' });
    expect(result.autoTransitioned).toBe(false);
    expect(result.targetStatus).toBe('MANUAL_REVIEW');
  });

  it('routes RESUBMIT → MANUAL_REVIEW (operator decides whether to refile)', () => {
    const result = applyTransitionPolicy({ ...BASELINE, nextAction: 'RESUBMIT' });
    expect(result.autoTransitioned).toBe(false);
    expect(result.targetStatus).toBe('MANUAL_REVIEW');
  });

  it('routes MANUAL_REVIEW → MANUAL_REVIEW (LLM explicitly punted)', () => {
    const result = applyTransitionPolicy({ ...BASELINE, nextAction: 'MANUAL_REVIEW' });
    expect(result.autoTransitioned).toBe(false);
    expect(result.targetStatus).toBe('MANUAL_REVIEW');
  });
});

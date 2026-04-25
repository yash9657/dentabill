import { describe, expect, it } from 'vitest';

import {
  CALL_STATUS_VALUES,
  CLAIM_STATUS_VALUES,
  NEXT_ACTION_VALUES,
  PAYER_CODE_VALUES,
  PLAN_VALUES,
  USER_ROLE_VALUES,
} from './enums.js';

describe('enum values mirror PRD §5', () => {
  it('Plan values match', () => {
    expect(PLAN_VALUES).toEqual(['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE']);
  });

  it('UserRole values match', () => {
    expect(USER_ROLE_VALUES).toEqual(['OWNER', 'ADMIN', 'BILLING_STAFF']);
  });

  it('ClaimStatus has 11 values including the failure modes', () => {
    expect(CLAIM_STATUS_VALUES).toHaveLength(11);
    expect(CLAIM_STATUS_VALUES).toContain('FAILED');
    expect(CLAIM_STATUS_VALUES).toContain('MANUAL_REVIEW');
  });

  it('CallStatus has 8 values including VOICEMAIL', () => {
    expect(CALL_STATUS_VALUES).toHaveLength(8);
    expect(CALL_STATUS_VALUES).toContain('VOICEMAIL');
  });

  it('PayerCode includes the 3 Phase-1 payers and UNKNOWN sentinel', () => {
    expect(PAYER_CODE_VALUES).toContain('DELTA_DENTAL_PPO');
    expect(PAYER_CODE_VALUES).toContain('CIGNA_DENTAL');
    expect(PAYER_CODE_VALUES).toContain('METLIFE_DENTAL');
    expect(PAYER_CODE_VALUES).toContain('UNKNOWN');
  });

  it('NextAction has 7 values', () => {
    expect(NEXT_ACTION_VALUES).toHaveLength(7);
  });
});

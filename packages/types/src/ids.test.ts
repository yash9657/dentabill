import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  asCallId,
  asClaimId,
  asOrgId,
  asUserId,
  type CallId,
  type ClaimId,
  type OrgId,
  type UserId,
} from './ids.js';

describe('branded id helpers', () => {
  it('returns the raw string at runtime', () => {
    expect(asOrgId('org_123')).toBe('org_123');
    expect(asUserId('user_abc')).toBe('user_abc');
    expect(asClaimId('clm_xyz')).toBe('clm_xyz');
    expect(asCallId('call_42')).toBe('call_42');
  });

  it('produces nominally distinct types at compile time', () => {
    const orgId = asOrgId('org_1');
    const userId = asUserId('user_1');
    expectTypeOf(orgId).toEqualTypeOf<OrgId>();
    expectTypeOf(userId).toEqualTypeOf<UserId>();
    // @ts-expect-error — OrgId is not assignable to UserId
    const _bad: UserId = orgId;
    expect(orgId).toBeDefined();
    expect(_bad).toBeDefined();
  });

  it('does not collapse different brand types to a common type', () => {
    const claimId: ClaimId = asClaimId('clm_1');
    const callId: CallId = asCallId('call_1');
    expectTypeOf(claimId).not.toEqualTypeOf<CallId>();
    expectTypeOf(callId).not.toEqualTypeOf<ClaimId>();
  });
});

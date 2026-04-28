import { describe, expect, it } from 'vitest';

import {
  CALL_STATUS_OPTIONS,
  callStatusIndicatorVariant,
  callStatusLabel,
  isLiveCallStatus,
  type CallStatus,
} from './types.js';

describe('call types helpers (P3-T24)', () => {
  it('callStatusLabel maps every status to a non-empty label', () => {
    for (const status of CALL_STATUS_OPTIONS) {
      expect(callStatusLabel(status).length).toBeGreaterThan(0);
    }
  });

  it.each<{ readonly status: CallStatus; readonly live: boolean }>([
    { status: 'INITIATED', live: true },
    { status: 'NAVIGATING_IVR', live: true },
    { status: 'ON_HOLD', live: true },
    { status: 'HUMAN_REACHED', live: true },
    { status: 'COLLECTING', live: true },
    { status: 'COMPLETED', live: false },
    { status: 'FAILED', live: false },
    { status: 'VOICEMAIL', live: false },
  ])('isLiveCallStatus($status) === $live', ({ status, live }) => {
    expect(isLiveCallStatus(status)).toBe(live);
  });

  it.each<{ readonly status: CallStatus; readonly variant: string }>([
    { status: 'INITIATED', variant: 'active' },
    { status: 'NAVIGATING_IVR', variant: 'active' },
    { status: 'ON_HOLD', variant: 'active' },
    { status: 'HUMAN_REACHED', variant: 'active' },
    { status: 'COLLECTING', variant: 'active' },
    { status: 'COMPLETED', variant: 'success' },
    { status: 'FAILED', variant: 'error' },
    { status: 'VOICEMAIL', variant: 'warning' },
  ])('callStatusIndicatorVariant($status) === $variant', ({ status, variant }) => {
    expect(callStatusIndicatorVariant(status)).toBe(variant);
  });
});

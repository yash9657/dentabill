import { describe, expect, it } from 'vitest';

import { CLAIM_STATUS_OPTIONS, statusIndicatorVariant, type ClaimStatus } from './types.js';

describe('statusIndicatorVariant (P3-T23)', () => {
  it('maps every ClaimStatus exhaustively (catches drift if a status is added)', () => {
    for (const status of CLAIM_STATUS_OPTIONS) {
      const variant = statusIndicatorVariant(status);
      expect(typeof variant).toBe('string');
    }
  });

  it.each<{ readonly status: ClaimStatus; readonly variant: string }>([
    // Live → muted-teal pulse (the only chromatic surface in the system).
    { status: 'IN_QUEUE', variant: 'active' },
    { status: 'CALLING', variant: 'active' },
    // Pending baseline.
    { status: 'PENDING', variant: 'pending' },
    // Terminal-positive.
    { status: 'COMPLETED', variant: 'success' },
    { status: 'RESOLVED', variant: 'success' },
    { status: 'WRITTEN_OFF', variant: 'success' },
    // Needs-attention (not failing).
    { status: 'NEEDS_INFO', variant: 'warning' },
    { status: 'APPEALING', variant: 'warning' },
    { status: 'MANUAL_REVIEW', variant: 'warning' },
    // Terminal-negative.
    { status: 'DENIED', variant: 'error' },
    { status: 'FAILED', variant: 'error' },
  ])('maps $status → $variant', ({ status, variant }) => {
    expect(statusIndicatorVariant(status)).toBe(variant);
  });
});

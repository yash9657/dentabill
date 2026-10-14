import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ReviewNotificationPayloadSchema,
  ReviewNotificationTransportError,
  SyntheticReviewNotificationTransport,
  reviewNotificationPayloadHash,
  validateReviewNotificationSubmission,
  type ReviewNotificationPayload,
  type ReviewNotificationSubmission,
} from './review-notification.js';

function submission(to = 'synthetic@example.test'): ReviewNotificationSubmission {
  const payload: ReviewNotificationPayload = {
    to,
    templateVersion: 'review-available.v1',
    subject: 'Review available in DentaBill',
    text: 'A review is available. Sign in to DentaBill and open Claims to review it.',
    appPath: '/dashboard/claims',
  };
  return {
    idempotencyKey: randomUUID(),
    payload,
    payloadHash: reviewNotificationPayloadHash(payload),
  };
}

describe('fixed generic review notification contract', () => {
  it('deduplicates identical requests and distinguishes simulation from delivery', async () => {
    const transport = new SyntheticReviewNotificationTransport();
    const input = submission();
    const signal = new AbortController().signal;
    const receipts = await Promise.all([
      transport.submit(input, signal),
      transport.submit(input, signal),
    ]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect(receipts[0]).toMatchObject({ kind: 'SIMULATED' });
    expect(receipts[0]).not.toHaveProperty('deliveredAt');
    expect(transport.acceptanceCount).toBe(1);
  });

  it('rejects a different recipient with the same permanent key', async () => {
    const transport = new SyntheticReviewNotificationTransport();
    const input = submission();
    const signal = new AbortController().signal;
    await transport.submit(input, signal);
    await expect(
      transport.submit(
        { ...submission('other@example.test'), idempotencyKey: input.idempotencyKey },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(transport.acceptanceCount).toBe(1);
  });

  it('models expiration rather than claiming permanent provider deduplication', async () => {
    let time = new Date('2026-10-14T00:00:00Z');
    const transport = new SyntheticReviewNotificationTransport({ clock: (): Date => time });
    const input = submission();
    const signal = new AbortController().signal;
    const first = await transport.submit(input, signal);
    time = new Date('2026-10-15T00:00:00Z');
    const later = await transport.submit(input, signal);
    expect(later.receiptId).not.toBe(first.receiptId);
    expect(transport.acceptanceCount).toBe(2);
  });

  it.each(['claimNumber', 'payerCode', 'serviceDate', 'notes', 'sourceHash'])(
    'rejects the unexpected source field %s',
    (field) => {
      expect(
        ReviewNotificationPayloadSchema.safeParse({
          ...submission().payload,
          [field]: 'SYNTHETIC-PRIVATE-MARKER',
        }).success,
      ).toBe(false);
    },
  );

  it.each(['subject', 'text', 'appPath', 'templateVersion'])(
    'rejects source-derived or unapproved %s content',
    (field) => {
      expect(
        ReviewNotificationPayloadSchema.safeParse({
          ...submission().payload,
          [field]: 'SYNTHETIC-PRIVATE-MARKER',
        }).success,
      ).toBe(false);
    },
  );

  it('fails closed on invalid recipients, hashes and idempotency keys without echoing input', () => {
    const input = submission();
    for (const candidate of [
      { ...input, payload: { ...input.payload, to: 'PRIVATE-MARKER' } },
      { ...input, payloadHash: '0'.repeat(64) },
      { ...input, idempotencyKey: 'PRIVATE-MARKER\ninvalid' },
    ]) {
      try {
        validateReviewNotificationSubmission(candidate);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ReviewNotificationTransportError);
        expect(String(error)).not.toContain('PRIVATE-MARKER');
      }
    }
  });

  it('does not accept an already cancelled request', async () => {
    const transport = new SyntheticReviewNotificationTransport();
    const controller = new AbortController();
    controller.abort();
    await expect(transport.submit(submission(), controller.signal)).rejects.toMatchObject({
      code: 'UNKNOWN',
    });
    expect(transport.acceptanceCount).toBe(0);
  });
});

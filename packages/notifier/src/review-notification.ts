import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

export const ReviewNotificationPayloadSchema = z
  .object({
    to: z.string().email().max(254),
    templateVersion: z.literal('review-available.v1'),
    subject: z.literal('Review available in DentaBill'),
    text: z.literal('A review is available. Sign in to DentaBill and open Claims to review it.'),
    appPath: z.literal('/dashboard/claims'),
  })
  .strict();

export type ReviewNotificationPayload = z.infer<typeof ReviewNotificationPayloadSchema>;

export interface ReviewNotificationSubmission {
  readonly idempotencyKey: string;
  readonly payload: ReviewNotificationPayload;
  readonly payloadHash: string;
}

export interface ReviewNotificationReceipt {
  readonly kind: 'SIMULATED';
  readonly receiptId: string;
  readonly acceptedAt: string;
}

/** No production runtime constructs this transport or enables external delivery. */
export interface ReviewNotificationTransport {
  readonly kind: 'SYNTHETIC';
  submit(
    input: ReviewNotificationSubmission,
    signal: AbortSignal,
  ): Promise<ReviewNotificationReceipt>;
}

export class ReviewNotificationTransportError extends Error {
  public constructor(
    public readonly code: 'RETRYABLE' | 'UNKNOWN' | 'CONFLICT' | 'REJECTED',
    public readonly retryAfterMs?: number,
  ) {
    super('REVIEW_NOTIFICATION_TRANSPORT_FAILED');
    this.name = 'ReviewNotificationTransportError';
  }
}

export function reviewNotificationPayloadHash(payload: ReviewNotificationPayload): string {
  const parsed = ReviewNotificationPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new ReviewNotificationTransportError('REJECTED');
  return createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex');
}

export function validateReviewNotificationSubmission(
  input: ReviewNotificationSubmission,
): ReviewNotificationSubmission {
  if (
    !/^[a-zA-Z0-9._:-]{1,256}$/.test(input.idempotencyKey) ||
    !/^[a-f0-9]{64}$/.test(input.payloadHash) ||
    reviewNotificationPayloadHash(input.payload) !== input.payloadHash
  )
    throw new ReviewNotificationTransportError('CONFLICT');
  return {
    idempotencyKey: input.idempotencyKey,
    payload: ReviewNotificationPayloadSchema.parse(input.payload),
    payloadHash: input.payloadHash,
  };
}

interface SimulatedAcceptance {
  readonly input: ReviewNotificationSubmission;
  readonly receipt: ReviewNotificationReceipt;
  readonly expiresAt: number;
}

/** Models a finite deduplication window; it never sends email or makes network requests. */
export class SyntheticReviewNotificationTransport implements ReviewNotificationTransport {
  public readonly kind = 'SYNTHETIC';
  readonly #accepted = new Map<string, SimulatedAcceptance>();
  readonly #clock: () => Date;
  #acceptanceCount = 0;

  public constructor(options: { readonly clock?: () => Date } = {}) {
    this.#clock = options.clock ?? ((): Date => new Date());
  }

  public get acceptanceCount(): number {
    return this.#acceptanceCount;
  }

  public async submit(
    input: ReviewNotificationSubmission,
    signal: AbortSignal,
  ): Promise<ReviewNotificationReceipt> {
    if (signal.aborted) throw new ReviewNotificationTransportError('UNKNOWN');
    const validated = validateReviewNotificationSubmission(input);
    const time = this.#clock();
    const existing = this.#accepted.get(validated.idempotencyKey);
    if (existing && existing.expiresAt > time.getTime()) {
      if (existing.input.payloadHash !== validated.payloadHash)
        throw new ReviewNotificationTransportError('CONFLICT');
      return Promise.resolve({ ...existing.receipt });
    }
    const receipt: ReviewNotificationReceipt = {
      kind: 'SIMULATED',
      receiptId: `simulated-${randomUUID()}`,
      acceptedAt: time.toISOString(),
    };
    this.#accepted.set(validated.idempotencyKey, {
      input: validated,
      receipt,
      expiresAt: time.getTime() + 24 * 60 * 60 * 1000,
    });
    this.#acceptanceCount += 1;
    return Promise.resolve({ ...receipt });
  }
}

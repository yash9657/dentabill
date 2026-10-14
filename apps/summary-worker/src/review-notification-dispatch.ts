import {
  beginReviewNotificationAttempt,
  completeReviewNotificationAttempt,
  type prisma,
} from '@dentabill/db';
import {
  ReviewNotificationPayloadSchema,
  ReviewNotificationTransportError,
  validateReviewNotificationSubmission,
  type ReviewNotificationReceipt,
  type ReviewNotificationTransport,
} from '@dentabill/notifier';
import { z } from 'zod';

const ReceiptSchema = z
  .object({
    kind: z.literal('SIMULATED'),
    receiptId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9._:-]+$/),
    acceptedAt: z.string().datetime(),
  })
  .strict();

export interface ReviewNotificationDispatchOptions {
  readonly prisma: typeof prisma;
  readonly organizationId: string;
  readonly notificationId: string;
  readonly transport?: ReviewNotificationTransport;
  readonly signal?: AbortSignal;
  readonly clock?: () => Date;
  readonly timeoutMs?: number;
}

export type ReviewNotificationDispatchResult =
  | { readonly kind: 'DISABLED' | 'CANCELLED' }
  | { readonly kind: 'SKIPPED'; readonly state: string | null; readonly reason: string | null }
  | { readonly kind: 'RECORDED' | 'EXISTING' | 'STALE'; readonly state: string };

/** Durable dispatch is opt-in and synthetic-only. Default calls cannot submit a message. */
export async function dispatchReviewNotification(
  options: ReviewNotificationDispatchOptions,
): Promise<ReviewNotificationDispatchResult> {
  if (options.transport?.kind !== 'SYNTHETIC') return { kind: 'DISABLED' };
  if (options.signal?.aborted) return { kind: 'CANCELLED' };
  const clock = options.clock ?? ((): Date => new Date());
  const ownership = await beginReviewNotificationAttempt(options.prisma, {
    organizationId: options.organizationId,
    notificationId: options.notificationId,
    now: clock(),
  }).catch(() => {
    throw new Error('REVIEW_NOTIFICATION_STATE_UNAVAILABLE');
  });
  if (ownership.kind !== 'OWNED')
    return { kind: 'SKIPPED', state: ownership.state ?? null, reason: ownership.reason ?? null };
  const identity = {
    organizationId: options.organizationId,
    notificationId: options.notificationId,
    attemptId: ownership.attemptId,
    leaseToken: ownership.leaseToken,
  };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let completion: Parameters<typeof completeReviewNotificationAttempt>[1];
  try {
    const parsedPayload = ReviewNotificationPayloadSchema.safeParse(ownership.payload);
    if (!parsedPayload.success) throw new ReviewNotificationTransportError('REJECTED');
    const input = validateReviewNotificationSubmission({
      idempotencyKey: ownership.deliveryKey,
      payload: parsedPayload.data,
      payloadHash: ownership.payloadHash,
    });
    const remaining = Math.min(
      ownership.retryDeadlineAt.getTime() - clock().getTime(),
      ownership.leaseExpiresAt.getTime() - clock().getTime(),
    );
    if (remaining <= 0 || options.signal?.aborted)
      throw new ReviewNotificationTransportError('UNKNOWN');
    const timeoutMs = options.timeoutMs ?? 25_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 25_000)
      throw new ReviewNotificationTransportError('REJECTED');
    const timeout = new Promise<never>((_resolve, reject) => {
      abort = (): void => {
        controller.abort();
        reject(new ReviewNotificationTransportError('UNKNOWN'));
      };
      timer = setTimeout(abort, Math.min(timeoutMs, remaining));
      options.signal?.addEventListener('abort', abort, { once: true });
    });
    const response: ReviewNotificationReceipt = await Promise.race([
      options.transport.submit(input, controller.signal),
      timeout,
    ]);
    const receipt = ReceiptSchema.safeParse(response);
    if (!receipt.success) throw new ReviewNotificationTransportError('UNKNOWN');
    completion = {
      ...identity,
      outcome: 'SIMULATED',
      providerReceiptId: receipt.data.receiptId,
      acceptedAt: new Date(receipt.data.acceptedAt),
      now: clock(),
    };
  } catch (error) {
    const code = error instanceof ReviewNotificationTransportError ? error.code : 'UNKNOWN';
    const outcome =
      code === 'RETRYABLE'
        ? 'RETRYABLE'
        : code === 'CONFLICT' || code === 'REJECTED'
          ? 'CONFLICT'
          : 'UNKNOWN';
    const reason =
      code === 'RETRYABLE'
        ? 'TRANSPORT_RETRYABLE'
        : code === 'CONFLICT'
          ? 'IDEMPOTENCY_CONFLICT'
          : code === 'REJECTED'
            ? 'TRANSPORT_REJECTED'
            : 'TRANSPORT_UNKNOWN';
    const retryAfterMs =
      error instanceof ReviewNotificationTransportError &&
      Number.isSafeInteger(error.retryAfterMs) &&
      (error.retryAfterMs ?? 0) > 0
        ? Math.min(error.retryAfterMs ?? 0, 23 * 60 * 60 * 1000)
        : undefined;
    completion = {
      ...identity,
      outcome,
      code: reason,
      now: clock(),
      ...(outcome === 'RETRYABLE' && retryAfterMs !== undefined ? { retryAfterMs } : {}),
    };
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) options.signal?.removeEventListener('abort', abort);
  }
  try {
    return await completeReviewNotificationAttempt(options.prisma, completion);
  } catch {
    throw new Error('REVIEW_NOTIFICATION_RECEIPT_UNCONFIRMED');
  }
}

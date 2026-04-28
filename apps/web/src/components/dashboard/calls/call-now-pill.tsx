'use client';

import { Pill, cn } from '@dentabill/ui';
import { Phone } from 'lucide-react';
import * as React from 'react';

import { useEnqueueCall } from '../../../lib/calls/use-enqueue-call.js';
import type { ClaimStatus } from '../../../lib/claims/types.js';

export interface CallNowPillProps {
  readonly claimId: string;
  readonly claimStatus: ClaimStatus;
  /** When `compact`, renders the small row-action variant; default is the detail-page CTA. */
  readonly variant?: 'detail' | 'compact';
  readonly className?: string;
}

const QUEUEABLE_STATUSES: ReadonlySet<ClaimStatus> = new Set(['PENDING', 'NEEDS_INFO', 'FAILED']);

/**
 * "Call now" — the user-facing entry point to the Phase-3 call worker.
 *
 * Visible only for claims whose status is queue-eligible. Any other
 * status renders nothing so the row stays uncluttered for terminal
 * claims (COMPLETED, RESOLVED, WRITTEN_OFF) and live claims that are
 * already in flight (IN_QUEUE, CALLING).
 *
 * On click → `POST /v1/claims/:id/calls`. The mutation hook patches the
 * cached claim detail to `IN_QUEUE` optimistically and invalidates the
 * list so the live indicator activates without a reload.
 *
 * Errors are rendered inline beneath the Pill (no toast system yet).
 * The most common error is `PAYER_HOURS_CLOSED` which the API returns
 * with a human-readable message — we surface it verbatim. After a
 * `PAYER_HOURS_CLOSED` response we keep the Pill enabled (the user may
 * be reading the message and want to retry once they've checked their
 * clock), but offer a "Dismiss" affordance so the message doesn't pin
 * to the row forever.
 */
export function CallNowPill({
  claimId,
  claimStatus,
  variant = 'detail',
  className,
}: CallNowPillProps): React.ReactElement | null {
  const mutation = useEnqueueCall();

  const onClick = React.useCallback((): void => {
    mutation.reset();
    mutation.mutate({ claimId });
  }, [mutation, claimId]);

  if (!QUEUEABLE_STATUSES.has(claimStatus)) return null;

  const isPending = mutation.isPending;
  const errorMessage = mutation.error?.message ?? null;
  const compact = variant === 'compact';

  return (
    <div className={cn('flex flex-col items-start gap-2', className)} data-testid="call-now-pill">
      <Pill asChild variant="black" size={compact ? 'sm' : 'default'}>
        <button
          type="button"
          onClick={onClick}
          disabled={isPending}
          aria-label={`Call now for claim ${claimId}`}
          aria-busy={isPending}
          className="disabled:cursor-progress"
        >
          <Phone aria-hidden className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          {isPending ? 'Queuing…' : 'Call now'}
        </button>
      </Pill>

      {errorMessage ? (
        <p
          role="alert"
          className="text-caption text-gray-warm max-w-[28rem] leading-snug"
          data-testid="call-now-pill-error"
        >
          {errorMessage}
        </p>
      ) : null}

      {mutation.isSuccess ? (
        <p
          className="text-caption text-gray-warm"
          aria-live="polite"
          data-testid="call-now-pill-success"
        >
          Queued. The call will start shortly.
        </p>
      ) : null}
    </div>
  );
}

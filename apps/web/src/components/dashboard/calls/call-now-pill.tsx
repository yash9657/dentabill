'use client';

import { Pill, StatusDot, cn } from '@dentabill/ui';
import { Phone } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { useEnqueueCall } from '../../../lib/calls/use-enqueue-call.js';
import {
  PHASE_3_DIALABLE_PAYERS,
  type ClaimStatus,
  type PayerCode,
} from '../../../lib/claims/types.js';

export interface CallNowPillProps {
  readonly claimId: string;
  readonly claimStatus: ClaimStatus;
  /**
   * Claim's payer code. Optional only for legacy callers; new callers
   * should always pass it so the UI can gate the action against the
   * Phase-3 dialable set instead of letting the API return 422 after
   * the round-trip. When omitted, the UI assumes the payer is dialable
   * (preserves existing test fixtures that don't supply it).
   */
  readonly payerCode?: PayerCode;
  /** When `compact`, renders the small row-action variant; default is the detail-page CTA. */
  readonly variant?: 'detail' | 'compact';
  readonly className?: string;
}

// Mirrors `ENQUEUEABLE_CLAIM_STATUSES` in `apps/api/src/routes/v1/calls.ts`.
// The API is the contract; the UI must not be more restrictive (would hide
// valid actions) or more permissive (would 409 on click). Reviewed claims
// must first visit claim detail, where submission recovery is checked.
const QUEUEABLE_STATUSES: ReadonlySet<ClaimStatus> = new Set([
  'PENDING',
  'NEEDS_INFO',
  'APPEALING',
  'MANUAL_REVIEW',
]);
const RETRY_STATUSES: ReadonlySet<ClaimStatus> = new Set(['MANUAL_REVIEW', 'APPEALING']);

/**
 * "Call now" — the user-facing entry point to the Phase-3 call worker.
 *
 * Visible only for claims whose status is queue-eligible. Any other
 * status renders nothing so the row stays uncluttered for terminal
 * claims (COMPLETED, RESOLVED, WRITTEN_OFF) and live claims that are
 * already in flight (IN_QUEUE, CALLING).
 *
 * On click → `POST /v1/claims/:id/calls`. The mutation hook refreshes
 * the claim and call status from the server.
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
  payerCode,
  variant = 'detail',
  className,
}: CallNowPillProps): React.ReactElement | null {
  const mutation = useEnqueueCall();

  const onClick = React.useCallback((): void => {
    mutation.reset();
    mutation.mutate({ claimId });
  }, [mutation, claimId]);

  const compact = variant === 'compact';

  if (compact && RETRY_STATUSES.has(claimStatus)) {
    return (
      <Link
        href={`/dashboard/claims/${claimId}`}
        aria-label={`Review call for claim ${claimId}`}
        className={cn(
          'rounded-pill text-caption hairline-edge text-gray-dark inline-flex h-7 items-center bg-white/70 px-2.5 font-medium hover:bg-black hover:text-white',
          className,
        )}
      >
        Review call
      </Link>
    );
  }

  // Non-queueable terminal / in-flight states (IN_QUEUE, CALLING,
  // COMPLETED, RESOLVED, DENIED, WRITTEN_OFF, FAILED) get a quiet
  // contextual badge instead of an empty cell — empty action cells
  // mid-table read as a rendering bug, and a user who clicked Call
  // a moment ago shouldn't be left wondering why the affordance
  // vanished. The badge is achromatic; live states (IN_QUEUE /
  // CALLING) reuse the muted-teal status accent (ADR-013) so the
  // signal lines up with the StatusDot in the row's status column.
  if (!QUEUEABLE_STATUSES.has(claimStatus)) {
    return (
      <NoActionBadge
        claimStatus={claimStatus}
        compact={compact}
        {...(className ? { className } : {})}
      />
    );
  }

  // Payer-code gate (mirrors API's PHASE_3_PAYERS_SET in calls.ts).
  // Render a quiet "Manual" badge so the action column still
  // communicates *something* — empty cells mid-table read as a bug.
  // The badge is achromatic per ADR-013, hairline-edge, and explicitly
  // non-interactive (no hover lift, no tab stop). Compact label is
  // intentionally short ("Manual") to fit the 7rem action column;
  // detail variant has room for the fuller phrasing. The full
  // explanation lives in the title attribute on both.
  if (payerCode !== undefined && !PHASE_3_DIALABLE_PAYERS.has(payerCode)) {
    const tooltip = 'DentaBill currently dials Delta Dental PPO, Cigna Dental, and MetLife Dental.';
    if (compact) {
      return (
        <span
          role="status"
          title={tooltip}
          data-testid="call-now-pill-manual-review"
          className={cn(
            'rounded-pill text-caption inline-flex h-7 items-center px-2.5 font-medium',
            'hairline-edge text-gray-warm bg-warm-stone/30',
            className,
          )}
        >
          Manual
        </span>
      );
    }
    return (
      <span
        role="status"
        title={tooltip}
        data-testid="call-now-pill-manual-review"
        className={cn(
          'rounded-pill inline-flex h-9 items-center px-3 text-sm font-medium',
          'hairline-edge text-gray-warm bg-warm-stone/30',
          className,
        )}
      >
        Manual review only
      </span>
    );
  }

  const isPending = mutation.isPending;
  const errorMessage = mutation.error?.message ?? null;
  const errorCode =
    mutation.error && (mutation.error as Error & { code?: string }).code
      ? ((mutation.error as Error & { code?: string }).code ?? null)
      : null;
  const isMissingNpi = errorCode === 'MISSING_PROVIDER_NPI';
  const isRetry = RETRY_STATUSES.has(claimStatus);
  const idleLabelCompact = isRetry ? 'Retry' : 'Call';
  const idleLabelDetail = isRetry ? 'Retry call' : 'Call now';

  if (compact) {
    if (isMissingNpi) {
      return (
        <Link
          href="/dashboard/settings/organization?focus=npi"
          aria-label="Add practice NPI in settings to enable calls"
          title={errorMessage ?? undefined}
          data-testid="call-now-pill"
          className={cn(
            'rounded-pill text-caption duration-standard ease-calm inline-flex h-7 items-center gap-1.5 px-2.5 font-medium transition-colors',
            'hairline-edge bg-warm-stone/60 text-black',
            'hover:border-transparent hover:bg-black hover:text-white',
            className,
          )}
        >
          Add NPI →
        </Link>
      );
    }
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        aria-label={`Call now for claim ${claimId}`}
        aria-busy={isPending}
        title={errorMessage ?? undefined}
        data-testid="call-now-pill"
        className={cn(
          'rounded-pill text-caption duration-standard ease-calm inline-flex h-7 items-center gap-1.5 px-2.5 font-medium transition-colors',
          'hairline-edge text-gray-dark bg-white/70',
          'hover:border-transparent hover:bg-black hover:text-white',
          'disabled:cursor-progress',
          errorMessage ? 'border-border-light' : '',
          className,
        )}
      >
        <Phone aria-hidden className="h-3.5 w-3.5" />
        {isPending ? 'Queuing…' : idleLabelCompact}
      </button>
    );
  }

  return (
    <div className={cn('flex flex-col items-start gap-2', className)} data-testid="call-now-pill">
      <Pill asChild variant="black" size="default">
        <button
          type="button"
          onClick={onClick}
          disabled={isPending}
          aria-label={`Call now for claim ${claimId}`}
          aria-busy={isPending}
          className="disabled:cursor-progress"
        >
          <Phone aria-hidden className="h-4 w-4" />
          {isPending ? 'Queuing…' : idleLabelDetail}
        </button>
      </Pill>

      {errorMessage ? (
        <p
          role="alert"
          className="text-caption text-gray-warm max-w-[28rem] leading-snug"
          data-testid="call-now-pill-error"
        >
          {errorMessage}
          {isMissingNpi ? (
            <>
              {' '}
              <Link
                href="/dashboard/settings/organization?focus=npi"
                className="text-black underline-offset-2 hover:underline focus-visible:underline"
              >
                Add NPI in settings →
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {mutation.isSuccess ? (
        <p
          className="text-caption text-gray-warm"
          aria-live="polite"
          data-testid="call-now-pill-success"
        >
          Call request accepted.
        </p>
      ) : null}
    </div>
  );
}

const LIVE_STATUSES: ReadonlySet<ClaimStatus> = new Set(['IN_QUEUE', 'CALLING']);

const STATUS_BADGE_LABEL: Readonly<Record<ClaimStatus, string>> = {
  PENDING: 'Pending',
  IN_QUEUE: 'Queued',
  CALLING: 'Calling',
  COMPLETED: 'Completed',
  DENIED: 'Denied',
  NEEDS_INFO: 'Needs info',
  APPEALING: 'Appealing',
  RESOLVED: 'Resolved',
  WRITTEN_OFF: 'Written off',
  FAILED: 'Failed',
  MANUAL_REVIEW: 'Manual review',
};

function NoActionBadge({
  claimStatus,
  compact,
  className,
}: {
  readonly claimStatus: ClaimStatus;
  readonly compact: boolean;
  readonly className?: string;
}): React.ReactElement {
  const live = LIVE_STATUSES.has(claimStatus);
  const label = STATUS_BADGE_LABEL[claimStatus];
  return (
    <span
      role="status"
      aria-label={live ? `${label} — call in progress` : `${label} — no action needed`}
      data-testid="call-now-pill-no-action"
      className={cn(
        'rounded-pill inline-flex items-center font-medium',
        'hairline-edge bg-warm-stone/30 text-gray-warm',
        compact ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-3 text-sm',
        live ? 'gap-1.5' : '',
        className,
      )}
    >
      {live ? <StatusDot variant="active" aria-hidden /> : null}
      {label}
    </span>
  );
}

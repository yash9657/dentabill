'use client';

import { Pill } from '@dentabill/ui';
import Link from 'next/link';
import type * as React from 'react';

import { useCallRecovery, useReconcileCall } from '../../../lib/calls/use-call-recovery.js';
import type { ClaimStatus, PayerCode } from '../../../lib/claims/types.js';

import { CallNowPill } from './call-now-pill.js';

interface ClaimCallRecoveryProps {
  readonly claimId: string;
  readonly claimStatus: ClaimStatus;
  readonly payerCode: PayerCode;
}

export function ClaimCallRecovery(props: ClaimCallRecoveryProps): React.ReactElement {
  const query = useCallRecovery(props.claimId);
  const mutation = useReconcileCall(props.claimId);

  if (query.isPending) {
    return (
      <p role="status" className="text-gray-warm text-sm">
        Checking call status…
      </p>
    );
  }
  if (query.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-gray-dark text-sm">
          Couldn’t confirm the existing call status.
        </p>
        <Pill asChild variant="black">
          <button
            type="button"
            disabled={query.isFetching}
            onClick={() => {
              void query.refetch();
            }}
          >
            {query.isFetching ? 'Checking…' : 'Retry status check'}
          </button>
        </Pill>
      </div>
    );
  }

  const { intent, canCheck, canReview, availability } = query.data;
  // A terminal call can leave the active-intent projection during this lookup.
  const recoveredCallId =
    mutation.data?.claimId === props.claimId ? mutation.data.recovery.intent?.callId : null;
  const callId = intent?.callId ?? (!intent ? recoveredCallId : null);
  if (callId) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="status" className="text-gray-dark text-sm">
          Existing call found. Follow its status and results.
        </p>
        <Pill asChild variant="black">
          <Link href={`/dashboard/calls/${callId}`}>View call</Link>
        </Pill>
      </div>
    );
  }
  if (!intent) return <CallNowPill {...props} variant="detail" />;
  if (intent.state === 'READY' || intent.state === 'ACCEPTED') {
    return (
      <p role="status" className="text-gray-dark text-sm">
        {intent.state === 'READY'
          ? 'Call queued. Waiting to start.'
          : 'Call accepted. Waiting for its status.'}
      </p>
    );
  }

  const outcome = intent.lastCheckOutcome;
  const lastResult =
    outcome === 'NO_MATCH'
      ? 'The provider has not confirmed a matching call. Keep this claim in review.'
      : outcome === 'LOOKUP_FAILED'
        ? 'The provider could not be checked. Keep this claim in review.'
        : outcome === 'REVIEW_REQUIRED'
          ? 'The result needs manual review. Keep this claim in review.'
          : null;

  return (
    <section
      aria-labelledby="call-recovery-heading"
      className="hairline-edge rounded-card bg-warm-stone/30 flex max-w-3xl flex-col items-start gap-3 p-5"
    >
      <h2 id="call-recovery-heading" className="text-base font-medium text-black">
        Call status needs confirmation
      </h2>
      <p className="text-gray-dark max-w-prose text-sm">
        A call may already have started. Check for the existing call before considering another
        attempt.
      </p>
      {lastResult ? (
        <p role="status" className="text-gray-dark text-sm">
          {lastResult}
        </p>
      ) : null}
      {availability === 'NOT_CONFIGURED' ? (
        <p className="text-gray-warm text-sm">
          Call lookup is not configured. Contact your administrator.
        </p>
      ) : !canReview ? (
        <p className="text-gray-warm text-sm">Ask an owner or admin to check the existing call.</p>
      ) : (
        <>
          <Pill asChild variant="black">
            <button
              type="button"
              disabled={!canCheck || mutation.isPending}
              aria-busy={mutation.isPending}
              onClick={() => {
                mutation.mutate(intent.id);
              }}
            >
              {mutation.isPending ? 'Checking existing call…' : 'Check existing call'}
            </button>
          </Pill>
          {!canCheck && !mutation.isPending ? (
            <p className="text-gray-warm text-sm">
              Another status check will be available shortly.
            </p>
          ) : null}
        </>
      )}
      {mutation.error ? (
        <p role="alert" className="text-gray-dark text-sm">
          {mutation.error.message}
        </p>
      ) : null}
    </section>
  );
}

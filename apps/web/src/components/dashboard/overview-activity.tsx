'use client';

import { Button, Skeleton, StatusDot } from '@dentabill/ui';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { callStatusIndicatorVariant, callStatusLabel } from '../../lib/calls/types.js';
import { useCallsList } from '../../lib/calls/use-calls-list.js';
import { payerLabel, statusIndicatorVariant, statusLabel } from '../../lib/claims/types.js';
import { useClaimsList } from '../../lib/claims/use-claims-list.js';

import { OverviewEmptySection } from './overview-empty-section.js';

export function OverviewActivity(): React.ReactElement {
  const claims = useClaimsList({});
  const calls = useCallsList({});
  const claimItems = claims.data?.pages.flatMap((page) => page.items).slice(0, 5) ?? [];
  const callItems = calls.data?.pages.flatMap((page) => page.items).slice(0, 5) ?? [];
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {claims.isPending ? (
        <ActivityLoading label="Loading claims" />
      ) : claims.isError ? (
        <ActivityError
          label="claims"
          retry={() => {
            void claims.refetch();
          }}
        />
      ) : claimItems.length === 0 ? (
        <OverviewEmptySection
          eyebrow="Claims to follow up"
          heading="Start with your open claims"
          body="Import a CSV from your practice management system. Your claims will be organized here, ready for follow-up."
          ctaLabel="Import claims"
          ctaHref="/dashboard/claims/import"
        />
      ) : (
        <section className="overview-panel">
          <header>
            <h2>Claims to follow up</h2>
            <Link className="text-link" href="/dashboard/claims">
              View all <ArrowUpRight size={14} />
            </Link>
          </header>
          <ul className="divide-border-subtle divide-y">
            {claimItems.map((claim) => (
              <li key={claim.id}>
                <Link
                  href={`/dashboard/claims/${claim.id}`}
                  className="hover:bg-gray-light-alt flex flex-wrap items-center justify-between gap-3 px-6 py-4"
                >
                  <span>
                    <strong className="block text-sm font-medium">{claim.claimNumber}</strong>
                    <span className="text-gray-warm mt-1 block text-xs">
                      {payerLabel(claim.payerCode)}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-medium tabular-nums">
                      ${claim.claimAmount}
                    </span>
                    <span className="text-gray-dark mt-1 inline-flex items-center gap-2 text-xs">
                      <StatusDot size="sm" variant={statusIndicatorVariant(claim.status)} />
                      {statusLabel(claim.status)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {calls.isPending ? (
        <ActivityLoading label="Loading calls" />
      ) : calls.isError ? (
        <ActivityError
          label="calls"
          retry={() => {
            void calls.refetch();
          }}
        />
      ) : callItems.length === 0 ? (
        <OverviewEmptySection
          eyebrow="Recent calls"
          heading="Your call history starts here"
          body="Start a follow-up from your claims queue. You can check its progress and review the result here."
          ctaLabel="Open calls"
          ctaHref="/dashboard/calls"
        />
      ) : (
        <section className="overview-panel">
          <header>
            <h2>Recent calls</h2>
            <Link className="text-link" href="/dashboard/calls">
              View all <ArrowUpRight size={14} />
            </Link>
          </header>
          <ul className="divide-border-subtle divide-y">
            {callItems.map((call) => (
              <li key={call.id}>
                <Link
                  href={`/dashboard/calls/${call.id}`}
                  className="hover:bg-gray-light-alt flex flex-wrap items-center justify-between gap-3 px-6 py-4"
                >
                  <span className="inline-flex items-center gap-2 text-sm">
                    <StatusDot size="sm" variant={callStatusIndicatorVariant(call.status)} />
                    {callStatusLabel(call.status)}
                  </span>
                  <span className="text-gray-warm text-xs">Attempt {call.attemptNumber}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
function ActivityLoading({ label }: { readonly label: string }): React.ReactElement {
  return (
    <section className="overview-panel p-6" aria-label={label} aria-busy="true">
      <Skeleton className="mb-6 h-5 w-32" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="mb-4 h-12 w-full" />
      ))}
    </section>
  );
}
function ActivityError({
  label,
  retry,
}: {
  readonly label: string;
  readonly retry: () => void;
}): React.ReactElement {
  return (
    <section className="overview-panel p-6">
      <p role="alert" className="mb-4 text-sm">
        Couldn’t load {label}. Please try again.
      </p>
      <Button size="sm" variant="secondary" onClick={retry}>
        Try again
      </Button>
    </section>
  );
}

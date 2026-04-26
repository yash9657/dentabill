'use client';

import { Skeleton, StatusDot } from '@dentabill/ui';
import Link from 'next/link';
import * as React from 'react';

import {
  payerLabel,
  statusLabel,
  type Claim,
  type ClaimStatus,
} from '../../../lib/claims/types.js';
import { useClaim } from '../../../lib/claims/use-claim.js';
import { DashboardEmptyState } from '../dashboard-empty-state.js';
import { SkeletonList } from '../skeleton-list.js';

import { ClaimStatusDialog } from './claim-status-dialog.js';

export interface ClaimDetailPageProps {
  readonly id: string;
}

function hasClerkKeys(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

/**
 * `/dashboard/claims/[id]` page composition.
 *
 * Three vertical zones:
 *
 *   1. Crumbs + back link — gives the user a clear path back to the
 *      list and answers "where am I" without a topbar breadcrumb.
 *   2. Summary card — claim number, payer, amount, service date,
 *      priority, status. The status block doubles as the manual
 *      edit trigger (opens the audit-logged change dialog).
 *   3. History timeline — placeholder for `CallEvent` rows. The
 *      Phase 2 surface lists the claim's intrinsic timestamps
 *      (created, last update); the call worker in Phase 3 begins
 *      writing real CallEvent rows that this same component renders.
 */
export function ClaimDetailPage({ id }: ClaimDetailPageProps): React.ReactElement {
  if (!hasClerkKeys()) {
    return (
      <DashboardEmptyState
        eyebrow="Claim"
        title="Sign in to see claim detail"
        body="The claim summary, call history, and manual status edit live behind authentication. Sign in to access the queue you uploaded."
        previewChildren={<SkeletonList rows={4} />}
        primaryCta={{ label: 'Sign in', href: '/sign-in' }}
        secondaryCta={{ label: 'Back to claims', href: '/dashboard/claims' }}
      />
    );
  }
  return <AuthenticatedClaimDetail id={id} />;
}

function AuthenticatedClaimDetail({ id }: { readonly id: string }): React.ReactElement {
  const query = useClaim(id);

  if (query.isPending) {
    return <DetailSkeleton />;
  }
  if (query.isError) {
    return (
      <section className="flex flex-col gap-6">
        <BackLink />
        <div
          role="alert"
          className="hairline-edge rounded-card text-body bg-stone-warm/30 px-5 py-4"
        >
          <p className="text-black">Couldn’t load this claim</p>
          <p className="text-gray-warm mt-1 text-sm">
            {query.error.message || 'The claim is unavailable or has been removed.'}
          </p>
        </div>
      </section>
    );
  }

  return <DetailLayout claim={query.data} />;
}

function DetailLayout({ claim }: { readonly claim: Claim }): React.ReactElement {
  return (
    <section className="flex flex-col gap-8" aria-labelledby="claim-detail-heading">
      <BackLink />

      <header className="max-w-3xl">
        <p className="text-caption text-gray-warm mb-2 uppercase tracking-[0.14em]">Claim</p>
        <h1
          id="claim-detail-heading"
          className="font-display text-[28px] font-light leading-[1.15] tracking-[-0.01em] text-black sm:text-[32px]"
        >
          {claim.claimNumber}
        </h1>
        <p className="text-body text-gray-dark mt-3 max-w-prose">
          {payerLabel(claim.payerCode)} · ${claim.claimAmount} · service date{' '}
          {formatDate(claim.serviceDate)}.
        </p>
      </header>

      <SummaryCard claim={claim} />
      <Timeline claim={claim} />
    </section>
  );
}

function BackLink(): React.ReactElement {
  return (
    <Link
      href="/dashboard/claims"
      className="text-body text-gray-warm hover:text-black focus-visible:underline"
    >
      ← All claims
    </Link>
  );
}

function SummaryCard({ claim }: { readonly claim: Claim }): React.ReactElement {
  return (
    <article className="hairline-edge rounded-card grid gap-6 bg-white p-6 sm:grid-cols-[1fr_auto] sm:items-center">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <Field label="Payer" value={payerLabel(claim.payerCode)} />
        <Field label="Amount" value={`$${claim.claimAmount}`} mono />
        <Field label="Service date" value={formatDate(claim.serviceDate)} />
        <Field
          label="Submitted"
          value={claim.submittedDate ? formatDate(claim.submittedDate) : 'Not yet submitted'}
        />
        <Field label="Priority" value={String(claim.priority)} mono />
        <Field
          label="CDT codes"
          value={claim.cdtCodes.length > 0 ? claim.cdtCodes.join(', ') : '—'}
          mono
        />
        <FieldStatus status={claim.status} />
      </dl>
      <ClaimStatusDialog claim={claim} />
    </article>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-caption text-gray-warm uppercase tracking-[0.12em]">{label}</dt>
      <dd className={mono ? 'text-body font-mono text-black' : 'text-body text-black'}>{value}</dd>
    </div>
  );
}

function FieldStatus({ status }: { readonly status: ClaimStatus }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-caption text-gray-warm uppercase tracking-[0.12em]">Status</dt>
      <dd className="text-body flex items-center gap-2 text-black">
        <StatusDot variant={status === 'CALLING' ? 'active' : 'idle'} aria-hidden />
        {statusLabel(status)}
      </dd>
    </div>
  );
}

function Timeline({ claim }: { readonly claim: Claim }): React.ReactElement {
  return (
    <article aria-labelledby="claim-history-heading" className="flex flex-col gap-4">
      <header>
        <p className="text-caption text-gray-warm uppercase tracking-[0.14em]">History</p>
        <h2 id="claim-history-heading" className="font-display text-2xl font-light text-black">
          Activity timeline
        </h2>
      </header>
      <ol className="hairline-edge rounded-card flex flex-col gap-0 bg-white">
        <Entry
          when={formatDateTime(claim.updatedAt)}
          title="Last updated"
          body={`Status currently ${statusLabel(claim.status)}.`}
        />
        <Entry
          when={formatDateTime(claim.createdAt)}
          title="Claim ingested"
          body="Imported from a CSV upload. Call activity from the Retell worker will appear here."
        />
      </ol>
      <p className="text-caption text-gray-warm">
        Real call events (CALL_STARTED, IVR_NAVIGATED, REP_REACHED, …) will populate this timeline
        once the Phase 3 call worker ships.
      </p>
    </article>
  );
}

function Entry({
  when,
  title,
  body,
}: {
  readonly when: string;
  readonly title: string;
  readonly body: string;
}): React.ReactElement {
  return (
    <li className="grid grid-cols-[140px_1fr] gap-6 border-b border-black/5 px-5 py-4 last:border-b-0">
      <span className="text-caption text-gray-warm uppercase tabular-nums tracking-[0.12em]">
        {when}
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-body text-sm font-medium text-black">{title}</span>
        <span className="text-body text-gray-warm text-sm">{body}</span>
      </div>
    </li>
  );
}

function DetailSkeleton(): React.ReactElement {
  return (
    <section className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      <Skeleton className="h-4 w-24" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="hairline-edge rounded-card grid grid-cols-2 gap-4 bg-white p-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </section>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

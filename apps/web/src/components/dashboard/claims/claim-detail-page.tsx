'use client';

import { Skeleton, StatusDot } from '@dentabill/ui';
import Link from 'next/link';
import * as React from 'react';

import { callStatusLabel, type CallSummary } from '../../../lib/calls/types.js';
import { useClaimCalls } from '../../../lib/calls/use-claim-calls.js';
import {
  payerLabel,
  statusIndicatorVariant,
  statusLabel,
  type Claim,
  type ClaimStatus,
} from '../../../lib/claims/types.js';
import { useClaim } from '../../../lib/claims/use-claim.js';
import { ClaimCallRecovery } from '../calls/claim-call-recovery.js';
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
          className="hairline-edge rounded-card text-body bg-warm-stone/30 px-5 py-4"
        >
          <p className="text-black">Couldn&apos;t load this claim</p>
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
        <h1
          id="claim-detail-heading"
          className="font-body text-[28px] font-medium leading-[1.15] tracking-[-0.01em] text-black sm:text-[32px]"
        >
          {claim.claimNumber}
        </h1>
        <p className="text-body text-gray-dark mt-3 max-w-prose">
          {payerLabel(claim.payerCode)} · ${claim.claimAmount} · service date{' '}
          {formatDate(claim.serviceDate)}.
        </p>
      </header>

      <SummaryCard claim={claim} />
      <ClaimCallRecovery
        claimId={claim.id}
        claimStatus={claim.status}
        payerCode={claim.payerCode}
      />
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
      <dd
        className="text-body flex items-center gap-2 text-black"
        aria-label={`Status: ${statusLabel(status)}`}
      >
        <StatusDot variant={statusIndicatorVariant(status)} aria-hidden />
        {statusLabel(status)}
      </dd>
    </div>
  );
}

function Timeline({ claim }: { readonly claim: Claim }): React.ReactElement {
  const calls = useClaimCalls(claim.id);

  // Derive entries from claim + call lifecycle. We deliberately stop
  // short of fanning out to per-Call CallEvent detail (the worker
  // writes IVR_NAVIGATED, REP_REACHED, etc. as discrete CallEvents,
  // surfaced via /v1/calls/{id}); the booleans `ivrNavigated` /
  // `humanReached` already convey those checkpoints at the call level
  // without an N+1 fetch. Phase 4's transcript-SSE work expands this
  // to render the per-event stream inline.
  const entries: TimelineEntry[] = [];
  entries.push({
    timestamp: claim.createdAt,
    title: 'Claim ingested',
    body: 'Imported from a CSV upload.',
  });
  if (claim.updatedAt !== claim.createdAt) {
    entries.push({
      timestamp: claim.updatedAt,
      title: 'Status updated',
      body: `Now ${statusLabel(claim.status)}.`,
    });
  }
  for (const call of calls.data?.items ?? []) {
    for (const e of derivedEntriesForCall(call)) entries.push(e);
  }
  // Newest first — the operator's eye lands on what just happened.
  entries.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  return (
    <article aria-labelledby="claim-history-heading" className="flex flex-col gap-4">
      <header>
        <p className="text-caption text-gray-warm uppercase tracking-[0.14em]">History</p>
        <h2 id="claim-history-heading" className="font-body text-2xl font-medium text-black">
          Activity timeline
        </h2>
      </header>
      <ol className="hairline-edge rounded-card flex flex-col gap-0 bg-white">
        {entries.map((entry) => (
          <Entry
            key={`${entry.title}-${entry.timestamp}`}
            when={formatDateTime(entry.timestamp)}
            title={entry.title}
            body={entry.body}
          />
        ))}
      </ol>
      {calls.isError ? (
        <p className="text-caption text-gray-warm" role="alert">
          Could not load call history. {calls.error.message}
        </p>
      ) : null}
    </article>
  );
}

interface TimelineEntry {
  readonly timestamp: string;
  readonly title: string;
  readonly body: string;
}

function derivedEntriesForCall(call: CallSummary): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  // Call rows always have a `createdAt` (queued moment); `startedAt`
  // and `endedAt` are nullable depending on lifecycle phase.
  out.push({
    timestamp: call.createdAt,
    title: `Call queued · attempt ${String(call.attemptNumber)}`,
    body: `Outbound call placed in the queue (call id ${shortId(call.id)}).`,
  });
  if (call.startedAt) {
    out.push({
      timestamp: call.startedAt,
      title: 'Call started',
      body: call.retellAgentId
        ? `Dialled out via Retell agent ${shortId(call.retellAgentId)}.`
        : 'Dialled out via Retell.',
    });
  }
  // IVR + human-reached are point-in-time checkpoints we don't have
  // discrete timestamps for at the Call-row level — synthesise their
  // ordering from `startedAt` so they render between start and end.
  // The granular timestamps live on CallEvent rows; surfaced once
  // the Phase 4 transcript view lands.
  if (call.ivrNavigated && call.startedAt) {
    out.push({
      timestamp: addMs(call.startedAt, 1),
      title: 'IVR navigated',
      body: 'Reached the live-rep queue past the menu tree.',
    });
  }
  if (call.humanReached && call.startedAt) {
    out.push({
      timestamp: addMs(call.startedAt, 2),
      title: 'Representative reached',
      body:
        call.holdTimeSeconds !== null
          ? `Connected after ${formatSeconds(call.holdTimeSeconds)} on hold.`
          : 'Connected to a payer rep.',
    });
  }
  if (call.endedAt) {
    out.push({
      timestamp: call.endedAt,
      title: `Call ended · ${callStatusLabel(call.status)}`,
      body:
        call.durationSeconds !== null
          ? `Total duration ${formatSeconds(call.durationSeconds)}.${
              call.dlqReason ? ` Reason: ${call.dlqReason}.` : ''
            }`
          : call.dlqReason
            ? `Reason: ${call.dlqReason}.`
            : 'Call complete.',
    });
  }
  return out;
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function formatSeconds(total: number): string {
  if (total < 60) return `${String(total)}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${String(m)}m` : `${String(m)}m ${String(s)}s`;
}

function addMs(iso: string, deltaMs: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + deltaMs).toISOString();
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
    <li className="border-border-subtle grid grid-cols-1 gap-2 border-b px-5 py-4 last:border-b-0 sm:grid-cols-[140px_1fr] sm:gap-6">
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

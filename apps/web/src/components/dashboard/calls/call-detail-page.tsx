'use client';

import { Button, Skeleton, StatusDot } from '@dentabill/ui';
import Link from 'next/link';
import * as React from 'react';

import { callMonitoringLabel } from '../../../lib/calls/monitoring.js';
import {
  callStatusIndicatorVariant,
  callStatusLabel,
  isCallCancellationPending,
  isLiveCallStatus,
  type CallDetailResponse,
  type CallEvent,
  type CallStatus,
} from '../../../lib/calls/types.js';
import { useCall } from '../../../lib/calls/use-call.js';
import { useCancelCall } from '../../../lib/calls/use-cancel-call.js';
import { payerLabel } from '../../../lib/claims/types.js';
import { DashboardEmptyState } from '../dashboard-empty-state.js';
import { SkeletonList } from '../skeleton-list.js';

import { CallAnalysisStatus } from './call-analysis-status.js';
import { CheckCallStatusControl } from './check-call-status-control.js';

export interface CallDetailPageProps {
  readonly id: string;
}

function hasClerkKeys(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

export function CallDetailPage({ id }: CallDetailPageProps): React.ReactElement {
  if (!hasClerkKeys()) {
    return (
      <DashboardEmptyState
        eyebrow="Call"
        title="Sign in to see call detail"
        body="The call summary, event timeline, and linked claim live behind authentication."
        previewChildren={<SkeletonList rows={4} />}
        primaryCta={{ label: 'Sign in', href: '/sign-in' }}
        secondaryCta={{ label: 'Back to calls', href: '/dashboard/calls' }}
      />
    );
  }
  return <AuthenticatedCallDetail id={id} />;
}

function AuthenticatedCallDetail({ id }: { readonly id: string }): React.ReactElement {
  const query = useCall(id);

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
          <p className="text-black">Couldn’t load this call</p>
          <p className="text-gray-warm mt-1 text-sm">
            {query.error.message || 'The call is unavailable or has been removed.'}
          </p>
        </div>
      </section>
    );
  }

  return <DetailLayout call={query.data} />;
}

function DetailLayout({ call }: { readonly call: CallDetailResponse }): React.ReactElement {
  return (
    <section className="flex flex-col gap-8" aria-labelledby="call-detail-heading">
      <BackLink />

      <header className="max-w-3xl">
        <h1
          id="call-detail-heading"
          className="font-body text-[28px] font-medium leading-[1.15] tracking-[-0.01em] text-black sm:text-[32px]"
        >
          Call to {payerLabel(call.claim.payerCode)}
        </h1>
        <p className="text-body text-gray-dark mt-3 max-w-prose">
          Linked claim{' '}
          <Link
            href={`/dashboard/claims/${call.claim.id}`}
            className="underline hover:text-black focus-visible:underline"
          >
            {call.claim.claimNumber}
          </Link>{' '}
          · attempt {call.attemptNumber} · {callStatusLabel(call.status)}.
        </p>
      </header>

      <MonitoringNotice call={call} />
      <div className="flex flex-wrap items-start gap-4">
        <CancellationControl call={call} />
        <CheckCallStatusControl call={call} />
      </div>
      <SummaryCard call={call} />
      <CallAnalysisStatus call={call} />
      <Timeline events={call.events} />
    </section>
  );
}

function MonitoringNotice({
  call,
}: {
  readonly call: CallDetailResponse;
}): React.ReactElement | null {
  const label = callMonitoringLabel(call);
  if (!label) return null;
  const explanation =
    label === 'Deadline exceeded'
      ? 'The call has passed its time limit. A stop request is pending. Its end has not been confirmed.'
      : label === 'Stop not confirmed'
        ? 'The call’s end could not be confirmed after a stop request. This call needs manual review.'
        : label === 'Status needs review'
          ? 'The latest call status could not be confirmed. Keep the claim in review.'
          : call.monitoring?.stopAcknowledgedAt
            ? 'The provider acknowledged the stop request. Waiting for confirmation that the call ended.'
            : 'A stop has been requested. Waiting for the provider to confirm that the call ended.';
  return (
    <div
      role="status"
      className="hairline-edge rounded-card bg-warm-stone/30 flex max-w-3xl flex-col gap-2 p-5"
    >
      <p className="text-base font-medium text-black">{label}</p>
      <p className="text-gray-dark text-sm">{explanation}</p>
    </div>
  );
}

function CancellationControl({
  call,
}: {
  readonly call: CallDetailResponse;
}): React.ReactElement | null {
  const cancellation = useCancelCall(call.id);
  if (!isLiveCallStatus(call.status)) return null;
  const pending = isCallCancellationPending(call);
  const automaticStop = call.monitoring?.stopRequestedAt != null;

  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        variant="secondary"
        disabled={pending || automaticStop || cancellation.isPending}
        aria-busy={cancellation.isPending}
        onClick={() => {
          cancellation.mutate();
        }}
      >
        {pending
          ? 'Cancellation requested'
          : automaticStop
            ? 'Stop requested'
            : cancellation.isPending
              ? 'Requesting cancellation…'
              : 'Cancel call'}
      </Button>
      {pending && !callMonitoringLabel(call) ? (
        <p role="status" className="text-body text-gray-dark max-w-prose text-sm">
          Waiting for the call to end. The call remains active until its end is confirmed.
        </p>
      ) : null}
      {cancellation.isError ? (
        <p role="alert" className="text-body text-danger text-sm">
          Couldn’t request cancellation. Try again.
        </p>
      ) : null}
    </div>
  );
}

function BackLink(): React.ReactElement {
  return (
    <Link
      href="/dashboard/calls"
      className="text-body text-gray-warm hover:text-black focus-visible:underline"
    >
      ← All calls
    </Link>
  );
}

function SummaryCard({ call }: { readonly call: CallDetailResponse }): React.ReactElement {
  return (
    <article className="hairline-edge rounded-card grid gap-6 bg-white p-6 sm:grid-cols-[1fr_auto] sm:items-start">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <Field label="Started" value={formatDateTime(call.startedAt)} />
        <Field label="Ended" value={formatDateTime(call.endedAt)} />
        <Field
          label="Duration"
          value={call.durationSeconds === null ? '—' : `${String(call.durationSeconds)}s`}
          mono
        />
        <Field
          label="Hold time"
          value={call.holdTimeSeconds === null ? '—' : `${String(call.holdTimeSeconds)}s`}
          mono
        />
        <Field label="Attempts" value={String(call.attemptNumber)} mono />
        <Field label="DLQ reason" value={call.dlqReason ?? '—'} mono />
        <FieldStatus status={call.status} />
      </dl>
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

function FieldStatus({ status }: { readonly status: CallStatus }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-caption text-gray-warm uppercase tracking-[0.12em]">Status</dt>
      <dd
        className="text-body flex items-center gap-2 text-black"
        aria-label={`Status: ${callStatusLabel(status)}`}
      >
        <StatusDot variant={callStatusIndicatorVariant(status)} aria-hidden />
        {callStatusLabel(status)}
      </dd>
    </div>
  );
}

function Timeline({ events }: { readonly events: readonly CallEvent[] }): React.ReactElement {
  return (
    <article aria-labelledby="call-events-heading" className="flex flex-col gap-4">
      <header>
        <p className="text-caption text-gray-warm uppercase tracking-[0.14em]">Timeline</p>
        <h2 id="call-events-heading" className="font-body text-2xl font-medium text-black">
          Event log
        </h2>
      </header>
      {events.length === 0 ? (
        <p
          className="hairline-edge rounded-card text-body text-gray-warm bg-white px-5 py-4 text-sm"
          data-testid="call-events-empty"
        >
          No events yet — events stream in as the call progresses.
        </p>
      ) : (
        <ol className="hairline-edge rounded-card flex flex-col gap-0 bg-white">
          {events.map((event) => (
            <Entry
              key={event.id}
              when={formatDateTime(event.timestamp)}
              title={event.eventType}
              body={describeEvent(event.data)}
            />
          ))}
        </ol>
      )}
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

/**
 * The CallEvent payload is unstructured `{ [k: string]: unknown }` —
 * by design, since payer-specific events carry varied keys. Render a
 * readable inline summary, falling back to a JSON-flatten if there's
 * no obvious display field. Heavy events (>200 chars) are truncated to
 * keep the timeline scannable.
 */
function describeEvent(data: Record<string, unknown>): string {
  if (Object.keys(data).length === 0) return '—';
  const candidate =
    typeof data.message === 'string'
      ? data.message
      : typeof data.notes === 'string'
        ? data.notes
        : typeof data.reason === 'string'
          ? data.reason
          : JSON.stringify(data);
  return candidate.length > 200 ? `${candidate.slice(0, 197)}…` : candidate;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

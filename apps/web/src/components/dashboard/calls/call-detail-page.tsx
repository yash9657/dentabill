'use client';

import { useAuth } from '@clerk/nextjs';
import { selectCallTranscript } from '@dentabill/types';
import { Button, Skeleton, StatusDot } from '@dentabill/ui';
import { ChevronRight, Grid3x3, Hash, Hourglass, UserRound, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import {
  derivePhoneTreePath,
  formatDuration,
  type PhoneTreeStep,
} from '../../../lib/calls/call-insights.js';
import { callMonitoringLabel } from '../../../lib/calls/monitoring.js';
import {
  callStatusIndicatorVariant,
  callStatusLabel,
  isCallCancellationPending,
  isLiveCallStatus,
  type CallDetailResponse,
  type CallEvent,
} from '../../../lib/calls/types.js';
import { useCall } from '../../../lib/calls/use-call.js';
import { useCancelCall } from '../../../lib/calls/use-cancel-call.js';
import {
  CLAIM_STATUS_OPTIONS,
  payerLabel,
  statusLabel as claimStatusLabel,
} from '../../../lib/claims/types.js';
import { DashboardEmptyState } from '../dashboard-empty-state.js';
import { SkeletonList } from '../skeleton-list.js';

import { CallAnalysisStatus } from './call-analysis-status.js';
import { CallConversation } from './call-conversation.js';
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
  return <CallDetailAuthGate id={id} />;
}

function CallDetailAuthGate({ id }: { readonly id: string }): React.ReactElement {
  const { isLoaded, orgId, userId } = useAuth();
  if (!isLoaded) return <DetailSkeleton />;
  if (!userId || !orgId) {
    return (
      <DashboardEmptyState
        eyebrow="Call"
        title={!userId ? 'Sign in to see call detail' : 'Choose a practice to see call detail'}
        body="Call details are available only within your active practice."
        previewChildren={<SkeletonList rows={4} />}
        primaryCta={
          !userId
            ? { label: 'Sign in', href: '/sign-in' }
            : { label: 'Back to calls', href: '/dashboard/calls' }
        }
      />
    );
  }
  return <AuthenticatedCallDetail key={`${orgId}:${userId}:${id}`} id={id} />;
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
  const live = isLiveCallStatus(call.status);
  const linkedClaimStatus = CLAIM_STATUS_OPTIONS.find((status) => status === call.claim.status);
  return (
    <section className="flex min-w-0 flex-col gap-5" aria-labelledby="call-detail-heading">
      <BackLink />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1
            id="call-detail-heading"
            className="font-body text-[28px] font-medium leading-[1.15] tracking-[-0.01em] text-black sm:text-[32px]"
          >
            Call to {payerLabel(call.claim.payerCode)}
          </h1>
          <p className="text-gray-dark mt-2 text-sm">
            Claim{' '}
            <Link
              href={`/dashboard/claims/${call.claim.id}`}
              className="break-words underline hover:text-black focus-visible:underline"
            >
              {call.claim.claimNumber}
            </Link>{' '}
            · {linkedClaimStatus ? claimStatusLabel(linkedClaimStatus) : 'Status unavailable'}
          </p>
        </div>
        {live ? (
          <div className="flex flex-wrap items-start gap-3">
            <CancellationControl call={call} />
            <CheckCallStatusControl call={call} />
          </div>
        ) : null}
      </header>

      <MonitoringNotice call={call} />
      {live ? <LiveCallBanner call={call} /> : null}
      <CallProgress call={call} />
      {!live ? <CallAnalysisStatus call={call} /> : null}
      <PhoneTreePath call={call} />
      <CallConversation events={call.events} status={call.status} />
      <details className="border-border-light group min-w-0 border-t">
        <summary className="text-gray-dark focus-visible:outline-brand flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-medium hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
          Call details and event log
          <ChevronRight
            size={18}
            aria-hidden
            className="shrink-0 transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
          />
        </summary>
        <div className="flex min-w-0 flex-col gap-6 pb-4">
          <SummaryCard call={call} />
          <Timeline events={call.events} />
        </div>
      </details>
    </section>
  );
}

function CallProgress({ call }: { readonly call: CallDetailResponse }): React.ReactElement {
  const live = isLiveCallStatus(call.status);
  return (
    <ol
      aria-label="Recorded call progress"
      className="border-border-light flex flex-wrap items-center gap-x-4 gap-y-2 border-y py-3 text-sm"
    >
      {call.startedAt ? (
        <li className="text-gray-dark flex items-center gap-3">
          <span>
            Started <time dateTime={call.startedAt}>{formatDateTime(call.startedAt)}</time>
          </span>
          <ChevronRight size={16} aria-hidden />
        </li>
      ) : null}
      <li
        aria-current="step"
        aria-label={`Status: ${callStatusLabel(call.status)}`}
        className={`rounded-standard flex items-center gap-2 px-3 py-1.5 font-medium transition-colors duration-200 motion-reduce:transition-none ${live ? 'bg-brand-soft text-brand' : 'bg-gray-light text-black'}`}
      >
        <StatusDot variant={callStatusIndicatorVariant(call.status)} aria-hidden />
        {callStatusLabel(call.status)}
      </li>
      {call.durationSeconds !== null ? (
        <li className="text-gray-dark tabular-nums">
          {formatDuration(call.durationSeconds)} duration
        </li>
      ) : null}
    </ol>
  );
}

const stepIcons: Record<PhoneTreeStep['kind'], LucideIcon> = {
  menu: Grid3x3,
  info: Hash,
  hold: Hourglass,
  human: UserRound,
};

function PhoneTreePath({ call }: { readonly call: CallDetailResponse }): React.ReactElement | null {
  const steps = derivePhoneTreePath(selectCallTranscript(call.events).turns, call);
  if (steps.length === 0) return null;
  return (
    <section aria-labelledby="phone-tree-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2
          id="phone-tree-heading"
          className="text-gray-warm text-xs font-semibold uppercase tracking-[0.12em]"
        >
          Phone tree
        </h2>
        <p className="text-gray-warm text-[13px]">From the call transcript</p>
      </div>
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-2">
        {steps.map((step, index) => {
          const Icon = stepIcons[step.kind];
          return (
            <li key={step.id} className="flex min-w-0 items-center gap-1.5">
              {index > 0 ? (
                <ChevronRight size={14} aria-hidden className="text-gray-warm shrink-0" />
              ) : null}
              <span
                className={`rounded-pill inline-flex min-w-0 items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium ${
                  step.kind === 'human'
                    ? 'bg-brand-soft text-brand'
                    : 'border-border-light border bg-white text-black'
                }`}
              >
                <Icon size={14} aria-hidden className="text-brand shrink-0" />
                <span className="break-words">{step.label}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function useElapsedSeconds(startedAt: string | null): number | null {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [startedAt]);
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  return Number.isNaN(started) ? null : Math.max(0, Math.floor((now - started) / 1000));
}

function formatClock(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${String(minutes)}:${rest}`;
}

function LiveCallBanner({ call }: { readonly call: CallDetailResponse }): React.ReactElement {
  const elapsed = useElapsedSeconds(call.startedAt);
  return (
    <div className="rounded-card bg-brand flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 text-white">
      <span className="rounded-pill inline-flex items-center gap-2 bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em]">
        <span aria-hidden className="relative flex h-2.5 w-2.5">
          <span className="bg-ink-inverse absolute inline-flex h-full w-full rounded-full opacity-75 motion-safe:animate-ping" />
          <span className="bg-ink-inverse relative inline-flex h-2.5 w-2.5 rounded-full" />
        </span>
        Live
      </span>
      <span aria-hidden className="flex h-6 items-center gap-[3px]">
        {[0.45, 0.8, 1, 0.65, 0.9, 0.5, 0.75].map((height, index) => (
          <span
            key={index}
            className="h-full w-[3px] origin-center rounded-full bg-white/85 motion-safe:animate-[call-wave_1.1s_ease-in-out_infinite]"
            style={{
              transform: `scaleY(${String(height)})`,
              animationDelay: `${String(index * 0.12)}s`,
            }}
          />
        ))}
      </span>
      <p className="min-w-0 text-[15px] font-medium">DentaBill is on the call</p>
      {elapsed !== null ? (
        <p className="ml-auto text-sm text-white/80">
          <span className="sr-only">Elapsed time </span>
          <span role="timer" className="font-mono text-base font-medium tabular-nums text-white">
            {formatClock(elapsed)}
          </span>
        </p>
      ) : null}
    </div>
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
    <article className="min-w-0">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm lg:grid-cols-4">
        <Field label="Started" value={formatDateTime(call.startedAt)} />
        <Field label="Ended" value={formatDateTime(call.endedAt)} />
        <Field
          label="Duration"
          value={call.durationSeconds === null ? '—' : formatDuration(call.durationSeconds)}
          mono
        />
        <Field
          label="Hold time"
          value={call.holdTimeSeconds === null ? '—' : formatDuration(call.holdTimeSeconds)}
          mono
        />
        <Field label="Attempts" value={String(call.attemptNumber)} mono />
        <Field label="Failure reason" value={call.dlqReason ?? '—'} mono />
        <Field
          label="Phone menu navigated"
          value={call.ivrNavigated ? 'Confirmed' : 'Not confirmed'}
        />
        <Field label="Reached a person" value={call.humanReached ? 'Confirmed' : 'Not confirmed'} />
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
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-gray-warm text-xs">{label}</dt>
      <dd
        className={
          mono ? 'break-words font-mono text-sm text-black' : 'break-words text-sm text-black'
        }
      >
        {value}
      </dd>
    </div>
  );
}

function Timeline({ events }: { readonly events: readonly CallEvent[] }): React.ReactElement {
  const timeline = events.filter(
    (event) =>
      event.eventType !== 'call.transcript' &&
      event.eventType !== 'call.transcript_snapshot' &&
      event.eventType !== 'webhook.call.transcript_snapshot',
  );
  return (
    <article aria-labelledby="call-events-heading" className="flex flex-col gap-4">
      <header>
        <h2 id="call-events-heading" className="font-body text-base font-medium text-black">
          Event log
        </h2>
      </header>
      {timeline.length === 0 ? (
        <p
          className="hairline-edge rounded-card text-body text-gray-warm bg-white px-5 py-4 text-sm"
          data-testid="call-events-empty"
        >
          {events.length === 0
            ? 'No events yet — events stream in as the call progresses.'
            : 'No other call events are available.'}
        </p>
      ) : (
        <ol className="hairline-edge rounded-card flex flex-col gap-0 bg-white">
          {timeline.map((event) => (
            <Entry
              key={event.id}
              when={formatDateTime(event.timestamp)}
              title={eventLabel(event.eventType)}
              type={event.eventType}
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
  type,
  body,
}: {
  readonly when: string;
  readonly title: string;
  readonly type: string;
  readonly body: string;
}): React.ReactElement {
  return (
    <li className="border-border-subtle grid grid-cols-1 gap-2 border-b px-5 py-4 last:border-b-0 sm:grid-cols-[140px_1fr] sm:gap-6">
      <span className="text-caption text-gray-warm uppercase tabular-nums tracking-[0.12em]">
        {when}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-body break-words text-sm font-medium text-black">{title}</span>
        <span className="text-gray-warm break-words font-mono text-xs">{type}</span>
        <span className="text-body text-gray-warm break-words text-sm">{body}</span>
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

const EVENT_LABELS: Readonly<Record<string, string>> = {
  'call.started': 'Call started',
  'webhook.call.started': 'Call started',
  'call.ended': 'Call ended',
  'webhook.call.ended': 'Call ended',
  'call.error': 'Call problem reported',
  'call.cancel.requested': 'Cancellation requested',
  'webhook.call.transcript': 'Transcript update',
};

function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? 'Call update';
}

/**
 * The CallEvent payload is unstructured `{ [k: string]: unknown }` —
 * by design, since payer-specific events carry varied keys. Render a
 * readable message from named display fields. Other metadata stays out of
 * the UI; transcript content is rendered separately by its source selector.
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
          : 'Event recorded.';
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

'use client';

import type { paths } from '@dentabill/api-sdk/types';
import { useQuery } from '@tanstack/react-query';
import {
  Check,
  CircleCheck,
  CircleHelp,
  CircleX,
  Clock,
  Copy,
  type LucideIcon,
} from 'lucide-react';
import * as React from 'react';

import { useDentaBillApi } from '../../../lib/api-client.js';
import { formatDuration } from '../../../lib/calls/call-insights.js';

type SavedSummary =
  paths['/v1/calls/{id}/summary']['get']['responses'][200]['content']['application/json'];

const nextActionLabels: Record<SavedSummary['nextAction'], string> = {
  RESUBMIT: 'Resubmit the claim',
  APPEAL: 'Appeal the decision',
  SUBMIT_DOCS: 'Submit supporting documents',
  CALL_BACK: 'Call back',
  WRITE_OFF: 'Review a write-off',
  RESOLVED: 'Marked resolved in the summary',
  MANUAL_REVIEW: 'Review manually',
};

type Tone = 'warning' | 'success' | 'danger' | 'neutral';
const toneClasses: Record<Tone, string> = {
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-gray-light text-black',
};
const toneIcons: Record<Tone, LucideIcon> = {
  warning: Clock,
  success: CircleCheck,
  danger: CircleX,
  neutral: CircleHelp,
};

/** The payer-reported outcome as a person would say it; unknown values stay verbatim. */
function outcome(claimStatus: string): { readonly label: string; readonly tone: Tone } {
  switch (claimStatus.toLowerCase()) {
    case 'pending':
      return { label: 'Pending review', tone: 'warning' };
    case 'paid':
      return { label: 'Paid', tone: 'success' };
    case 'approved':
      return { label: 'Approved', tone: 'success' };
    case 'denied':
      return { label: 'Denied', tone: 'danger' };
    default:
      return { label: claimStatus.replaceAll('_', ' '), tone: 'neutral' };
  }
}

export function SavedCallSummary({
  callId,
  summaryId,
  scope,
  durationSeconds = null,
  holdTimeSeconds = null,
  recordedNextStep = null,
}: {
  readonly callId: string;
  readonly summaryId: string;
  readonly scope: string;
  readonly durationSeconds?: number | null;
  readonly holdTimeSeconds?: number | null;
  /** Next step the call recorded on its end event, shown in the payer's terms. */
  readonly recordedNextStep?: string | null;
}): React.ReactElement {
  const { client, withAuthHeaders } = useDentaBillApi();
  const query = useQuery({
    queryKey: ['call-saved-summary', scope, summaryId],
    retry: false,
    throwOnError: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<SavedSummary> => {
      try {
        const result = await client.GET('/v1/calls/{id}/summary', {
          params: { path: { id: callId } },
          headers: await withAuthHeaders(),
          signal,
        });
        if (!result.response.ok || result.data?.callId !== callId || result.data.id !== summaryId)
          throw new Error();
        return result.data;
      } catch {
        throw new Error('The saved call summary could not be loaded. Reload it to try again.');
      }
    },
  });
  const summary = query.data;
  const result = summary ? outcome(summary.claimStatus) : null;
  const ToneIcon = result ? toneIcons[result.tone] : null;
  const suggested = summary ? nextActionLabels[summary.nextAction] : null;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {query.isPending ? (
        <p role="status" className="text-gray-warm text-sm">
          Loading the saved call summary…
        </p>
      ) : null}
      {summary && result && ToneIcon ? (
        <>
          <p
            className={`rounded-pill inline-flex items-center gap-2 self-start px-3.5 py-1.5 text-[15px] font-semibold ${toneClasses[result.tone]}`}
          >
            <ToneIcon size={18} aria-hidden className="shrink-0" />
            <span className="sr-only">Reported outcome: </span>
            <span>{result.label}</span>
          </p>
          <div className="flex min-w-0 flex-col gap-1.5">
            <h3 className="text-gray-warm text-sm font-medium">Next step</h3>
            <p className="font-display max-w-[40rem] break-words text-[28px] font-normal leading-[1.15] tracking-[-0.01em] text-black sm:text-[36px]">
              {recordedNextStep ?? suggested}
            </p>
            {recordedNextStep ? (
              <p className="text-gray-dark text-sm">Suggested action: {suggested}</p>
            ) : null}
            {summary.callbackDate ? (
              <p className="text-gray-dark text-sm">
                Call back on{' '}
                <time dateTime={summary.callbackDate}>
                  {new Date(summary.callbackDate).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </time>
              </p>
            ) : null}
          </div>
          <dl className="border-border-subtle grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-4 md:grid-cols-4">
            <div className="col-span-2 flex min-w-0 flex-col gap-1 md:col-span-1">
              <dt className="text-gray-warm text-xs font-medium">Reference number</dt>
              <dd className="flex min-w-0 items-center gap-1">
                {summary.referenceNumber ? (
                  <>
                    <span className="break-all font-mono text-[15px] font-medium text-black">
                      {summary.referenceNumber}
                    </span>
                    <CopyButton value={summary.referenceNumber} />
                  </>
                ) : (
                  <span className="text-[15px] font-medium text-black">Not recorded</span>
                )}
              </dd>
            </div>
            <SummaryField label="Representative" value={summary.repName ?? 'Not recorded'} />
            {durationSeconds !== null ? (
              <SummaryField label="Call duration" value={formatDuration(durationSeconds)} />
            ) : null}
            {holdTimeSeconds !== null ? (
              <SummaryField label="Hold time" value={formatDuration(holdTimeSeconds)} />
            ) : null}
            {summary.denialReason ? (
              <SummaryField label="Reported denial reason" value={summary.denialReason} wide />
            ) : null}
            {summary.denialCode ? (
              <SummaryField label="Reported denial code" value={summary.denialCode} />
            ) : null}
          </dl>
          {summary.notes ? (
            <p className="text-gray-warm max-w-prose whitespace-pre-wrap break-words text-[13px] leading-5">
              {summary.notes}
            </p>
          ) : null}
        </>
      ) : null}
      {query.isError ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-danger text-sm">
            {query.error.message}
          </p>
          <button
            type="button"
            disabled={query.isFetching}
            onClick={() => {
              void query.refetch();
            }}
            className="border-border-light rounded-standard hover:bg-gray-light focus-visible:outline-brand min-h-11 border px-4 py-2 text-sm font-medium text-black transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          >
            {query.isFetching ? 'Reloading summary…' : 'Reload saved summary'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CopyButton({ value }: { readonly value: string }): React.ReactElement {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={copied ? 'Reference number copied' : 'Copy reference number'}
      title={copied ? 'Copied' : 'Copy reference number'}
      className="text-gray-warm hover:bg-gray-light focus-visible:outline-brand rounded-standard inline-flex h-9 w-9 shrink-0 items-center justify-center transition-colors hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
          },
          () => undefined,
        );
      }}
    >
      {copied ? (
        <Check size={16} aria-hidden className="text-success" />
      ) : (
        <Copy size={16} aria-hidden />
      )}
    </button>
  );
}

function SummaryField({
  label,
  value,
  wide,
}: {
  readonly label: string;
  readonly value: string;
  readonly wide?: boolean;
}): React.ReactElement {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${wide ? 'col-span-2' : ''}`}>
      <dt className="text-gray-warm text-xs font-medium">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-[15px] font-medium text-black">
        {value}
      </dd>
    </div>
  );
}

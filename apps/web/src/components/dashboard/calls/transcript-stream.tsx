'use client';

import * as React from 'react';

import {
  useCallEventStream,
  type CallStreamEvent,
  type CallStreamStatus,
} from '../../../lib/calls/use-call-event-stream.js';

const SSE_LIVE_ENABLED =
  process.env.NEXT_PUBLIC_SSE_LIVE_TRANSCRIPT_ENABLED === 'true' ||
  process.env.NEXT_PUBLIC_SSE_LIVE_TRANSCRIPT_ENABLED === '1';

interface Props {
  readonly callId: string;
  readonly bearerToken?: string | null;
  readonly baseUrl?: string;
}

function statusLabel(status: CallStreamStatus): string {
  switch (status) {
    case 'idle':
      return 'Polling fallback';
    case 'connecting':
      return 'Connecting…';
    case 'replaying':
      return 'Replaying transcript…';
    case 'open':
      return 'Live';
    case 'closed':
      return 'Disconnected';
  }
}

function transcriptText(evt: CallStreamEvent): string | null {
  const data = evt.data as { text?: unknown; transcript?: unknown };
  if (typeof data.text === 'string') return data.text;
  if (typeof data.transcript === 'string') return data.transcript;
  return null;
}

export function TranscriptStream({ callId, bearerToken, baseUrl }: Props): React.ReactElement {
  const enabled = SSE_LIVE_ENABLED && callId.length > 0;
  const { events, status, reconnect } = useCallEventStream({
    callId,
    enabled,
    ...(bearerToken !== undefined ? { bearerToken } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  });

  const transcriptRows = events
    .map((evt) => ({ id: evt.id, text: transcriptText(evt), eventType: evt.eventType }))
    .filter((row): row is { id: string; text: string; eventType: string } => row.text !== null);

  return (
    <section
      aria-label="Live call transcript"
      className="hairline-edge rounded-card flex flex-col gap-3 bg-white p-6"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-body text-gray-dark font-medium">Transcript</h3>
        <span
          aria-live="polite"
          className="text-caption text-gray-warm uppercase tracking-[0.12em]"
          data-testid="transcript-stream-status"
        >
          {statusLabel(status)}
        </span>
      </header>

      {enabled ? (
        transcriptRows.length === 0 ? (
          <p className="text-caption text-gray-warm">Waiting for transcript turns…</p>
        ) : (
          <ol aria-live="polite" className="flex flex-col gap-2">
            {transcriptRows.map((row) => (
              <li key={row.id} className="text-body text-gray-dark">
                <span className="text-caption text-gray-warm pr-2 font-mono">
                  {row.eventType.replace('webhook.', '')}
                </span>
                {row.text}
              </li>
            ))}
          </ol>
        )
      ) : (
        <p className="text-caption text-gray-warm">
          Live transcript is disabled. Enable{' '}
          <span className="font-mono">NEXT_PUBLIC_SSE_LIVE_TRANSCRIPT_ENABLED</span> to stream.
        </p>
      )}

      {status === 'closed' ? (
        <button
          type="button"
          onClick={reconnect}
          className="text-caption text-gray-dark hairline-edge rounded-card bg-warm-stone/30 self-start px-3 py-2"
        >
          Reconnect
        </button>
      ) : null}
    </section>
  );
}

'use client';

import { selectCallTranscript, type TranscriptSpeaker } from '@dentabill/types';
import * as React from 'react';

import {
  useCallEventStream,
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

const SPEAKER_LABEL: Record<TranscriptSpeaker, string> = {
  agent: 'DentaBill agent',
  remote: 'Remote speaker (payer or IVR)',
  representative: 'Remote speaker (payer or IVR)',
  system: 'System / IVR',
  source: 'Source transcript',
};

export function TranscriptStream({ callId, bearerToken, baseUrl }: Props): React.ReactElement {
  const enabled = SSE_LIVE_ENABLED && callId.length > 0;
  const { events, status, reconnect } = useCallEventStream({
    callId,
    enabled,
    ...(bearerToken !== undefined ? { bearerToken } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  });

  const transcript = selectCallTranscript(events);
  const transcriptRows = transcript.turns.map((turn) => ({
    id: turn.id,
    text: turn.text,
    speaker: turn.role,
  }));

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

      {enabled && transcript.kind === 'provisional' ? (
        <p role="note" className="text-caption text-gray-warm">
          Provisional transcript snapshot; final transcript is not yet available.
        </p>
      ) : null}

      {enabled ? (
        transcriptRows.length === 0 ? (
          <p className="text-caption text-gray-warm">
            {transcript.kind === 'final'
              ? 'The final transcript is empty.'
              : 'Waiting for transcript turns…'}
          </p>
        ) : (
          <ol aria-live="polite" className="flex flex-col gap-3">
            {transcriptRows.map((row) => (
              <li
                key={row.id}
                data-speaker={row.speaker}
                className={
                  row.speaker === 'system'
                    ? 'flex flex-col gap-1'
                    : row.speaker === 'agent'
                      ? 'rounded-card bg-warm-stone/30 flex flex-col gap-1 px-3 py-2'
                      : 'flex flex-col gap-1 px-3 py-2'
                }
              >
                <span className="text-caption text-gray-warm uppercase tracking-[0.12em]">
                  {SPEAKER_LABEL[row.speaker]}
                </span>
                <span
                  className={
                    row.speaker === 'system'
                      ? 'text-caption text-gray-warm'
                      : 'text-body text-gray-dark whitespace-pre-wrap'
                  }
                >
                  {row.text}
                </span>
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

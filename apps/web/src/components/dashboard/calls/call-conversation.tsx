'use client';

import { selectCallTranscript, type TranscriptSpeaker } from '@dentabill/types';
import * as React from 'react';

import type { CallEvent } from '../../../lib/calls/types.js';

const speakerLabels: Record<TranscriptSpeaker, string> = {
  agent: 'DentaBill agent',
  remote: 'Remote speaker (payer or IVR)',
  representative: 'Payer representative',
  system: 'System / IVR',
  source: 'Source transcript',
};

export function CallConversation({
  events,
}: {
  readonly events: readonly CallEvent[];
}): React.ReactElement | null {
  const transcript = selectCallTranscript(events);
  if (transcript.kind === 'unavailable') return null;
  return (
    <section
      aria-labelledby="call-conversation-heading"
      className="hairline-edge rounded-card flex flex-col gap-4 bg-white p-6"
    >
      <div>
        <h2 id="call-conversation-heading" className="text-xl font-medium text-black">
          Conversation
        </h2>
        {transcript.kind === 'provisional' ? (
          <p className="text-gray-warm mt-2 text-sm">
            Provisional transcript. The final transcript is not yet available.
          </p>
        ) : null}
      </div>
      {transcript.turns.length === 0 ? (
        <p className="text-gray-warm text-sm">
          {transcript.kind === 'final'
            ? 'The final transcript is empty.'
            : 'No readable transcript turns are available.'}
        </p>
      ) : (
        <ol className="divide-border-subtle flex flex-col divide-y">
          {transcript.turns.map((turn) => (
            <li key={turn.id} className="flex min-w-0 flex-col gap-2 py-4 first:pt-0 last:pb-0">
              <p className="text-sm font-medium text-black">{speakerLabels[turn.role]}</p>
              <p className="text-gray-dark max-w-prose whitespace-pre-wrap break-words text-sm leading-6">
                {turn.text}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

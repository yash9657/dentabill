'use client';

import {
  selectCallTranscript,
  type SelectedTranscriptTurn,
  type TranscriptSpeaker,
} from '@dentabill/types';
import { Grid3x3, Phone } from 'lucide-react';
import * as React from 'react';

import { representativeName } from '../../../lib/calls/call-insights.js';
import { isLiveCallStatus, type CallEvent, type CallStatus } from '../../../lib/calls/types.js';

const speakerLabels: Record<TranscriptSpeaker, string> = {
  agent: 'DentaBill agent',
  remote: 'Remote speaker (payer or IVR)',
  representative: 'Payer representative',
  system: 'System / IVR',
  source: 'Source transcript',
};

export function CallConversation({
  events,
  status,
}: {
  readonly events: readonly CallEvent[];
  readonly status?: CallStatus;
}): React.ReactElement | null {
  const transcript = selectCallTranscript(events);
  const live = status !== undefined && isLiveCallStatus(status);
  const initial = (representativeName(transcript.turns) ?? 'Payer').charAt(0);
  const logRef = React.useRef<HTMLDivElement>(null);
  const turnCount = transcript.turns.length;
  React.useEffect(() => {
    // Keep the newest line in view while the call is live.
    if (live && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [live, turnCount]);
  if (transcript.kind === 'unavailable' && status === undefined) return null;
  return (
    <section
      aria-labelledby="call-conversation-heading"
      className="hairline-edge rounded-card flex min-w-0 flex-col gap-4 bg-white p-5 sm:p-6"
    >
      <div>
        <h2 id="call-conversation-heading" className="text-xl font-medium text-black">
          Conversation
        </h2>
        {live ? (
          <p className="text-gray-dark mt-1 text-sm">Updates as conversation details arrive.</p>
        ) : null}
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
            : live
              ? 'Waiting for the first conversation details. No transcript is available yet.'
              : 'No readable transcript turns are available.'}
        </p>
      ) : (
        /* eslint-disable jsx-a11y/no-noninteractive-tabindex -- The bounded transcript log must be keyboard scrollable. */
        <div
          ref={logRef}
          role="log"
          aria-label="Conversation transcript"
          aria-live={live ? 'polite' : 'off'}
          aria-relevant="additions text"
          tabIndex={0}
          className="focus-visible:outline-brand max-h-[32rem] min-w-0 overflow-y-auto overscroll-contain scroll-smooth focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:scroll-auto"
        >
          <ol className="flex flex-col gap-3 p-0.5">
            {transcript.turns.map((turn) => (
              <ChatTurn key={turn.id} turn={turn} initial={initial} />
            ))}
          </ol>
        </div>
        /* eslint-enable jsx-a11y/no-noninteractive-tabindex */
      )}
    </section>
  );
}

function ChatTurn({
  turn,
  initial,
}: {
  readonly turn: SelectedTranscriptTurn;
  readonly initial: string;
}): React.ReactElement {
  const text = 'whitespace-pre-wrap break-words text-[15px] leading-6';
  if (turn.role === 'system') {
    const Icon = /\b(press|key)\b/i.test(turn.text) ? Grid3x3 : Phone;
    return (
      <li data-speaker={turn.role} className="flex justify-center px-2">
        <p className="bg-gray-light text-gray-dark inline-flex max-w-[min(32rem,100%)] items-start gap-2 rounded-[14px] px-3.5 py-1.5 text-[13px] leading-5">
          <Icon size={14} aria-hidden className="text-gray-warm mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">
            <span className="sr-only">{speakerLabels.system}: </span>
            {turn.text}
          </span>
        </p>
      </li>
    );
  }
  if (turn.role === 'agent') {
    return (
      <li data-speaker={turn.role} className="flex min-w-0 flex-col items-end gap-1 pl-8 sm:pl-16">
        <p className="text-gray-warm text-xs font-medium">{speakerLabels.agent}</p>
        <p
          className={`bg-brand max-w-[34rem] rounded-[18px] rounded-br-md px-4 py-2.5 text-white ${text}`}
        >
          {turn.text}
        </p>
      </li>
    );
  }
  return (
    <li data-speaker={turn.role} className="flex min-w-0 items-end gap-2.5 pr-8 sm:pr-16">
      {turn.role === 'source' ? null : (
        <span
          aria-hidden
          className="bg-warm-stone text-brand mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
        >
          {initial}
        </span>
      )}
      <div className="flex min-w-0 flex-col items-start gap-1">
        <p className="text-gray-warm text-xs font-medium">{speakerLabels[turn.role]}</p>
        <p
          className={`bg-gray-light max-w-[34rem] rounded-[18px] rounded-bl-md px-4 py-2.5 text-black ${text}`}
        >
          {turn.text}
        </p>
      </div>
    </li>
  );
}

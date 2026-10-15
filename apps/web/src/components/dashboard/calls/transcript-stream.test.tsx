import { render, screen } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CallStreamEvent } from '../../../lib/calls/use-call-event-stream.js';

const streamMock = vi.hoisted(() => {
  vi.stubEnv('NEXT_PUBLIC_SSE_LIVE_TRANSCRIPT_ENABLED', 'true');
  return vi.fn();
});
vi.mock('../../../lib/calls/use-call-event-stream.js', () => ({ useCallEventStream: streamMock }));

import { TranscriptStream } from './transcript-stream.js';

function event(
  id: string,
  eventType: string,
  data: Record<string, unknown>,
  second: number,
): CallStreamEvent {
  return {
    id,
    eventType,
    data,
    timestamp: new Date(Date.UTC(2026, 9, 13, 12, 0, second)).toISOString(),
  };
}

function show(events: CallStreamEvent[]): void {
  streamMock.mockReturnValue({ events, status: 'open', reconnect: vi.fn() });
  render(<TranscriptStream callId="synthetic-call" />);
}

beforeEach(() => {
  streamMock.mockReset();
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe('TranscriptStream canonical evidence', () => {
  it('shows only one cumulative snapshot and labels it provisional', () => {
    show([
      event(
        'a',
        'webhook.call.transcript_snapshot',
        { transcript: { text: 'Hello', turns: null } },
        1,
      ),
      event(
        'b',
        'webhook.call.transcript_snapshot',
        { transcript: { text: 'Hello again', turns: null } },
        2,
      ),
      event(
        'c',
        'webhook.call.transcript_snapshot',
        { transcript: { text: 'Hello again', turns: null } },
        3,
      ),
    ]);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Hello again')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Provisional transcript snapshot');
  });

  it('preserves the final source block and ignores later snapshots and tool text', () => {
    const text = '  Agent: Hello\nUser: Please hold.\n';
    show([
      event('final', 'webhook.call.ended', { transcript: { text, turns: null } }, 2),
      event(
        'late',
        'webhook.call.transcript_snapshot',
        { transcript: { text: 'STALE', turns: null } },
        3,
      ),
      event('tool', 'tool.result', { text: 'MODEL OUTPUT' }, 4),
    ]);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Source transcript')).toBeInTheDocument();
    expect(screen.getByText('Agent: Hello User: Please hold.').textContent).toBe(text);
    expect(screen.queryByText('STALE')).not.toBeInTheDocument();
    expect(screen.queryByText('MODEL OUTPUT')).not.toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('does not assert that remote speech came from a human', () => {
    show([
      event(
        'final',
        'webhook.call.ended',
        {
          transcript: {
            text: null,
            turns: [{ role: 'user', text: 'Press one.', startOffsetSeconds: 0 }],
          },
        },
        1,
      ),
    ]);
    expect(screen.getByText('Remote speaker (payer or IVR)')).toBeInTheDocument();
    expect(screen.queryByText('Payer rep')).not.toBeInTheDocument();
  });

  it('shows an explicit empty final transcript instead of synthetic fallback', () => {
    show([
      event('fake', 'call.transcript', { role: 'agent', text: 'FAKE' }, 1),
      event('final', 'webhook.call.ended', { transcript: { text: '', turns: [] } }, 2),
    ]);
    expect(screen.getByText('The final transcript is empty.')).toBeInTheDocument();
    expect(screen.queryByText('FAKE')).not.toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('does not display lifecycle, analysis, or tool text as transcript evidence', () => {
    show([
      event('lifecycle', 'call.started', { text: 'LIFECYCLE' }, 1),
      event('analysis', 'call.analyzed', { transcript: 'GENERATED' }, 2),
      event('tool', 'tool.result', { text: 'TOOL' }, 3),
    ]);
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByText(/LIFECYCLE|GENERATED|TOOL/)).not.toBeInTheDocument();
  });
});

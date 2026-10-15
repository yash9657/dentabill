import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { CallEvent } from '../../../lib/calls/types.js';

import { CallConversation } from './call-conversation.js';

function event(id: string, eventType: string, data: Record<string, unknown>): CallEvent {
  return { id, eventType, data, timestamp: '2026-10-14T12:00:00.000Z' };
}

describe('Call conversation', () => {
  it('shows complete demo turns with speaker labels instead of JSON or truncation', () => {
    const text = `The requested documentation is listed here. ${'Synthetic detail. '.repeat(20)}`;
    render(
      <CallConversation
        events={[
          event('a', 'call.transcript', { role: 'system', text: 'For claim status, press 2.' }),
          event('b', 'call.transcript', { role: 'agent', text: 'I am checking the claim status.' }),
          event('c', 'call.transcript', { role: 'representative', text }),
        ]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Conversation' })).toBeVisible();
    expect(screen.getByText(/System \/ IVR/)).toBeInTheDocument();
    expect(screen.getByText('DentaBill agent')).toBeVisible();
    expect(screen.getByText('Payer representative')).toBeVisible();
    expect(screen.getByText(text.trim())).toBeVisible();
    expect(screen.queryByText(/"role"|"text"/)).not.toBeInTheDocument();
  });

  it('renders IVR prompts as chips, the payer on the left and DentaBill on the right', () => {
    const { container } = render(
      <CallConversation
        events={[
          event('a', 'call.transcript', { role: 'system', text: 'For claim status, press 2.' }),
          event('b', 'call.transcript', { role: 'agent', text: 'Pressing 2 for claim status.' }),
          event('c', 'call.transcript', {
            role: 'user',
            text: 'Provider services, this is Marcus.',
          }),
        ]}
        status="COMPLETED"
      />,
    );
    const rows = [...container.querySelectorAll('li[data-speaker]')];
    expect(rows.map((row) => row.getAttribute('data-speaker'))).toEqual([
      'system',
      'agent',
      'remote',
    ]);
    expect(rows[1]).toHaveClass('items-end');
    expect(screen.getByText('Pressing 2 for claim status.')).toHaveClass('bg-brand', 'text-white');
    // The avatar initial comes from the representative's own introduction.
    expect(rows[2]?.querySelector('[aria-hidden]')).toHaveTextContent(/^M$/);
  });

  it('uses the final source transcript instead of provisional or legacy demo turns', () => {
    render(
      <CallConversation
        events={[
          event('a', 'call.transcript', { role: 'agent', text: 'Superseded demo text' }),
          event('b', 'webhook.call.transcript_snapshot', {
            transcript: { text: 'Provisional source text', turns: null },
          }),
          event('c', 'webhook.call.ended', {
            transcript: {
              text: 'Final source text',
              turns: [{ role: 'user', text: 'Final source text', startOffsetSeconds: 2 }],
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText('Final source text')).toBeVisible();
    expect(screen.getByText('Remote speaker (payer or IVR)')).toBeVisible();
    expect(screen.queryByText(/Superseded|Provisional/)).not.toBeInTheDocument();
    expect(screen.queryByText('Payer representative')).not.toBeInTheDocument();
  });

  it('labels provisional source text without inventing a final conversation', () => {
    render(
      <CallConversation
        events={[
          event('a', 'webhook.call.transcript_snapshot', {
            transcript: { text: 'Partial transcript', turns: null },
          }),
        ]}
      />,
    );
    expect(screen.getByText(/Provisional transcript/)).toBeVisible();
    expect(screen.getByText('Partial transcript')).toBeVisible();
  });

  it('preserves an explicitly empty final transcript without synthetic fallback', () => {
    render(
      <CallConversation
        events={[
          event('a', 'call.transcript', { role: 'agent', text: 'Do not substitute this demo' }),
          event('b', 'webhook.call.ended', { transcript: { text: '', turns: [] } }),
        ]}
      />,
    );
    expect(screen.getByText('The final transcript is empty.')).toBeVisible();
    expect(screen.queryByText(/Do not substitute/)).not.toBeInTheDocument();
  });

  it('shows an honest waiting state for an active call without a transcript', () => {
    render(<CallConversation events={[]} status="NAVIGATING_IVR" />);
    expect(screen.getByRole('heading', { name: 'Conversation' })).toBeVisible();
    expect(screen.getByText(/No transcript is available yet/)).toBeVisible();
    expect(screen.queryByText('Payer representative')).not.toBeInTheDocument();
  });

  it('announces incoming conversation updates only while the call is active', () => {
    const events = [
      event('a', 'call.transcript', { role: 'agent', text: 'Checking the reference.' }),
    ];
    const { rerender } = render(<CallConversation events={events} status="COLLECTING" />);
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('log')).toHaveAttribute('tabindex', '0');
    rerender(<CallConversation events={events} status="COMPLETED" />);
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'off');
    expect(screen.getByText('Checking the reference.')).toBeVisible();
  });

  it('does not turn arbitrary event metadata into conversation content', () => {
    const { container } = render(
      <CallConversation
        events={[event('a', 'call.started', { token: 'PRIVATE_METADATA', text: 'not a turn' })]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CallSummary } from '../../../lib/calls/types.js';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 56,
        size: 56,
        end: (index + 1) * 56,
        key: index,
        lane: 0,
      })),
    getTotalSize: () => count * 56,
  }),
}));

import { CallsTable } from './calls-table.js';

const baseCall: CallSummary = {
  id: 'call_a',
  claimId: 'claim_a',
  retellCallId: 'rcid_a',
  retellAgentId: null,
  status: 'NAVIGATING_IVR',
  attemptNumber: 1,
  ivrNavigated: false,
  humanReached: false,
  holdTimeSeconds: null,
  startedAt: '2026-04-29T10:00:00.000Z',
  endedAt: null,
  durationSeconds: null,
  dlqReason: null,
  cancelRequestedAt: null,
  monitoring: null,
  createdAt: '2026-04-29T10:00:00.000Z',
};

describe('<CallsTable />', () => {
  it('shows an unconfirmed stop alongside the active provider status', () => {
    render(
      <CallsTable
        items={[
          {
            ...baseCall,
            monitoring: {
              deadlineAt: '2026-01-01T00:00:00.000Z',
              nextObservationAt: null,
              stopRequestedAt: '2026-01-01T00:01:00.000Z',
              stopAcknowledgedAt: null,
              reviewRequiredAt: '2026-01-01T00:03:00.000Z',
              lastCheckedAt: null,
              lastErrorCode: 'STOP_CONFIRMATION_EXPIRED',
            },
          },
        ]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={() => undefined}
      />,
    );
    expect(screen.getByLabelText('Status: Navigating IVR. Stop not confirmed')).toBeInTheDocument();
    expect(screen.getByText('Stop not confirmed')).toBeInTheDocument();
  });

  it('renders the empty state when there are no items and no error', () => {
    render(
      <CallsTable
        items={[]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={() => undefined}
      />,
    );
    expect(screen.getByText(/no calls match these filters/i)).toBeInTheDocument();
  });

  it('renders the aria-busy skeleton while loading', () => {
    const { container } = render(
      <CallsTable
        items={[]}
        isLoading
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={() => undefined}
      />,
    );
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('surfaces error state with role=alert', () => {
    render(
      <CallsTable
        items={[]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={() => undefined}
        errorMessage="boom"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/boom/i);
  });

  it('renders one row per call with status, attempt, and links to /dashboard/calls/[id]', () => {
    const items: CallSummary[] = [
      { ...baseCall, id: 'a', status: 'NAVIGATING_IVR', attemptNumber: 1 },
      {
        ...baseCall,
        id: 'b',
        status: 'COMPLETED',
        attemptNumber: 2,
        durationSeconds: 125,
      },
    ];
    render(
      <CallsTable
        items={items}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={() => undefined}
      />,
    );
    expect(screen.getByText('Navigating IVR')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    // Duration formatted as `Mm SSs` for >60s, `Ns` otherwise.
    expect(screen.getByText('2m 05s')).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/dashboard/calls/a');
    expect(links[1]).toHaveAttribute('href', '/dashboard/calls/b');
  });

  it('renders an em-dash for null hold/duration/startedAt', () => {
    render(
      <CallsTable
        items={[
          { ...baseCall, id: 'a', startedAt: null, holdTimeSeconds: null, durationSeconds: null },
        ]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={() => undefined}
      />,
    );
    // Three "—" appear (started, hold, duration).
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('shows cancellation pending alongside the current active status', () => {
    render(
      <CallsTable
        items={[{ ...baseCall, cancelRequestedAt: '2026-04-29T10:01:00.000Z' }]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={() => undefined}
      />,
    );
    expect(
      screen.getByRole('gridcell', { name: 'Status: Navigating IVR. Cancellation requested' }),
    ).toHaveTextContent('Cancellation requested');
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
  });

  it('shows the terminal outcome after a requested cancellation is confirmed ended', () => {
    render(
      <CallsTable
        items={[
          { ...baseCall, status: 'COMPLETED', cancelRequestedAt: '2026-04-29T10:01:00.000Z' },
        ]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={() => undefined}
      />,
    );
    expect(screen.getByRole('gridcell', { name: 'Status: Completed' })).toBeInTheDocument();
    expect(screen.queryByText('Cancellation requested')).not.toBeInTheDocument();
  });
});

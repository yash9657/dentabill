import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OverviewActivity } from './overview-activity.js';

const mocks = vi.hoisted(() => ({ claims: vi.fn(), calls: vi.fn(), retry: vi.fn() }));
vi.mock('../../lib/claims/use-claims-list.js', () => ({ useClaimsList: mocks.claims }));
vi.mock('../../lib/calls/use-calls-list.js', () => ({ useCallsList: mocks.calls }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claims.mockReturnValue({
    data: { pages: [{ items: [] }] },
    isPending: false,
    isError: false,
  });
  mocks.calls.mockReturnValue({
    data: { pages: [{ items: [] }] },
    isPending: false,
    isError: false,
  });
});

describe('Overview activity', () => {
  it('distinguishes loading from an empty account', () => {
    mocks.claims.mockReturnValue({ isPending: true });
    render(<OverviewActivity />);
    expect(screen.getByRole('region', { name: 'Loading claims' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByText('Start with your open claims')).not.toBeInTheDocument();
    expect(screen.getByText('Your call history starts here')).toBeInTheDocument();
  });

  it('retries a failed request without showing an empty success state', async () => {
    mocks.claims.mockReturnValue({ isError: true, refetch: mocks.retry });
    render(<OverviewActivity />);
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load claims');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(screen.queryByText('Start with your open claims')).not.toBeInTheDocument();
  });

  it('shows real records and links to their detail pages, limited to five per section', () => {
    mocks.claims.mockReturnValue({
      data: {
        pages: [
          {
            items: Array.from({ length: 6 }, (_, i) => ({
              id: `claim-${String(i)}`,
              claimNumber: `CLAIM-${String(i)}`,
              claimAmount: '840.00',
              payerCode: 'DELTA_DENTAL_PPO',
              status: 'PENDING',
            })),
          },
        ],
      },
    });
    mocks.calls.mockReturnValue({
      data: { pages: [{ items: [{ id: 'call-1', status: 'COMPLETED', attemptNumber: 2 }] }] },
    });
    render(<OverviewActivity />);
    expect(screen.getByRole('link', { name: /CLAIM-0/ })).toHaveAttribute(
      'href',
      '/dashboard/claims/claim-0',
    );
    expect(screen.queryByText('CLAIM-5')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Attempt 2/ })).toHaveAttribute(
      'href',
      '/dashboard/calls/call-1',
    );
  });
});

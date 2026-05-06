import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Claim } from '../../../lib/claims/types.js';

// jsdom does not measure layout, so the virtualiser sees a 0-height
// scroll element and renders zero rows. The mock returns every row in
// virtualItems so the table renders deterministically under test.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 60,
        size: 60,
        end: (index + 1) * 60,
        key: index,
        lane: 0,
      })),
    getTotalSize: () => count * 60,
  }),
}));

// The CallNowPill children use the SDK; stub the api-client so the
// table test stays focused on row rendering and isn't dragged into
// Clerk + TanStack Query setup. Without this, every row that renders a
// PENDING-status pill would trip Clerk's `<ClerkProvider />` guard.
vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { POST: vi.fn(), GET: vi.fn(), PATCH: vi.fn() },
    withAuthHeaders: async () => ({}),
  }),
}));

import { ClaimsTable } from './claims-table.js';

function withProviders(ui: React.ReactElement): React.ReactElement {
  return <QueryProvider client={createDentaBillQueryClient()}>{ui}</QueryProvider>;
}

const baseClaim: Claim = {
  id: 'claim_a',
  organizationId: 'org_a',
  patientDOBHash: 'hash_a',
  patientDOBLast4: '1990',
  claimNumber: 'CL-001',
  cdtCodes: ['D2740'],
  claimAmount: '420.00',
  payerCode: 'DELTA_DENTAL_PPO',
  serviceDate: '2026-01-15T00:00:00.000Z',
  submittedDate: null,
  status: 'PENDING',
  priority: 100,
  retryCount: 0,
  maxRetries: 3,
  createdAt: '2026-01-15T00:00:00.000Z',
  updatedAt: '2026-01-15T00:00:00.000Z',
};

describe('<ClaimsTable />', () => {
  it('renders the empty state when there are no items and no error', () => {
    render(
      <ClaimsTable
        items={[]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={() => undefined}
      />,
    );
    expect(screen.getByText(/no claims match these filters/i)).toBeInTheDocument();
  });

  it('renders an aria-busy skeleton while loading', () => {
    const { container } = render(
      <ClaimsTable
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
      <ClaimsTable
        items={[]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={() => undefined}
        errorMessage="boom"
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/boom/i);
  });

  it('renders a row per claim with claim number, payer, amount, status', () => {
    const items: Claim[] = [
      { ...baseClaim, id: 'a', claimNumber: 'CL-A', status: 'PENDING' },
      { ...baseClaim, id: 'b', claimNumber: 'CL-B', status: 'CALLING', payerCode: 'CIGNA_DENTAL' },
    ];
    render(
      withProviders(
        <ClaimsTable
          items={items}
          isLoading={false}
          isFetchingMore={false}
          hasMore={false}
          onReachEnd={() => undefined}
        />,
      ),
    );
    expect(screen.getByText('CL-A')).toBeInTheDocument();
    expect(screen.getByText('CL-B')).toBeInTheDocument();
    expect(screen.getByText('Delta Dental PPO')).toBeInTheDocument();
    expect(screen.getByText('Cigna Dental')).toBeInTheDocument();
    // "Calling" appears in two cells per row when CALLING — once in
    // the status column (gridcell with the StatusDot), once in the
    // action column (the NoActionBadge). Both are intended.
    expect(screen.getByLabelText(/Status: Calling/)).toBeInTheDocument();
    expect(screen.getByTestId('call-now-pill-no-action')).toHaveTextContent(/Calling/);
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/dashboard/claims/a');
    expect(links[1]).toHaveAttribute('href', '/dashboard/claims/b');
  });

  it('renders a "Call now" button on PENDING rows but not on CALLING rows (P3-T22)', () => {
    const items: Claim[] = [
      { ...baseClaim, id: 'a', claimNumber: 'CL-A', status: 'PENDING' },
      { ...baseClaim, id: 'b', claimNumber: 'CL-B', status: 'CALLING' },
    ];
    render(
      withProviders(
        <ClaimsTable
          items={items}
          isLoading={false}
          isFetchingMore={false}
          hasMore={false}
          onReachEnd={() => undefined}
        />,
      ),
    );
    const buttons = screen.getAllByRole('button', { name: /Call now for claim/ });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute('aria-label', 'Call now for claim a');
  });

  it('does not call onReachEnd when there are no more pages', () => {
    const onReachEnd = vi.fn();
    render(
      withProviders(
        <ClaimsTable
          items={[{ ...baseClaim, id: 'a', claimNumber: 'CL-A' }]}
          isLoading={false}
          isFetchingMore={false}
          hasMore={false}
          onReachEnd={onReachEnd}
        />,
      ),
    );
    expect(onReachEnd).not.toHaveBeenCalled();
  });
});

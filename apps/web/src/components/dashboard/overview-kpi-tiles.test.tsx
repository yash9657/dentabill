import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const getMock = vi.fn();

vi.mock('../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { GET: getMock, POST: vi.fn(), PATCH: vi.fn() },
    withAuthHeaders: async () => ({}),
  }),
}));

import { OverviewKpiTiles } from './overview-kpi-tiles.js';

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_dummy');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  getMock.mockReset();
});

function renderTiles(): void {
  render(
    <QueryProvider client={createDentaBillQueryClient()}>
      <OverviewKpiTiles />
    </QueryProvider>,
  );
}

describe('<OverviewKpiTiles /> (P3-T25)', () => {
  it('renders em-dash placeholders before the first response', () => {
    let resolve: ((v: unknown) => void) | undefined;
    getMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    renderTiles();
    // Four "—" placeholders rendered while pending.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    resolve?.({
      data: {
        callsToday: 0,
        queueDepth: 0,
        avgCallSeconds: null,
        verifiedPayments: {
          status: 'unavailable',
          reason: 'PAYMENT_LEDGER_NOT_IMPLEMENTED',
          amountCents: null,
        },
      },
    });
  });

  it('formats the four metrics correctly when /v1/calls/stats responds', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        callsToday: 17,
        queueDepth: 4,
        avgCallSeconds: 95,
        verifiedPayments: {
          status: 'unavailable',
          reason: 'PAYMENT_LEDGER_NOT_IMPLEMENTED',
          amountCents: null,
        },
      },
    });
    renderTiles();
    await waitFor(() => expect(screen.getByText('17')).toBeInTheDocument());
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText(/1m 35s/)).toBeInTheDocument();
    expect(screen.getByText('Verified payments')).toBeInTheDocument();
    expect(screen.getByText('Unavailable: no reconciliation')).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Recovered/)).not.toBeInTheDocument();
  });

  it('renders an em-dash for null avgCallSeconds (no calls in last 7 days)', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        callsToday: 0,
        queueDepth: 0,
        avgCallSeconds: null,
        verifiedPayments: {
          status: 'unavailable',
          reason: 'PAYMENT_LEDGER_NOT_IMPLEMENTED',
          amountCents: null,
        },
      },
    });
    renderTiles();
    await waitFor(() => {
      expect(screen.getByText('Unavailable: no reconciliation')).toBeInTheDocument();
    });
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('rejects the old financial contract instead of rendering an unsupported recovery amount', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        callsToday: 2,
        queueDepth: 0,
        avgCallSeconds: 60,
        recoveredThisWeekCents: 60000,
      },
    });
    renderTiles();
    expect(await screen.findByTestId('overview-kpi-error')).toBeInTheDocument();
    expect(screen.queryByText(/\$600/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Recovered/)).not.toBeInTheDocument();
  });

  it('surfaces a friendly retry message under the strip when the request errors', async () => {
    getMock.mockResolvedValueOnce({
      error: { message: 'temporary upstream blip' },
    });
    renderTiles();
    expect(await screen.findByTestId('overview-kpi-error')).toHaveTextContent(
      /temporary upstream blip/,
    );
  });

  it('displays em-dash placeholders when the request fails (error state)', async () => {
    getMock.mockResolvedValueOnce({
      error: { message: 'Service temporarily unavailable' },
    });
    renderTiles();
    // Error state should still show em-dashes (no data to display)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    // Error message visible
    expect(await screen.findByTestId('overview-kpi-error')).toBeInTheDocument();
  });

  it('does not render Phase-related text in the component', () => {
    getMock.mockResolvedValueOnce({
      data: {
        callsToday: 1,
        queueDepth: 2,
        avgCallSeconds: 45,
        verifiedPayments: {
          status: 'unavailable',
          reason: 'PAYMENT_LEDGER_NOT_IMPLEMENTED',
          amountCents: null,
        },
      },
    });
    renderTiles();
    // Verify no "Phase" strings appear in the rendered output
    expect(screen.queryByText(/Phase [0-9]/i)).not.toBeInTheDocument();
  });
});

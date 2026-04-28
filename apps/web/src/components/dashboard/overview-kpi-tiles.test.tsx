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
        recoveredThisWeekCents: 0,
      },
    });
  });

  it('formats the four metrics correctly when /v1/calls/stats responds', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        callsToday: 17,
        queueDepth: 4,
        avgCallSeconds: 95,
        recoveredThisWeekCents: 124350, // $1,243.50
      },
    });
    renderTiles();
    await waitFor(() => expect(screen.getByText('17')).toBeInTheDocument());
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText(/1m 35s/)).toBeInTheDocument();
    expect(screen.getByText(/\$1,244/)).toBeInTheDocument();
  });

  it('renders an em-dash for null avgCallSeconds (no calls in last 7 days)', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        callsToday: 0,
        queueDepth: 0,
        avgCallSeconds: null,
        recoveredThisWeekCents: 0,
      },
    });
    renderTiles();
    await waitFor(() => {
      // After data lands, the avg tile should still show the dash but the
      // recovered tile resolves to a $0-style currency string (Intl USD renders
      // "$0" with no fraction since `maximumFractionDigits: 0`).
      expect(screen.getByText(/\$0/)).toBeInTheDocument();
    });
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
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
});

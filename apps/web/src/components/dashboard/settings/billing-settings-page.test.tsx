import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UsageSettingsPage } from './usage-settings-page.js';

const getMock = vi.fn();

vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { GET: getMock },
    withAuthHeaders: async () => ({}),
  }),
}));

function renderPage(): void {
  render(
    <QueryProvider client={createDentaBillQueryClient()}>
      <UsageSettingsPage />
    </QueryProvider>,
  );
}

describe('UsageSettingsPage (P5-T7 G-D4)', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('renders aggregate totals and a usage row when /v1/billing/usage returns data', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === '/v1/me') {
        return Promise.resolve({
          data: {
            user: { id: 'u1', email: 'a@b.co', name: null, role: 'OWNER' },
            organization: { id: 'org1', name: 'Acme', npi: '1234567890', plan: 'FREE' },
          },
        });
      }
      if (path === '/v1/billing/usage') {
        return Promise.resolve({
          data: {
            currentMonthCents: 12345,
            last90DaysCents: 67890,
            items: [
              {
                id: 'rec_1',
                claimId: 'claim_xyz',
                billingPeriodStart: '2026-05-01T00:00:00.000Z',
                amountCents: 12345,
                stripeUsageRecordId: null,
                postedAt: null,
                createdAt: '2026-05-01T01:00:00.000Z',
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: undefined });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByText('$123.45').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('$678.90')).toBeInTheDocument();
    expect(screen.getByText('claim_xyz')).toBeInTheDocument();
  });

  it('renders the empty-state copy when no usage records exist', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === '/v1/me') {
        return Promise.resolve({
          data: {
            user: { id: 'u1', email: 'a@b.co', name: null, role: 'OWNER' },
            organization: { id: 'org1', name: 'Acme', npi: '1234567890', plan: 'FREE' },
          },
        });
      }
      if (path === '/v1/billing/usage') {
        return Promise.resolve({
          data: { currentMonthCents: 0, last90DaysCents: 0, items: [] },
        });
      }
      return Promise.resolve({ data: undefined });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/No usage yet/)).toBeInTheDocument();
    });
  });

  it('does not render Stripe portal button (unlike legacy billing page)', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === '/v1/me') {
        return Promise.resolve({
          data: {
            user: { id: 'u1', email: 'a@b.co', name: null, role: 'OWNER' },
            organization: { id: 'org1', name: 'Acme', npi: '1234567890', plan: 'FREE' },
          },
        });
      }
      if (path === '/v1/billing/usage') {
        return Promise.resolve({
          data: { currentMonthCents: 0, last90DaysCents: 0, items: [] },
        });
      }
      return Promise.resolve({ data: undefined });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /manage billing/i })).not.toBeInTheDocument();
    });
  });
});

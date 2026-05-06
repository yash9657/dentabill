import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingSettingsPage } from './billing-settings-page.js';

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { GET: getMock, POST: postMock, PATCH: vi.fn() },
    withAuthHeaders: async () => ({}),
  }),
}));

const originalLocation = window.location;
const assignMock = vi.fn();

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  assignMock.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, assign: assignMock },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
});

function renderPage(): { user: ReturnType<typeof userEvent.setup> } {
  const user = userEvent.setup();
  render(
    <QueryProvider client={createDentaBillQueryClient()}>
      <BillingSettingsPage />
    </QueryProvider>,
  );
  return { user };
}

describe('BillingSettingsPage (P4-T3E)', () => {
  it('renders aggregate totals and a usage row when /v1/billing/usage returns data; OWNER sees enabled portal CTA', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === '/v1/me') {
        return Promise.resolve({
          data: {
            user: { id: 'u1', email: 'a@b.co', name: null, role: 'OWNER' },
            organization: { id: 'org1', name: 'Acme', npi: '1234567890', plan: 'TRIAL' },
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
    const cta = screen.getByRole('button', { name: /Manage billing/ });
    expect(cta).toBeEnabled();
  });

  it('opens the Stripe Customer Portal session URL when OWNER clicks Manage billing', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === '/v1/me') {
        return Promise.resolve({
          data: {
            user: { id: 'u1', email: 'a@b.co', name: null, role: 'OWNER' },
            organization: { id: 'org1', name: 'Acme', npi: '1234567890', plan: 'TRIAL' },
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
    postMock.mockResolvedValue({
      data: { url: 'https://billing.stripe.com/p/session_stub_cus_123' },
    });

    const { user } = renderPage();

    const cta = await screen.findByRole('button', { name: /Manage billing/ });
    await user.click(cta);

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/v1/billing/portal', expect.any(Object));
    });
    expect(assignMock).toHaveBeenCalledWith('https://billing.stripe.com/p/session_stub_cus_123');
  });

  it('disables the portal CTA for BILLING_STAFF (read-only role)', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === '/v1/me') {
        return Promise.resolve({
          data: {
            user: { id: 'u1', email: 'a@b.co', name: null, role: 'BILLING_STAFF' },
            organization: { id: 'org1', name: 'Acme', npi: '1234567890', plan: 'TRIAL' },
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

    const message = await screen.findByText(/Your role is read-only here/);
    expect(message).toBeInTheDocument();
    const cta = screen.getByRole('button', { name: /Manage billing/ });
    expect(cta).toBeDisabled();
  });

  it('renders the empty-state copy when no usage records exist', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === '/v1/me') {
        return Promise.resolve({
          data: {
            user: { id: 'u1', email: 'a@b.co', name: null, role: 'OWNER' },
            organization: { id: 'org1', name: 'Acme', npi: '1234567890', plan: 'TRIAL' },
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

  it('surfaces the API error message when /v1/billing/portal fails', async () => {
    getMock.mockImplementation((path: string) => {
      if (path === '/v1/me') {
        return Promise.resolve({
          data: {
            user: { id: 'u1', email: 'a@b.co', name: null, role: 'OWNER' },
            organization: { id: 'org1', name: 'Acme', npi: '1234567890', plan: 'TRIAL' },
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
    postMock.mockResolvedValue({
      error: { message: 'No Stripe customer is associated.', code: 'NOT_FOUND' },
    });

    const { user } = renderPage();
    const cta = await screen.findByRole('button', { name: /Manage billing/ });
    await user.click(cta);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/No Stripe customer/);
    });
    expect(assignMock).not.toHaveBeenCalled();
  });
});

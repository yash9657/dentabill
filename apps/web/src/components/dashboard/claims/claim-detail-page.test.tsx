import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaimDetailPage } from './claim-detail-page.js';

const getMock = vi.fn();

vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { GET: getMock, PATCH: vi.fn() },
    withAuthHeaders: async () => ({}),
  }),
}));

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_dummy');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  getMock.mockReset();
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

describe('<ClaimDetailPage />', () => {
  it('renders the claim summary card from the SDK response', async () => {
    getMock.mockResolvedValue({
      data: {
        id: 'claim_a',
        organizationId: 'org_a',
        patientDOBHash: 'h',
        patientDOBLast4: '1990',
        claimNumber: 'CL-DETAIL-99',
        cdtCodes: ['D2740'],
        claimAmount: '420.00',
        payerCode: 'CIGNA_DENTAL',
        serviceDate: '2026-01-15T00:00:00.000Z',
        submittedDate: null,
        status: 'IN_QUEUE',
        priority: 75,
        retryCount: 0,
        maxRetries: 3,
        createdAt: '2026-01-15T00:00:00.000Z',
        updatedAt: '2026-01-16T00:00:00.000Z',
      },
    });
    render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <ClaimDetailPage id="claim_a" />
      </QueryProvider>,
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'CL-DETAIL-99' })).toBeInTheDocument();
    });
    expect(screen.getAllByText(/cigna dental/i).length).toBeGreaterThanOrEqual(1);
    // The status label appears in the SummaryCard. The dialog (closed) also
    // contains a "In queue" radio in its DOM, so scope to the summary's <dd>.
    const statusValue = screen
      .getAllByText('In queue')
      .find((el) => el.tagName === 'DD' || el.parentElement?.tagName === 'DD');
    expect(statusValue).toBeDefined();
    expect(screen.getByRole('button', { name: /change status/i })).toBeEnabled();
  });

  it('shows an error alert when the claim cannot be loaded', async () => {
    getMock.mockResolvedValue({ error: { message: 'Not found' } });
    render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <ClaimDetailPage id="missing" />
      </QueryProvider>,
    );
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/not found/i);
    });
  });
});

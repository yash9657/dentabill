import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import * as React from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Claim } from '../../../lib/claims/types.js';

import { ClaimStatusDialog } from './claim-status-dialog.js';

const patchMock = vi.fn();

vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { PATCH: patchMock, GET: vi.fn() },
    withAuthHeaders: async () => ({}),
  }),
}));

const baseClaim: Claim = {
  id: 'claim_a',
  organizationId: 'org_a',
  patientDOBHash: 'h',
  patientDOBLast4: '1990',
  claimNumber: 'CL-DETAIL-1',
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

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_dummy');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  patchMock.mockReset();
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

function renderDialog(claim: Claim): { user: ReturnType<typeof userEvent.setup> } {
  const user = userEvent.setup();
  const client = createDentaBillQueryClient();
  render(
    <QueryProvider client={client}>
      <ClaimStatusDialog claim={claim} />
    </QueryProvider>,
  );
  return { user };
}

describe('<ClaimStatusDialog />', () => {
  it('is disabled for terminal claims', () => {
    renderDialog({ ...baseClaim, status: 'RESOLVED' });
    const trigger = screen.getByRole('button', { name: /change status/i });
    expect(trigger).toBeDisabled();
  });

  it('lists only allowed transitions for the current status', async () => {
    const { user } = renderDialog({ ...baseClaim, status: 'PENDING' });
    await user.click(screen.getByRole('button', { name: /change status/i }));
    expect(screen.getByRole('radio', { name: 'In queue' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Manual review' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Written off' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Calling' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Resolved' })).toBeNull();
  });

  it('PATCHes the claim and closes on a successful save', async () => {
    patchMock.mockResolvedValue({ data: { ...baseClaim, status: 'IN_QUEUE' } });
    const { user } = renderDialog({ ...baseClaim, status: 'PENDING' });
    await user.click(screen.getByRole('button', { name: /change status/i }));
    await user.click(screen.getByRole('radio', { name: 'In queue' }));
    await user.click(screen.getByRole('button', { name: /save change/i }));
    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledWith(
        '/v1/claims/{id}',
        expect.objectContaining({
          params: { path: { id: 'claim_a' } },
          body: { status: 'IN_QUEUE' },
        }),
      );
    });
  });

  it('surfaces a friendly error when the server rejects the transition', async () => {
    patchMock.mockResolvedValue({
      error: {
        code: 'INVALID_STATE_TRANSITION',
        message: 'Cannot transition from PENDING to RESOLVED.',
      },
    });
    const { user } = renderDialog({ ...baseClaim, status: 'PENDING' });
    await user.click(screen.getByRole('button', { name: /change status/i }));
    await user.click(screen.getByRole('radio', { name: 'In queue' }));
    await user.click(screen.getByRole('button', { name: /save change/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/cannot transition/i);
    });
  });
});

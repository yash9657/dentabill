import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DetailClaim } from '../../../lib/claims/types.js';

import { ClaimDetailPage } from './claim-detail-page.js';
import { remittanceListFixture } from './claim-remittances.fixtures.js';
import { detailClaimFixture } from './claim-source-details.fixtures.js';

const getMock = vi.fn();
const patchMock = vi.fn();
const auth = vi.hoisted((): { isLoaded: boolean; orgId: string | null; userId: string } => ({
  isLoaded: true,
  orgId: 'org_a',
  userId: 'user_a',
}));
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => auth,
}));

vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { GET: getMock, PATCH: patchMock },
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
  patchMock.mockReset();
  auth.orgId = 'org_a';
  auth.userId = 'user_a';
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

describe('<ClaimDetailPage />', () => {
  it('renders the claim summary card from the SDK response', async () => {
    getMock.mockImplementation(async (path: string) => {
      if (path === '/v1/claims/{id}/remittances')
        return { data: remittanceListFixture(), response: new Response(null, { status: 200 }) };
      if (path === '/v1/claims/{id}/observations')
        return { data: { items: [], publishableCalls: [], nextCursor: null, hasMore: false } };
      if (path === '/v1/claims/{id}/call-recovery')
        return {
          data: { intent: null, canCheck: false, canReview: true, availability: 'AVAILABLE' },
        };
      if (path === '/v1/calls') return { data: { items: [], total: 0, page: 1, pageSize: 50 } };
      return {
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
          sourceDetails: null,
        },
      };
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
    expect(screen.getByText(/No procedure or coverage snapshot was saved/)).toBeInTheDocument();
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

  it('renders the imported snapshot on the actual page and preserves it during shallow status updates', async () => {
    const user = userEvent.setup();
    const claim = detailClaimFixture();
    const { sourceDetails: _sourceDetails, ...shallow } = claim;
    patchMock.mockResolvedValue({ data: { ...shallow, status: 'IN_QUEUE' } });
    let finishRefresh!: (value: { data: DetailClaim }) => void;
    const refresh = new Promise<{ data: DetailClaim }>((resolve) => {
      finishRefresh = resolve;
    });
    let detailReads = 0;
    getMock.mockImplementation(async (path: string) => {
      if (path === '/v1/claims/{id}/remittances')
        return { data: remittanceListFixture(), response: new Response(null, { status: 200 }) };
      if (path === '/v1/claims/{id}/observations')
        return { data: { items: [], publishableCalls: [], nextCursor: null, hasMore: false } };
      if (path === '/v1/claims/{id}/call-recovery')
        return {
          data: { intent: null, canCheck: false, canReview: true, availability: 'AVAILABLE' },
        };
      if (path === '/v1/calls') return { data: { items: [], total: 0, page: 1, pageSize: 50 } };
      detailReads++;
      return detailReads === 1 ? { data: claim } : refresh;
    });
    const client = createDentaBillQueryClient();
    render(
      <QueryProvider client={client}>
        <ClaimDetailPage id="claim_a" />
      </QueryProvider>,
    );
    await screen.findByRole('heading', { name: 'Imported procedures and coverage' });
    expect(
      screen.getByRole('heading', { name: 'SYNTHETIC-DETAIL-99' }).parentElement,
    ).toHaveTextContent('service date Oct 1, 2026');
    expect(screen.getByRole('heading', { name: 'Line 2 · D2391' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change status' }));
    await user.click(screen.getByRole('radio', { name: 'In queue' }));
    await user.click(screen.getByRole('button', { name: 'Save change' }));
    await waitFor(() => {
      expect(detailReads).toBe(2);
    });
    const cached = client.getQueryData<DetailClaim>([
      'claims',
      'detail',
      'claim_a',
      'org_a',
      'user_a',
    ]);
    expect(cached?.status).toBe('IN_QUEUE');
    expect(cached?.sourceDetails).toEqual(claim.sourceDetails);
    expect(
      screen.getByRole('heading', { name: 'Line 2 · D2391', hidden: true }),
    ).toBeInTheDocument();
    await act(async () => {
      finishRefresh({ data: { ...claim, status: 'IN_QUEUE', claimAmount: '500.00' } });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByText(/current claim amount is \$500.00/)).toHaveTextContent(
      'imported billed total remains $420.00',
    );
    expect(screen.getByRole('heading', { name: 'Line 2 · D2391' })).toBeInTheDocument();
  });

  it('hides the old source snapshot immediately when switching organizations', async () => {
    const claim = detailClaimFixture();
    let finishNewOrganization!: (value: { error: { message: string } }) => void;
    const denied = new Promise<{ error: { message: string } }>((resolve) => {
      finishNewOrganization = resolve;
    });
    getMock.mockImplementation(async (path: string) => {
      if (path === '/v1/claims/{id}/remittances')
        return { data: remittanceListFixture(), response: new Response(null, { status: 200 }) };
      if (path === '/v1/claims/{id}') return auth.orgId === 'org_a' ? { data: claim } : denied;
      if (path === '/v1/claims/{id}/observations')
        return { data: { items: [], publishableCalls: [], nextCursor: null, hasMore: false } };
      if (path === '/v1/claims/{id}/call-recovery')
        return {
          data: { intent: null, canCheck: false, canReview: true, availability: 'AVAILABLE' },
        };
      return { data: { items: [], total: 0, page: 1, pageSize: 50 } };
    });
    const client = createDentaBillQueryClient();
    const view = () => (
      <QueryProvider client={client}>
        <ClaimDetailPage id="claim_a" />
      </QueryProvider>
    );
    const rendered = render(view());
    await screen.findByText('source-claim-17');
    auth.orgId = 'org_b';
    rendered.rerender(view());
    expect(screen.queryByText('source-claim-17')).not.toBeInTheDocument();
    await act(async () => {
      finishNewOrganization({ error: { message: 'Not found' } });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found');
    expect(screen.queryByText('source-claim-17')).not.toBeInTheDocument();
  });

  it('loads an onboarded personal session without a Clerk organization and hides it on user switch', async () => {
    auth.orgId = null;
    const claim = detailClaimFixture({ organizationId: 'local_user_a' });
    let finishOtherUser!: (value: { error: { message: string } }) => void;
    const denied = new Promise<{ error: { message: string } }>((resolve) => {
      finishOtherUser = resolve;
    });
    getMock.mockImplementation(async (path: string) => {
      if (path === '/v1/claims/{id}/remittances')
        return { data: remittanceListFixture(), response: new Response(null, { status: 200 }) };
      if (path === '/v1/claims/{id}') return auth.userId === 'user_a' ? { data: claim } : denied;
      if (path === '/v1/claims/{id}/observations')
        return { data: { items: [], publishableCalls: [], nextCursor: null, hasMore: false } };
      if (path === '/v1/claims/{id}/call-recovery')
        return {
          data: { intent: null, canCheck: false, canReview: true, availability: 'AVAILABLE' },
        };
      return { data: { items: [], total: 0, page: 1, pageSize: 50 } };
    });
    const client = createDentaBillQueryClient();
    const view = () => (
      <QueryProvider client={client}>
        <ClaimDetailPage id="claim_a" />
      </QueryProvider>
    );
    const rendered = render(view());
    await screen.findByText('source-claim-17');
    expect(
      client.getQueryData<DetailClaim>(['claims', 'detail', claim.id, null, 'user_a'])
        ?.sourceDetails,
    ).toEqual(claim.sourceDetails);
    auth.userId = 'user_b';
    rendered.rerender(view());
    expect(screen.queryByText('source-claim-17')).not.toBeInTheDocument();
    await act(async () => {
      finishOtherUser({ error: { message: 'Not found' } });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found');
    expect(client.getQueryData(['claims', 'detail', claim.id, null, 'user_b'])).toBeUndefined();
  });
});

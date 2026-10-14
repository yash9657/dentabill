import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DeliveryList,
  OperationsCallList,
  OperationsOverview,
  RecoveryPreview,
} from '../../../../lib/operations/types.js';
import { recoveryPreviewKey } from '../../../../lib/operations/use-operations.js';

import { OperationsPage } from './operations-page.js';

const getMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const postMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ userId: 'user_synthetic', orgId: null, isLoaded: true }),
}));
vi.mock('../../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { GET: getMock, POST: postMock },
    withAuthHeaders: async () => ({ authorization: 'Bearer synthetic' }),
  }),
}));

const instant = '2026-10-13T10:00:00.000Z';
const overview: OperationsOverview = {
  sampledAt: instant,
  thresholds: { deliveryAgeSeconds: 300, observationAgeSeconds: 120 },
  counts: {
    pending: 2,
    agedPending: 1,
    quarantined: 1,
    acceptedOverdue: 1,
    observationReview: 1,
    uncertainCalls: 1,
    legacyReadyWithoutDelivery: 1,
  },
  oldestPendingAt: instant,
  oldestQuarantinedAt: instant,
};
const preview: RecoveryPreview = {
  id: 'delivery_synthetic',
  kind: 'CALL_PLACE',
  state: 'QUARANTINED',
  deliveryAttempts: 10,
  deliveryAttemptLimit: 10,
  recoveryCount: 0,
  lastErrorCode: 'DELIVERY_EXHAUSTED',
  availableAt: instant,
  leaseExpiresAt: null,
  closedAt: null,
  createdAt: instant,
  updatedAt: instant,
  deliveredAt: null,
  reviewVersion: 'review-original',
  action: 'RETRY',
  blockedReason: null,
  followUp: null,
};
const callItem: OperationsCallList['items'][number] = {
  id: 'intent_synthetic',
  claimId: 'claim_synthetic',
  callId: 'call_synthetic',
  state: 'ACCEPTED',
  createdAt: instant,
  submittedAt: instant,
  callDeadlineAt: instant,
  nextObservationAt: instant,
  observationReviewAt: instant,
  lastObservedAt: instant,
};
let role = 'OWNER';
let currentPreview: RecoveryPreview;
let deliveries: DeliveryList;
let calls: OperationsCallList;

function renderPage() {
  const client = createDentaBillQueryClient();
  const user = userEvent.setup();
  render(
    <QueryProvider client={client}>
      <OperationsPage />
    </QueryProvider>,
  );
  return { client, user };
}

beforeEach(() => {
  role = 'OWNER';
  currentPreview = { ...preview };
  deliveries = { items: [preview], nextCursor: null, hasMore: false };
  calls = { items: [callItem], nextCursor: null, hasMore: false };
  postMock.mockReset();
  getMock.mockReset().mockImplementation(async (path) => {
    if (path === '/v1/me')
      return { data: { user: { role }, organization: { id: 'org_synthetic' } } };
    if (path === '/v1/operations') return { data: overview };
    if (path === '/v1/operations/outbox') return { data: deliveries };
    if (path === '/v1/operations/outbox/{id}') return { data: currentPreview };
    if (path === '/v1/operations/calls') return { data: calls };
    if (path === '/v1/operations/notifications')
      return {
        data: {
          sampledAt: instant,
          deliveryMode: 'DISABLED',
          items: [],
          nextCursor: null,
          hasMore: false,
          counts: {
            pending: 0,
            sending: 0,
            blocked: 0,
            quarantined: 0,
            simulated: 0,
            accepted: 0,
            suppressed: 0,
            agedPending: 0,
          },
        },
      };
    throw new Error('Unexpected synthetic request');
  });
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

async function openReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: 'Review call request delivery_synthetic' }),
  );
  return screen.findByRole('dialog', { name: 'Review delivery' });
}

describe('Operations workspace', () => {
  it.each(['OWNER', 'ADMIN'])(
    'lets %s inspect work counts and verified call links without dispatching',
    async (selectedRole) => {
      role = selectedRole;
      renderPage();
      expect(await screen.findByText('Delivery review needed')).toBeInTheDocument();
      expect(
        screen.getByText('Counts describe saved work, not service health.', { exact: false }),
      ).toBeInTheDocument();
      expect(await screen.findByRole('link', { name: 'Open call status' })).toHaveAttribute(
        'href',
        '/dashboard/calls/call_synthetic',
      );
      expect(postMock).not.toHaveBeenCalled();
    },
  );

  it('does not mount operations queries for billing staff', async () => {
    role = 'BILLING_STAFF';
    renderPage();
    await screen.findByText('Operations is available to practice owners and admins.');
    expect(getMock.mock.calls.map(([path]) => path)).toEqual(['/v1/me']);
  });

  it('describes empty work without claiming service health or completed calls', async () => {
    deliveries = { items: [], nextCursor: null, hasMore: false };
    calls = { items: [], nextCursor: null, hasMore: false };
    renderPage();
    await screen.findByText(
      'No deliveries match this status. Other work may still need attention.',
    );
    expect(
      screen.getByText(
        'No calls match this view. This does not confirm provider availability or completion.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/all systems|healthy|all calls completed/i)).not.toBeInTheDocument();
  });

  it('requires approval of the exact snapshot and grants only the selected retry action', async () => {
    postMock.mockImplementation(async () => {
      currentPreview = {
        ...preview,
        state: 'PENDING',
        deliveryAttemptLimit: 13,
        recoveryCount: 1,
        action: 'BLOCKED',
        blockedReason: 'NOT_QUARANTINED',
        reviewVersion: 'review-new',
      };
      return { data: currentPreview };
    });
    const { user } = renderPage();
    const dialog = await openReview(user);
    const approve = await within(dialog).findByRole('button', {
      name: 'Allow three more attempts',
    });
    expect(approve).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(approve);
    await within(dialog).findByText('Retry approved. The same request is awaiting delivery.');
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith('/v1/operations/outbox/{id}/recover', {
      params: { path: { id: preview.id } },
      headers: { authorization: 'Bearer synthetic' },
      body: { action: 'RETRY', reviewVersion: 'review-original' },
    });
    expect(
      within(dialog).queryByRole('button', { name: 'Allow three more attempts' }),
    ).not.toBeInTheDocument();
  });

  it('refreshes a stale review and requires another approval before retry', async () => {
    postMock.mockImplementationOnce(async () => {
      currentPreview = {
        ...preview,
        reviewVersion: 'review-changed',
        deliveryAttempts: 13,
        deliveryAttemptLimit: 13,
      };
      return {
        error: { code: 'OPERATIONS_STALE_REVIEW', message: 'PRIVATE_PAYLOAD' },
        response: { status: 409 },
      };
    });
    const { user } = renderPage();
    const dialog = await openReview(user);
    await user.click(await within(dialog).findByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Allow three more attempts' }));
    await within(dialog).findByText(
      'This delivery changed. Review the refreshed details before approving again.',
    );
    await waitFor(() => expect(within(dialog).getByText('13 of 13')).toBeInTheDocument());
    await waitFor(() => expect(within(dialog).getByRole('checkbox')).not.toBeChecked());
    expect(
      within(dialog).getByRole('button', { name: 'Allow three more attempts' }),
    ).toBeDisabled();
    expect(screen.queryByText('PRIVATE_PAYLOAD')).not.toBeInTheDocument();
    postMock.mockImplementationOnce(async () => ({
      data: { ...currentPreview, state: 'PENDING' },
    }));
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Allow three more attempts' }));
    expect(postMock.mock.calls[1]?.[1]).toMatchObject({
      body: { action: 'RETRY', reviewVersion: 'review-changed' },
    });
  });

  it('invalidates an earlier approval if background refresh changes its snapshot', async () => {
    const { client, user } = renderPage();
    const dialog = await openReview(user);
    await user.click(await within(dialog).findByRole('checkbox'));
    await act(async () => {
      client.setQueryData(recoveryPreviewKey('org_synthetic', preview.id), {
        ...preview,
        reviewVersion: 'different',
      });
    });
    await waitFor(() => expect(within(dialog).getByRole('checkbox')).not.toBeChecked());
    expect(
      within(dialog).getByRole('button', { name: 'Allow three more attempts' }),
    ).toBeDisabled();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('blocks repeated submissions while recovery is saving', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    postMock.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { user } = renderPage();
    const dialog = await openReview(user);
    await user.click(await within(dialog).findByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Allow three more attempts' }));
    expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Saving…' }));
    expect(postMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ data: { ...preview, state: 'PENDING' } });
    });
  });

  it('closes reviewed completed work without saying it was delivered', async () => {
    currentPreview = { ...preview, action: 'CLOSE' };
    postMock.mockImplementation(async () => {
      currentPreview = {
        ...currentPreview,
        state: 'CLOSED',
        action: 'BLOCKED',
        blockedReason: 'NOT_QUARANTINED',
        closedAt: instant,
      };
      return { data: currentPreview };
    });
    const { user } = renderPage();
    const dialog = await openReview(user);
    await user.click(await within(dialog).findByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Close after review' }));
    await within(dialog).findByText('Closed after review. No delivery was sent.');
    expect(postMock.mock.calls[0]?.[1]).toMatchObject({
      body: { action: 'CLOSE', reviewVersion: preview.reviewVersion },
    });
  });

  it.each([
    [
      'SUMMARY_RETRY_UNSAFE',
      'The summary is missing. Safe summary recovery is not available yet; keep this delivery in review.',
    ],
    [
      'DELIVERY_NOT_EXHAUSTED',
      'This request still has delivery attempts available. Wait for its existing delivery schedule.',
    ],
  ] as const)(
    'explains blocked %s without offering any recovery action',
    async (blockedReason, explanation) => {
      currentPreview = { ...preview, action: 'BLOCKED', blockedReason };
      const { user } = renderPage();
      const dialog = await openReview(user);
      expect(await within(dialog).findByText(explanation)).toBeInTheDocument();
      expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
      expect(postMock).not.toHaveBeenCalled();
    },
  );

  it('links uncertain deliveries only through the verified follow-up identifiers', async () => {
    currentPreview = {
      ...preview,
      action: 'BLOCKED',
      blockedReason: 'CALL_RECONCILIATION_REQUIRED',
      followUp: {
        kind: 'CALL_RECONCILIATION',
        intentId: 'intent_bound',
        claimId: 'claim_bound',
        callId: null,
      },
    };
    const { user } = renderPage();
    const dialog = await openReview(user);
    expect(
      await within(dialog).findByRole('link', { name: 'Open claim to check existing call' }),
    ).toHaveAttribute('href', '/dashboard/claims/claim_bound');
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('uses bounded cursor pagination and resets it on a filter change', async () => {
    deliveries = { items: [preview], nextCursor: 'cursor-page-2', hasMore: true };
    const { user } = renderPage();
    await screen.findByRole('button', { name: 'Load more deliveries' });
    deliveries = {
      items: [{ ...preview, id: 'delivery_second' }],
      nextCursor: null,
      hasMore: false,
    };
    await user.click(screen.getByRole('button', { name: 'Load more deliveries' }));
    await screen.findByText('delivery_second');
    expect(getMock).toHaveBeenCalledWith(
      '/v1/operations/outbox',
      expect.objectContaining({
        params: { query: { state: 'QUARANTINED', limit: 20, cursor: 'cursor-page-2' } },
      }),
    );
    deliveries = { items: [], nextCursor: null, hasMore: false };
    await user.selectOptions(screen.getByLabelText('Delivery status'), 'CLOSED');
    await screen.findByText(
      'No deliveries match this status. Other work may still need attention.',
    );
    expect(getMock).toHaveBeenLastCalledWith(
      '/v1/operations/outbox',
      expect.objectContaining({ params: { query: { state: 'CLOSED', limit: 20 } } }),
    );
    expect(screen.queryByText('delivery_second')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Call work'), 'LEGACY_READY');
    expect(await screen.findByRole('link', { name: 'Open claim' })).toHaveAttribute(
      'href',
      '/dashboard/claims/claim_synthetic',
    );
    expect(postMock).not.toHaveBeenCalled();
  });
});

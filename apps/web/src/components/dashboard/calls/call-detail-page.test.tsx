import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CallDetailResponse } from '../../../lib/calls/types.js';
import { callQueryKey } from '../../../lib/calls/use-call.js';

import { CallDetailPage } from './call-detail-page.js';

const getMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const postMock = vi.fn();
let profileRole: 'OWNER' | 'ADMIN' | 'BILLING_STAFF' = 'BILLING_STAFF';

vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: {
      GET: (path: string, ...args: unknown[]) =>
        path === '/v1/me'
          ? Promise.resolve({ data: { user: { role: profileRole } } })
          : getMock(path, ...args),
      POST: postMock,
    },
    withAuthHeaders: async () => ({ authorization: 'Bearer synthetic-test-token' }),
  }),
}));

const baseCall: CallDetailResponse = {
  id: 'call_cancel_test',
  claimId: 'claim_cancel_test',
  retellCallId: 'fake_call_cancel_test',
  retellAgentId: null,
  status: 'ON_HOLD',
  attemptNumber: 1,
  ivrNavigated: true,
  humanReached: false,
  holdTimeSeconds: null,
  startedAt: '2026-10-13T10:00:00.000Z',
  endedAt: null,
  durationSeconds: null,
  dlqReason: null,
  cancelRequestedAt: null,
  monitoring: null,
  createdAt: '2026-10-13T10:00:00.000Z',
  events: [],
  claim: {
    id: 'claim_cancel_test',
    claimNumber: 'SYNTHETIC-CANCEL-1',
    payerCode: 'CIGNA_DENTAL',
    status: 'CALLING',
    priority: 80,
    serviceDate: '2026-01-15T00:00:00.000Z',
  },
};
const pendingCall: CallDetailResponse = {
  ...baseCall,
  cancelRequestedAt: '2026-10-13T10:01:00.000Z',
};

function renderDetail() {
  const client = createDentaBillQueryClient();
  const user = userEvent.setup();
  render(
    <QueryProvider client={client}>
      <CallDetailPage id={baseCall.id} />
    </QueryProvider>,
  );
  return { client, user };
}

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_dummy');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  profileRole = 'BILLING_STAFF';
  getMock.mockReset();
  postMock.mockReset();
});

describe('<CallDetailPage /> cancellation', () => {
  it.each([
    ['overdue', null, null, null, 'Deadline exceeded'],
    ['requested', '2026-01-01T00:01:00.000Z', null, null, 'Stop requested'],
    [
      'acknowledged',
      '2026-01-01T00:01:00.000Z',
      '2026-01-01T00:01:01.000Z',
      null,
      'Stop requested',
    ],
    [
      'unconfirmed',
      '2026-01-01T00:01:00.000Z',
      '2026-01-01T00:01:01.000Z',
      '2026-01-01T00:03:00.000Z',
      'Stop not confirmed',
    ],
  ] as const)(
    'shows %s monitoring while retaining the provider’s active status',
    async (_case, stopRequestedAt, stopAcknowledgedAt, reviewRequiredAt, label) => {
      getMock.mockResolvedValue({
        data: {
          ...baseCall,
          monitoring: {
            deadlineAt: '2026-01-01T00:00:00.000Z',
            nextObservationAt: null,
            stopRequestedAt,
            stopAcknowledgedAt,
            reviewRequiredAt,
            lastCheckedAt: null,
            lastErrorCode: null,
          },
        },
      });
      renderDetail();
      expect(await screen.findByRole('status')).toHaveTextContent(label);
      expect(screen.getByLabelText('Status: On hold')).toBeInTheDocument();
      if (stopRequestedAt)
        expect(screen.getByRole('button', { name: 'Stop requested' })).toBeDisabled();
      if (stopAcknowledgedAt && !reviewRequiredAt)
        expect(screen.getByRole('status')).toHaveTextContent(
          'Waiting for confirmation that the call ended',
        );
      expect(postMock).not.toHaveBeenCalled();
    },
  );

  it('clears overdue and unconfirmed-stop warnings once terminal evidence arrives', async () => {
    getMock.mockResolvedValue({
      data: {
        ...baseCall,
        status: 'COMPLETED',
        monitoring: {
          deadlineAt: '2026-01-01T00:00:00.000Z',
          nextObservationAt: null,
          stopRequestedAt: '2026-01-01T00:01:00.000Z',
          stopAcknowledgedAt: null,
          reviewRequiredAt: '2026-01-01T00:03:00.000Z',
          lastCheckedAt: null,
          lastErrorCode: 'STOP_CONFIRMATION_EXPIRED',
        },
      },
    });
    renderDetail();
    await screen.findByLabelText('Status: Completed');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('posts a request once, preserves active call status, and waits for terminal evidence', async () => {
    getMock.mockResolvedValue({ data: baseCall });
    postMock.mockImplementationOnce(async () => {
      getMock.mockResolvedValue({ data: pendingCall });
      return { data: pendingCall };
    });
    const { client, user } = renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Cancel call' }));

    const requestedButton = await screen.findByRole('button', { name: 'Cancellation requested' });
    expect(requestedButton).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the call to end.');
    expect(screen.getByLabelText('Status: On hold')).toBeInTheDocument();
    expect(client.getQueryData(callQueryKey(baseCall.id))).toMatchObject({
      status: 'ON_HOLD',
      endedAt: null,
      durationSeconds: null,
    });
    await user.click(requestedButton);
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith('/v1/calls/{id}/cancel', {
      params: { path: { id: baseCall.id } },
      headers: { authorization: 'Bearer synthetic-test-token' },
    });

    const terminalCall = {
      ...pendingCall,
      status: 'COMPLETED' as const,
      endedAt: '2026-10-13T10:01:15.000Z',
      durationSeconds: 75,
    };
    getMock.mockResolvedValue({ data: terminalCall });
    await act(async () => {
      await client.refetchQueries({ queryKey: callQueryKey(baseCall.id) });
    });
    expect(await screen.findByLabelText('Status: Completed')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /cancell?ation|cancel call/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Waiting for the call to end/)).not.toBeInTheDocument();
  });

  it('disables repeated submissions while the request is still in flight', async () => {
    getMock.mockResolvedValue({ data: baseCall });
    let resolveRequest: (value: { data: CallDetailResponse }) => void = () => undefined;
    postMock.mockImplementationOnce(
      () =>
        new Promise<{ data: CallDetailResponse }>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const { user } = renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Cancel call' }));
    const requesting = screen.getByRole('button', { name: 'Requesting cancellation…' });
    expect(requesting).toBeDisabled();
    expect(requesting).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText(/Waiting for the call to end/)).not.toBeInTheDocument();
    await user.click(requesting);
    expect(postMock).toHaveBeenCalledTimes(1);
    getMock.mockResolvedValue({ data: pendingCall });
    await act(async () => {
      resolveRequest({ data: pendingCall });
    });
    expect(await screen.findByRole('button', { name: 'Cancellation requested' })).toBeDisabled();
  });

  it('shows the persisted pending state after reload without requesting cancellation again', async () => {
    getMock.mockResolvedValue({ data: pendingCall });
    renderDetail();

    expect(await screen.findByRole('button', { name: 'Cancellation requested' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'The call remains active until its end is confirmed.',
    );
    expect(postMock).not.toHaveBeenCalled();
  });

  it.each(['COMPLETED', 'FAILED', 'VOICEMAIL'] as const)(
    'preserves newer cached %s evidence when an older active cancellation response arrives',
    async (status) => {
      getMock.mockResolvedValue({ data: baseCall });
      let resolveRequest: (value: { data: CallDetailResponse }) => void = () => undefined;
      postMock.mockImplementationOnce(
        () =>
          new Promise<{ data: CallDetailResponse }>((resolve) => {
            resolveRequest = resolve;
          }),
      );
      const { client, user } = renderDetail();
      await user.click(await screen.findByRole('button', { name: 'Cancel call' }));
      const terminal: CallDetailResponse = {
        ...baseCall,
        status,
        endedAt: '2026-10-13T10:01:15.000Z',
        durationSeconds: 75,
      };
      await act(async () => {
        client.setQueryData(callQueryKey(baseCall.id), terminal);
      });
      // Keep the invalidated GET unresolved so it cannot hide a stale mutation merge.
      let resolveRefresh: (value: { data: CallDetailResponse }) => void = () => undefined;
      getMock.mockImplementationOnce(
        () =>
          new Promise<{ data: CallDetailResponse }>((resolve) => {
            resolveRefresh = resolve;
          }),
      );
      await act(async () => {
        resolveRequest({ data: pendingCall });
      });
      await waitFor(() => {
        expect(getMock).toHaveBeenCalledTimes(2);
      });
      expect(client.getQueryData(callQueryKey(baseCall.id))).toEqual(terminal);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByText(/Waiting for the call to end/)).not.toBeInTheDocument();
      await act(async () => {
        resolveRefresh({ data: terminal });
      });
    },
  );

  it.each(['COMPLETED', 'FAILED', 'VOICEMAIL'] as const)(
    'does not show a pending request or cancel action for a %s call',
    async (status) => {
      getMock.mockResolvedValue({ data: { ...pendingCall, status } });
      renderDetail();

      await screen.findByRole('heading', { name: 'Call to Cigna Dental' });
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByText(/Waiting for the call to end/)).not.toBeInTheDocument();
      expect(postMock).not.toHaveBeenCalled();
    },
  );

  it('shows the current terminal outcome when the call ends before cancellation is accepted', async () => {
    getMock.mockResolvedValue({ data: baseCall });
    const terminal = { ...baseCall, status: 'COMPLETED' as const };
    postMock.mockImplementationOnce(async () => {
      getMock.mockResolvedValue({ data: terminal });
      return { data: terminal };
    });
    const { user } = renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Cancel call' }));

    await waitFor(() => expect(screen.getByLabelText('Status: Completed')).toBeInTheDocument());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/Waiting for the call to end/)).not.toBeInTheDocument();
  });

  it.each(['api', 'network'])(
    'allows retry after an %s failure without fabricating a request',
    async (failure) => {
      getMock.mockResolvedValue({ data: baseCall });
      if (failure === 'api')
        postMock.mockResolvedValueOnce({ error: { message: 'Synthetic failure' } });
      else postMock.mockRejectedValueOnce(new Error('Synthetic network failure'));
      const { client, user } = renderDetail();

      await user.click(await screen.findByRole('button', { name: 'Cancel call' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Couldn’t request cancellation. Try again.',
      );
      expect(screen.getByRole('button', { name: 'Cancel call' })).toBeEnabled();
      expect(screen.queryByText(/Waiting for the call to end/)).not.toBeInTheDocument();
      expect(client.getQueryData(callQueryKey(baseCall.id))).toMatchObject({
        status: 'ON_HOLD',
        cancelRequestedAt: null,
        endedAt: null,
      });
    },
  );
});

const monitoredCall: CallDetailResponse = {
  ...baseCall,
  monitoring: {
    deadlineAt: '2026-01-01T00:00:00.000Z',
    nextObservationAt: null,
    stopRequestedAt: null,
    stopAcknowledgedAt: null,
    reviewRequiredAt: null,
    lastCheckedAt: null,
    lastErrorCode: null,
  },
};

describe('<CallDetailPage /> manual provider status check', () => {
  it.each(['OWNER', 'ADMIN'] as const)(
    'offers %s a read-only check without changing active status',
    async (role) => {
      profileRole = role;
      getMock.mockResolvedValue({ data: monitoredCall });
      postMock.mockResolvedValue({
        data: {
          callId: baseCall.id,
          outcome: 'RECONCILIATION_REQUIRED',
          checkedAt: '2026-10-13T10:02:00.000Z',
        },
      });
      const { client, user } = renderDetail();
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      await user.click(await screen.findByRole('button', { name: 'Check call status' }));
      expect(
        await screen.findByText(
          'Call-end confirmation is still pending. Review the latest status below.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Status: On hold')).toBeInTheDocument();
      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock).toHaveBeenCalledWith('/v1/calls/{id}/check-status', {
        params: { path: { id: baseCall.id } },
        headers: { authorization: 'Bearer synthetic-test-token' },
        body: {},
      });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['calls'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['claims'] });
    },
  );

  it('hides the status action for historical calls without a durable intent', async () => {
    profileRole = 'OWNER';
    getMock.mockResolvedValue({ data: baseCall });
    renderDetail();
    await screen.findByLabelText('Status: On hold');
    expect(screen.queryByRole('button', { name: 'Check call status' })).not.toBeInTheDocument();
  });

  it('does not offer billing staff the owner/admin status action', async () => {
    getMock.mockResolvedValue({ data: monitoredCall });
    renderDetail();
    await screen.findByLabelText('Status: On hold');
    expect(screen.queryByRole('button', { name: 'Check call status' })).not.toBeInTheDocument();
  });

  it('disables duplicate status checks and preserves terminal evidence arriving before the lookup response', async () => {
    profileRole = 'OWNER';
    getMock.mockResolvedValue({ data: monitoredCall });
    let resolveRequest: (response: unknown) => void = () => undefined;
    postMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const { client, user } = renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Check call status' }));
    expect(screen.getByRole('button', { name: 'Checking status…' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Checking status…' }));
    expect(postMock).toHaveBeenCalledTimes(1);
    const completed = {
      ...baseCall,
      status: 'COMPLETED' as const,
      endedAt: '2026-10-13T10:02:00.000Z',
      durationSeconds: 120,
    };
    getMock.mockResolvedValue({ data: completed });
    await act(async () => {
      client.setQueryData(callQueryKey(baseCall.id), completed);
      resolveRequest({
        data: {
          callId: baseCall.id,
          outcome: 'RESCHEDULED',
          checkedAt: '2026-10-13T10:01:00.000Z',
        },
      });
    });
    await waitFor(() => expect(screen.getByLabelText('Status: Completed')).toBeInTheDocument());
    expect(client.getQueryData(callQueryKey(baseCall.id))).toMatchObject({
      status: 'COMPLETED',
      durationSeconds: 120,
    });
    expect(screen.queryByRole('button', { name: /Check.*status/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/The call remains active/)).not.toBeInTheDocument();
  });

  it.each([
    [
      'INVALID_STATE_TRANSITION',
      'A status check is underway or was just completed. Try again in a minute.',
    ],
    [
      'CALL_RECONCILIATION_UNAVAILABLE',
      'Call lookup is not configured. Contact your administrator.',
    ],
  ])('gives safe retry feedback for %s', async (code, message) => {
    profileRole = 'OWNER';
    getMock.mockResolvedValue({ data: monitoredCall });
    postMock.mockResolvedValue({ error: { code, message: 'SYNTHETIC_PRIVATE_PROVIDER_MESSAGE' } });
    const { user } = renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Check call status' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText('SYNTHETIC_PRIVATE_PROVIDER_MESSAGE')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Status: On hold')).toBeInTheDocument();
  });
});

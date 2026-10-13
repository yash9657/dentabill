import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CallDetailResponse } from '../../../lib/calls/types.js';
import { callQueryKey } from '../../../lib/calls/use-call.js';

import { CallDetailPage } from './call-detail-page.js';

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { GET: getMock, POST: postMock },
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
  getMock.mockReset();
  postMock.mockReset();
});

describe('<CallDetailPage /> cancellation', () => {
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

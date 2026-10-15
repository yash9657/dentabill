import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CallDetailResponse } from '../../../lib/calls/types.js';
import { callQueryKey } from '../../../lib/calls/use-call.js';

import { CallDetailPage } from './call-detail-page.js';

const getMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const postMock = vi.fn();
const auth = vi.hoisted((): { orgId: string | null; userId: string | null; isLoaded: boolean } => ({
  orgId: 'org-a',
  userId: 'user-a',
  isLoaded: true,
}));
let profileRole: 'OWNER' | 'ADMIN' | 'BILLING_STAFF' = 'BILLING_STAFF';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => auth }));

// Analysis status has its own scoped API/polling tests; keep cancellation fixtures independent.
vi.mock('./call-analysis-status.js', () => ({ CallAnalysisStatus: () => null }));

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
  const ui = () => (
    <QueryProvider client={client}>
      <CallDetailPage id={baseCall.id} />
    </QueryProvider>
  );
  const view = render(ui());
  return {
    client,
    user,
    refresh: () => {
      view.rerender(ui());
    },
  };
}

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_dummy');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  Object.assign(auth, { orgId: 'org-a', userId: 'user-a', isLoaded: true });
  profileRole = 'BILLING_STAFF';
  getMock.mockReset();
  postMock.mockReset();
});

describe('<CallDetailPage /> authentication scope', () => {
  const privateCall: CallDetailResponse = {
    ...baseCall,
    events: [
      {
        id: 'private-turn',
        eventType: 'call.transcript',
        timestamp: '2026-10-14T12:00:00.000Z',
        data: { role: 'agent', text: 'SYNTHETIC_PRIVATE_CONVERSATION' },
      },
    ],
  };

  it.each(['organization', 'user'] as const)(
    'hides the prior conversation immediately when the %s changes',
    async (change) => {
      getMock.mockResolvedValue({ data: privateCall });
      const view = renderDetail();
      await screen.findByText('SYNTHETIC_PRIVATE_CONVERSATION');
      getMock.mockImplementation(() => new Promise(() => undefined));
      if (change === 'organization') auth.orgId = 'org-b';
      else auth.userId = 'user-b';
      view.refresh();
      expect(screen.queryByText('SYNTHETIC_PRIVATE_CONVERSATION')).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Conversation' })).not.toBeInTheDocument();
      await waitFor(() => {
        expect(getMock).toHaveBeenCalledTimes(2);
      });
      expect(
        view.client.getQueryData(callQueryKey(baseCall.id, auth.orgId, auth.userId)),
      ).toBeUndefined();
    },
  );

  it.each(['signed out', 'no practice', 'loading'] as const)(
    'removes the conversation and stops admission when authentication is %s',
    async (change) => {
      getMock.mockResolvedValue({ data: privateCall });
      const view = renderDetail();
      await screen.findByText('SYNTHETIC_PRIVATE_CONVERSATION');
      if (change === 'signed out') auth.userId = null;
      else if (change === 'no practice') auth.orgId = null;
      else auth.isLoaded = false;
      view.refresh();
      expect(screen.queryByText('SYNTHETIC_PRIVATE_CONVERSATION')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancel call' })).not.toBeInTheDocument();
      expect(getMock).toHaveBeenCalledTimes(1);
      if (change === 'signed out')
        expect(screen.getByRole('heading', { name: 'Sign in to see call detail' })).toBeVisible();
      if (change === 'no practice')
        expect(
          screen.getByRole('heading', { name: 'Choose a practice to see call detail' }),
        ).toBeVisible();
    },
  );
});

describe('<CallDetailPage /> conversation', () => {
  it('renders readable turns once and keeps unrelated event metadata private', async () => {
    const text = `Please send the requested documentation. ${'Synthetic detail. '.repeat(20)}`;
    getMock.mockResolvedValue({
      data: {
        ...baseCall,
        events: [
          {
            id: 'conversation-turn',
            eventType: 'call.transcript',
            timestamp: '2026-10-14T12:00:00.000Z',
            data: { role: 'representative', text },
          },
          {
            id: 'technical-event',
            eventType: 'call.started',
            timestamp: '2026-10-14T11:59:00.000Z',
            data: { token: 'PRIVATE_EVENT_METADATA' },
          },
        ],
      },
    });
    const { user } = renderDetail();
    expect(await screen.findByRole('heading', { name: 'Conversation' })).toBeVisible();
    expect(screen.getAllByText(text.trim())).toHaveLength(1);
    expect(screen.getByText('Payer representative')).toBeVisible();
    expect(screen.getByText('Event recorded.')).not.toBeVisible();
    await user.click(screen.getByText('Call details and event log'));
    expect(screen.getByText('Event recorded.')).toBeVisible();
    expect(screen.queryByText('call.transcript')).not.toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE_EVENT_METADATA|"role"|"text"/)).not.toBeInTheDocument();
  });
});

describe('<CallDetailPage /> phone tree and live state', () => {
  const turn = (id: string, role: string, text: string, second: number) => ({
    id,
    eventType: 'call.transcript',
    timestamp: new Date(Date.UTC(2026, 9, 14, 12, 0, second)).toISOString(),
    data: { role, text },
  });

  it('summarises the recorded phone-tree path and labels events for people', async () => {
    getMock.mockResolvedValue({
      data: {
        ...baseCall,
        status: 'COMPLETED',
        holdTimeSeconds: 42,
        durationSeconds: 75,
        events: [
          turn('t1', 'system', 'Please enter the subscriber ID.', 1),
          turn('t2', 'agent', 'Subscriber ID DEMO1042.', 2),
          turn('t3', 'system', 'For claim status, press 2.', 3),
          turn('t4', 'agent', 'Pressing 2 for claim status.', 4),
          turn('t5', 'system', 'Hold music.', 5),
          turn('t6', 'user', 'Provider services, this is Marcus.', 6),
          {
            id: 'ended',
            eventType: 'call.ended',
            timestamp: '2026-10-14T12:01:00.000Z',
            data: { endReason: 'completed' },
          },
        ],
      },
    });
    const { user } = renderDetail();
    const path = await screen.findByRole('region', { name: 'Phone tree' });
    expect(path).toHaveTextContent(
      'Gave subscriber IDClaim status · pressed 2On hold · 42sReached Marcus',
    );
    expect(screen.getByRole('list', { name: 'Recorded call progress' })).toHaveTextContent(
      '1m 15s duration',
    );
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
    await user.click(screen.getByText('Call details and event log'));
    expect(screen.getByText('Call ended')).toBeVisible();
    expect(screen.getByText('call.ended')).toHaveClass('font-mono');
  });

  it('renders no phone tree when the transcript supports no step', async () => {
    getMock.mockResolvedValue({
      data: { ...baseCall, events: [turn('t1', 'system', 'For claim status, press 2.', 1)] },
    });
    renderDetail();
    await screen.findByRole('heading', { name: 'Conversation' });
    expect(screen.queryByRole('region', { name: 'Phone tree' })).not.toBeInTheDocument();
  });

  it('shows a live indicator with an elapsed timer while the call is active', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-10-13T10:02:05.000Z') });
    try {
      getMock.mockResolvedValue({ data: baseCall });
      renderDetail();
      expect(await screen.findByText('Live')).toBeVisible();
      expect(screen.getByRole('timer')).toHaveTextContent('2:05');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByRole('timer')).toHaveTextContent(/2:0[89]/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('<CallDetailPage /> useful information first', () => {
  it('keeps an unknown linked claim status explicit without guessing a known state', async () => {
    getMock.mockResolvedValue({
      data: { ...baseCall, claim: { ...baseCall.claim, status: 'UNRECOGNIZED' } },
    });
    renderDetail();
    expect(await screen.findByText(/Status unavailable/)).toBeVisible();
    expect(screen.queryByText('UNRECOGNIZED')).not.toBeInTheDocument();
  });

  it('keeps operational metrics accessible behind a closed disclosure', async () => {
    getMock.mockResolvedValue({ data: baseCall });
    const { user } = renderDetail();
    await screen.findByRole('heading', { name: 'Call to Cigna Dental' });
    expect(screen.getByRole('link', { name: baseCall.claim.claimNumber })).toHaveAttribute(
      'href',
      `/dashboard/claims/${baseCall.claimId}`,
    );
    expect(screen.getByText('Hold time')).not.toBeVisible();
    expect(screen.getByText('Failure reason')).not.toBeVisible();
    expect(screen.queryByText('DLQ reason')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Conversation' })).toBeVisible();
    const disclosure = screen.getByText('Call details and event log');
    expect(disclosure.closest('details')).not.toHaveAttribute('open');
    await user.click(disclosure);
    expect(disclosure.closest('details')).toHaveAttribute('open');
    expect(screen.getByText('Hold time')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Event log' })).toBeVisible();
    await user.click(disclosure);
    expect(screen.getByText('Hold time')).not.toBeVisible();
  });

  it.each(['COMPLETED', 'FAILED', 'VOICEMAIL'] as const)(
    'does not infer IVR navigation or human contact from terminal %s',
    async (status) => {
      getMock.mockResolvedValue({
        data: { ...baseCall, status, ivrNavigated: false, humanReached: false },
      });
      const { user } = renderDetail();
      await screen.findByRole('heading', { name: 'Call to Cigna Dental' });
      const progress = screen.getByRole('list', { name: 'Recorded call progress' });
      expect(progress).not.toHaveTextContent(/IVR|Connected|Confirmed/);
      await user.click(screen.getByText('Call details and event log'));
      expect(screen.getAllByText('Not confirmed')).toHaveLength(2);
      expect(screen.queryByText('Confirmed', { exact: true })).not.toBeInTheDocument();
    },
  );

  it('updates the visible stage from the saved call status without inventing intermediate steps', async () => {
    getMock.mockResolvedValue({
      data: { ...baseCall, status: 'NAVIGATING_IVR', ivrNavigated: false },
    });
    const { client } = renderDetail();
    expect(await screen.findByLabelText('Status: Navigating IVR')).toBeVisible();
    await act(async () => {
      client.setQueryData(callQueryKey(baseCall.id, 'org-a', 'user-a'), {
        ...baseCall,
        status: 'COLLECTING',
        ivrNavigated: false,
        humanReached: false,
      });
    });
    expect(await screen.findByLabelText('Status: Collecting')).toBeVisible();
    expect(screen.queryByLabelText('Status: Navigating IVR')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Recorded call progress' })).not.toHaveTextContent(
      'Connected',
    );
  });
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
    expect(client.getQueryData(callQueryKey(baseCall.id, 'org-a', 'user-a'))).toMatchObject({
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
      await client.refetchQueries({ queryKey: callQueryKey(baseCall.id, 'org-a', 'user-a') });
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
        client.setQueryData(callQueryKey(baseCall.id, 'org-a', 'user-a'), terminal);
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
      expect(client.getQueryData(callQueryKey(baseCall.id, 'org-a', 'user-a'))).toEqual(terminal);
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
      expect(client.getQueryData(callQueryKey(baseCall.id, 'org-a', 'user-a'))).toMatchObject({
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
      client.setQueryData(callQueryKey(baseCall.id, 'org-a', 'user-a'), completed);
      resolveRequest({
        data: {
          callId: baseCall.id,
          outcome: 'RESCHEDULED',
          checkedAt: '2026-10-13T10:01:00.000Z',
        },
      });
    });
    await waitFor(() => expect(screen.getByLabelText('Status: Completed')).toBeInTheDocument());
    expect(client.getQueryData(callQueryKey(baseCall.id, 'org-a', 'user-a'))).toMatchObject({
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

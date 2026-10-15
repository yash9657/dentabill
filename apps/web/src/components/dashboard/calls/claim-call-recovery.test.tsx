import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CallRecoveryResponse } from '../../../lib/calls/use-call-recovery.js';

import { ClaimCallRecovery } from './claim-call-recovery.js';

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { GET: getMock, POST: postMock },
    withAuthHeaders: async () => ({}),
  }),
}));

const uncertain: CallRecoveryResponse = {
  intent: {
    id: 'intent_synthetic',
    state: 'UNKNOWN',
    attemptNumber: 1,
    createdAt: '2026-10-13T12:00:00.000Z',
    submittedAt: '2026-10-13T12:01:00.000Z',
    callId: null,
    lastCheckedAt: null,
    lastCheckOutcome: null,
    nextCheckAt: null,
  },
  canCheck: true,
  canReview: true,
  availability: 'AVAILABLE',
};
const noIntent: CallRecoveryResponse = { ...uncertain, intent: null, canCheck: false };

function renderRecovery() {
  const client = createDentaBillQueryClient();
  const rendered = render(
    <QueryProvider client={client}>
      <ClaimCallRecovery
        claimId="claim_synthetic"
        claimStatus="MANUAL_REVIEW"
        payerCode="CIGNA_DENTAL"
      />
    </QueryProvider>,
  );
  const navigate = (claimId: string): void => {
    rendered.rerender(
      <QueryProvider client={client}>
        <ClaimCallRecovery claimId={claimId} claimStatus="MANUAL_REVIEW" payerCode="CIGNA_DENTAL" />
      </QueryProvider>,
    );
  };
  return { user: userEvent.setup(), client, navigate };
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

describe('ClaimCallRecovery', () => {
  it('does not offer a new dial until the existing submission status is known', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    getMock.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderRecovery();
    expect(screen.getByRole('status')).toHaveTextContent('Checking call status');
    expect(screen.queryByRole('button', { name: /Call now/ })).not.toBeInTheDocument();
    resolve({ data: noIntent });
    expect(await screen.findByRole('button', { name: /Call now/ })).toHaveTextContent('Retry call');
  });

  it('only offers a status retry when the recovery read fails', async () => {
    getMock.mockResolvedValue({ error: { message: 'synthetic failure' } });
    const { user } = renderRecovery();
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: /Call now/ })).not.toBeInTheDocument();
    getMock.mockResolvedValue({ data: uncertain });
    await user.click(screen.getByRole('button', { name: 'Retry status check' }));
    expect(await screen.findByRole('button', { name: 'Check existing call' })).toBeEnabled();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('checks the existing intent only and keeps an unmatched submission blocked from redial', async () => {
    getMock.mockResolvedValue({ data: uncertain });
    const { user } = renderRecovery();
    await screen.findByRole('button', { name: 'Check existing call' });
    const unmatched = {
      ...uncertain,
      canCheck: false,
      intent: {
        ...uncertain.intent!,
        lastCheckOutcome: 'NO_MATCH' as const,
        lastCheckedAt: '2026-10-13T12:02:00.000Z',
        nextCheckAt: '2026-10-13T12:03:00.000Z',
      },
    };
    getMock.mockResolvedValue({ data: unmatched });
    postMock.mockResolvedValue({ data: { ...unmatched, outcome: 'NO_MATCH' } });
    await user.click(screen.getByRole('button', { name: 'Check existing call' }));
    expect(
      await screen.findByText(/provider has not confirmed a matching call/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check existing call' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Call now/ })).not.toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith('/v1/call-intents/{id}/reconcile', {
      params: { path: { id: 'intent_synthetic' } },
      headers: {},
      body: {},
    });
  });

  it('disables repeated checks while the lookup is pending', async () => {
    getMock.mockResolvedValue({ data: uncertain });
    postMock.mockReturnValue(new Promise(() => undefined));
    const { user } = renderRecovery();
    await user.click(await screen.findByRole('button', { name: 'Check existing call' }));
    expect(screen.getByRole('button', { name: 'Checking existing call…' })).toBeDisabled();
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ canReview: false, canCheck: false }, /Ask an owner or admin/],
    [{ availability: 'NOT_CONFIGURED' as const, canCheck: false }, /Call lookup is not configured/],
  ])('does not offer lookup when role or configuration disallows it', async (overrides, text) => {
    getMock.mockResolvedValue({ data: { ...uncertain, ...overrides } });
    renderRecovery();
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the existing call after recovery, including when it already left the active projection', async () => {
    getMock.mockResolvedValue({ data: uncertain });
    const { user } = renderRecovery();
    await screen.findByRole('button', { name: 'Check existing call' });
    getMock.mockResolvedValue({ data: noIntent });
    postMock.mockResolvedValue({
      data: {
        ...uncertain,
        canCheck: false,
        outcome: 'RECOVERED',
        intent: { ...uncertain.intent!, state: 'TERMINAL', callId: 'call_synthetic' },
      },
    });
    await user.click(screen.getByRole('button', { name: 'Check existing call' }));
    expect(await screen.findByRole('link', { name: 'View call' })).toHaveAttribute(
      'href',
      '/dashboard/calls/call_synthetic',
    );
    expect(screen.queryByRole('button', { name: /Call now/ })).not.toBeInTheDocument();
  });

  it.each(['completed', 'pending'] as const)(
    'does not show claim A’s recovered call after navigating to claim B with a %s lookup',
    async (phase) => {
      getMock.mockResolvedValue({ data: uncertain });
      let resolve: (value: unknown) => void = () => undefined;
      postMock.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      const { user, client, navigate } = renderRecovery();
      await user.click(await screen.findByRole('button', { name: 'Check existing call' }));
      const response = {
        data: {
          ...uncertain,
          canCheck: false,
          outcome: 'RECOVERED',
          intent: { ...uncertain.intent!, state: 'TERMINAL', callId: 'call_claim_a' },
        },
      };
      getMock.mockResolvedValue({ data: noIntent });
      if (phase === 'completed') {
        resolve(response);
        expect(await screen.findByRole('link', { name: 'View call' })).toHaveAttribute(
          'href',
          '/dashboard/calls/call_claim_a',
        );
      }
      client.setQueryData(['calls', 'recovery', 'claim_b'], noIntent);
      navigate('claim_b');
      expect(screen.queryByRole('link', { name: 'View call' })).not.toBeInTheDocument();
      if (phase === 'pending') {
        await act(async () => {
          resolve(response);
        });
      }
      expect(
        await screen.findByRole('button', { name: 'Call now for claim claim_b' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'View call' })).not.toBeInTheDocument();
    },
  );

  it.each(['READY', 'ACCEPTED'] as const)(
    'does not offer a new call for a %s intent',
    async (state) => {
      getMock.mockResolvedValue({
        data: { ...uncertain, canCheck: false, intent: { ...uncertain.intent!, state } },
      });
      renderRecovery();
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          state === 'READY' ? 'Call queued' : 'Call accepted',
        ),
      );
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    },
  );

  it('shows a safe lookup failure and never offers a new call', async () => {
    getMock.mockResolvedValue({ data: uncertain });
    postMock.mockResolvedValue({ error: { message: 'synthetic sensitive provider text' } });
    const { user } = renderRecovery();
    await user.click(await screen.findByRole('button', { name: 'Check existing call' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Keep this claim in review.');
    expect(screen.queryByText(/sensitive provider text/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Call now/ })).not.toBeInTheDocument();
  });
});

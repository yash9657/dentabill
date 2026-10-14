import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CallDetailResponse } from './types.js';
import { callQueryKey, useCall } from './use-call.js';
import { useCancelCall } from './use-cancel-call.js';

const mocks = vi.hoisted(() => {
  const auth: { orgId: string | null; userId: string | null; isLoaded: boolean } = {
    orgId: 'org-a',
    userId: 'user-a',
    isLoaded: true,
  };
  return { auth, get: vi.fn(), post: vi.fn() };
});
vi.mock('@clerk/nextjs', () => ({ useAuth: () => mocks.auth }));
vi.mock('../api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { GET: mocks.get, POST: mocks.post },
    withAuthHeaders: async () => ({ authorization: 'Bearer synthetic-fixture' }),
  }),
}));

const call: CallDetailResponse = {
  id: 'synthetic-call',
  claimId: 'synthetic-claim',
  retellCallId: 'fake_call_synthetic',
  retellAgentId: null,
  status: 'ON_HOLD',
  attemptNumber: 1,
  ivrNavigated: false,
  humanReached: false,
  holdTimeSeconds: null,
  startedAt: '2026-10-14T12:00:00.000Z',
  endedAt: null,
  durationSeconds: null,
  dlqReason: null,
  cancelRequestedAt: null,
  monitoring: null,
  createdAt: '2026-10-14T12:00:00.000Z',
  events: [
    {
      id: 'synthetic-turn',
      eventType: 'call.transcript',
      timestamp: '2026-10-14T12:00:01.000Z',
      data: { role: 'agent', text: 'SYNTHETIC_PRIVATE_TRANSCRIPT' },
    },
  ],
  claim: {
    id: 'synthetic-claim',
    claimNumber: 'SYNTHETIC-CLAIM',
    payerCode: 'CIGNA_DENTAL',
    status: 'CALLING',
    priority: 80,
    serviceDate: '2026-10-01T00:00:00.000Z',
  },
};

function setup() {
  const client = createDentaBillQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryProvider client={client}>{children}</QueryProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  Object.assign(mocks.auth, { orgId: 'org-a', userId: 'user-a', isLoaded: true });
  mocks.get.mockReset();
  mocks.post.mockReset();
});

describe('useCall authentication scope', () => {
  it('ignores the old unscoped cache and sends an authenticated, abortable detail read', async () => {
    mocks.get.mockResolvedValue({ data: call });
    const { client, wrapper } = setup();
    client.setQueryData(['calls', 'detail', call.id], { ...call, id: 'old-unscoped' });
    const { result } = renderHook(() => useCall(call.id), { wrapper });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => {
      expect(result.current.data).toEqual(call);
    });
    expect(mocks.get).toHaveBeenCalledWith(
      '/v1/calls/{id}',
      expect.objectContaining({
        params: { path: { id: call.id } },
        headers: { authorization: 'Bearer synthetic-fixture' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(client.getQueryData(callQueryKey(call.id, 'org-a', 'user-a'))).toEqual(call);
  });

  it.each(['organization', 'user'] as const)(
    'aborts the old read and ignores its late response after a %s switch',
    async (change) => {
      let finish!: (value: { data: CallDetailResponse }) => void;
      mocks.get.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const { client, wrapper } = setup();
      const { result, rerender } = renderHook(() => useCall(call.id), { wrapper });
      await waitFor(() => {
        expect(mocks.get).toHaveBeenCalledTimes(1);
      });
      const signal = (mocks.get.mock.calls[0]?.[1] as { signal: AbortSignal }).signal;
      mocks.get.mockImplementation(() => new Promise(() => undefined));
      if (change === 'organization') mocks.auth.orgId = 'org-b';
      else mocks.auth.userId = 'user-b';
      rerender();
      expect(result.current.data).toBeUndefined();
      expect(signal.aborted).toBe(true);
      await act(async () => {
        finish({ data: call });
      });
      expect(result.current.data).toBeUndefined();
      expect(
        client.getQueryData(callQueryKey(call.id, mocks.auth.orgId, mocks.auth.userId)),
      ).toBeUndefined();
    },
  );

  it.each(['signed out', 'no practice', 'loading'] as const)(
    'hides cached details and does not read while %s',
    (state) => {
      const { client, wrapper } = setup();
      client.setQueryData(callQueryKey(call.id, 'org-a', 'user-a'), call);
      if (state === 'signed out') mocks.auth.userId = null;
      else if (state === 'no practice') mocks.auth.orgId = null;
      else mocks.auth.isLoaded = false;
      const { result } = renderHook(() => useCall(call.id), { wrapper });
      expect(result.current.data).toBeUndefined();
      expect(result.current.fetchStatus).toBe('idle');
      expect(mocks.get).not.toHaveBeenCalled();
    },
  );
});

describe('useCancelCall authentication scope', () => {
  it.each(['organization', 'user'] as const)(
    'merges a late cancellation only into its original cache after a %s switch',
    async (change) => {
      let finish!: (value: { data: CallDetailResponse }) => void;
      mocks.post.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const { client, wrapper } = setup();
      const originalKey = callQueryKey(call.id, 'org-a', 'user-a');
      const otherKey = callQueryKey(
        call.id,
        change === 'organization' ? 'org-b' : 'org-a',
        change === 'user' ? 'user-b' : 'user-a',
      );
      client.setQueryData(originalKey, call);
      const other = { ...call, events: [], claim: { ...call.claim, claimNumber: 'OTHER-SCOPE' } };
      client.setQueryData(otherKey, other);
      const { result, rerender } = renderHook(() => useCancelCall(call.id), { wrapper });
      let pending!: Promise<unknown>;
      act(() => {
        pending = result.current.mutateAsync();
      });
      await waitFor(() => {
        expect(mocks.post).toHaveBeenCalledTimes(1);
      });
      if (change === 'organization') mocks.auth.orgId = 'org-b';
      else mocks.auth.userId = 'user-b';
      rerender();
      const cancelled = { ...call, cancelRequestedAt: '2026-10-14T12:00:02.000Z' };
      await act(async () => {
        finish({ data: cancelled });
        await pending;
      });
      expect(client.getQueryData(originalKey)).toEqual(cancelled);
      expect(client.getQueryData(otherKey)).toEqual(other);
      expect(client.getQueryState(originalKey)?.isInvalidated).toBe(true);
    },
  );
});

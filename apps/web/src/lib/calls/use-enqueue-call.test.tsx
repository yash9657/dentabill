import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useEnqueueCall } from './use-enqueue-call.js';

const postMock = vi.fn();
vi.mock('../api-client.js', () => ({
  useDentaBillApi: () => ({ client: { POST: postMock }, withAuthHeaders: async () => ({}) }),
}));

describe('useEnqueueCall', () => {
  it('does not reopen a completed cached claim when a replay returns 202', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    postMock.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const client = createDentaBillQueryClient();
    const key = ['claims', 'detail', 'claim_synthetic'];
    client.setQueryData(key, { id: 'claim_synthetic', status: 'MANUAL_REVIEW' });
    const { result } = renderHook(() => useEnqueueCall(), {
      wrapper: ({ children }: React.PropsWithChildren) => (
        <QueryProvider client={client}>{children}</QueryProvider>
      ),
    });
    act(() => {
      result.current.mutate({ claimId: 'claim_synthetic' });
    });
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    client.setQueryData(key, { id: 'claim_synthetic', status: 'COMPLETED' });
    resolve({
      data: {
        jobId: 'intent_synthetic',
        claimId: 'claim_synthetic',
        attemptNumber: 1,
        queuedAt: '2026-10-13T12:00:00.000Z',
      },
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(client.getQueryData(key)).toMatchObject({ status: 'COMPLETED' });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
});

import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { detailClaimFixture } from '../../components/dashboard/claims/claim-source-details.fixtures.js';

import type { Claim, DetailClaim } from './types.js';
import { useUpdateClaimStatus } from './use-claim.js';

const auth = vi.hoisted(() => ({ orgId: 'org_a', userId: 'user_a', isLoaded: true }));
const patchMock = vi.hoisted(() => vi.fn());
vi.mock('@clerk/nextjs', () => ({ useAuth: () => auth }));
vi.mock('../api-client.js', () => ({
  useDentaBillApi: () => ({ client: { PATCH: patchMock }, withAuthHeaders: async () => ({}) }),
}));

describe('useUpdateClaimStatus tenant isolation', () => {
  it.each(['organization', 'user'])(
    'applies a late PATCH receipt only to its original cache after %s switches',
    async (scope) => {
      auth.orgId = 'org_a';
      auth.userId = 'user_a';
      patchMock.mockReset();
      const claim = detailClaimFixture();
      const { sourceDetails: _sourceDetails, ...shallow } = claim;
      let complete!: (response: { data: Claim }) => void;
      patchMock.mockReturnValueOnce(
        new Promise<{ data: Claim }>((resolve) => {
          complete = resolve;
        }),
      );
      const client = createDentaBillQueryClient();
      const originalKey = ['claims', 'detail', claim.id, 'org_a', 'user_a'];
      const otherKey = [
        'claims',
        'detail',
        claim.id,
        scope === 'organization' ? 'org_b' : 'org_a',
        scope === 'user' ? 'user_b' : 'user_a',
      ];
      client.setQueryData(originalKey, claim);
      const { result, rerender } = renderHook(() => useUpdateClaimStatus(claim.id), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryProvider client={client}>{children}</QueryProvider>
        ),
      });
      let pending!: Promise<Claim>;
      act(() => {
        pending = result.current.mutateAsync({ status: 'IN_QUEUE' });
      });
      await waitFor(() => {
        expect(patchMock).toHaveBeenCalledTimes(1);
      });
      if (scope === 'organization') auth.orgId = 'org_b';
      else auth.userId = 'user_b';
      rerender();
      await act(async () => {
        complete({ data: { ...shallow, status: 'IN_QUEUE' } });
        await pending;
      });
      expect(client.getQueryData(otherKey)).toBeUndefined();
      expect(client.getQueryData<DetailClaim>(originalKey)).toEqual({
        ...claim,
        status: 'IN_QUEUE',
      });
      expect(client.getQueryData<DetailClaim>(originalKey)?.sourceDetails).toEqual(
        claim.sourceDetails,
      );
    },
  );
});

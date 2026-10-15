import { transferableAbortController } from 'node:util';

import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditLogPage } from '../../components/dashboard/settings/audit-log-page.js';

import type { AuditLogsListResponse } from './types.js';
import { auditLogsQueryKey, useAuditLogs } from './use-audit-logs.js';

const auth = vi.hoisted((): { orgId: string | null; userId: string | null; isLoaded: boolean } => ({
  orgId: 'org-a',
  userId: 'user-a',
  isLoaded: true,
}));
const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock('@clerk/nextjs', () => ({ useAuth: () => auth }));
vi.mock('../api-client.js', async () => {
  const { createApiClient } = await import('@dentabill/api-sdk');
  const client = createApiClient({ baseUrl: 'http://synthetic.invalid', fetch: fetchMock });
  return {
    useDentaBillApi: () => ({
      client,
      withAuthHeaders: async () => ({ authorization: 'Bearer synthetic-audit-fixture' }),
    }),
  };
});

const firstPage: AuditLogsListResponse = {
  items: [
    {
      id: 'synthetic-audit-1',
      action: 'reconciliation.match',
      resourceType: 'CashBatchMatch',
      resourceId: 'synthetic-match',
      userId: 'synthetic-local-actor',
      metadata: { decision: 'MATCH' },
      createdAt: '2026-10-14T12:00:00.000Z',
    },
  ],
  nextCursor: 'synthetic-next-cursor',
  hasMore: true,
};
const secondPage: AuditLogsListResponse = {
  items: [{ ...firstPage.items[0]!, id: 'synthetic-audit-2', userId: null }],
  nextCursor: null,
  hasMore: false,
};
function response(page: AuditLogsListResponse) {
  return new Response(JSON.stringify(page), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
function setup() {
  const client = createDentaBillQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryProvider client={client}>{children}</QueryProvider>
  );
  return { client, wrapper };
}
beforeEach(() => {
  // openapi-fetch uses Node Request; its signal must use the same realm.
  vi.stubGlobal('AbortController', function NativeAbortController() {
    return transferableAbortController();
  });
  Object.assign(auth, { orgId: 'org-a', userId: 'user-a', isLoaded: true });
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('audit reads through the actual hook and generated SDK', () => {
  it.each(['Claim', 'Call', 'CallSummary', 'Organization'])(
    'sends the exact %s resource type selected in the actual dropdown',
    async (resourceType) => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(response({ items: [], nextCursor: null, hasMore: false })),
      );
      const { client } = setup();
      render(
        <QueryProvider client={client}>
          <AuditLogPage />
        </QueryProvider>,
      );
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
      await userEvent.setup().selectOptions(screen.getByLabelText('Resource Type'), resourceType);
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });
      const request = fetchMock.mock.calls[1]?.[0] as Request;
      expect(new URL(request.url).searchParams.get('resourceType')).toBe(resourceType);
    },
  );

  it('paginates API-shaped rows with current authentication and filters', async () => {
    fetchMock
      .mockResolvedValueOnce(response(firstPage))
      .mockResolvedValueOnce(response(secondPage));
    const { wrapper } = setup();
    const { result } = renderHook(
      () => useAuditLogs({ resourceType: 'CashBatchMatch', from: '2026-10-01' }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.pages[0]).toEqual(firstPage);
    expect(result.current.data?.pages[0]?.items[0]).not.toHaveProperty('user');
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => {
      expect(result.current.data?.pages).toEqual([firstPage, secondPage]);
    });
    expect(result.current.hasNextPage).toBe(false);
    const requests = fetchMock.mock.calls.map(([request]) => request as Request);
    expect(requests).toHaveLength(2);
    expect(
      requests.every(
        (request) => request.headers.get('authorization') === 'Bearer synthetic-audit-fixture',
      ),
    ).toBe(true);
    const url = new URL(requests[1]!.url);
    expect(url.pathname).toBe('/v1/audit-logs');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '25',
      resourceType: 'CashBatchMatch',
      from: '2026-10-01',
      cursor: 'synthetic-next-cursor',
    });
  });

  it.each(['organization', 'user'] as const)(
    'drops all prior pages on a %s change',
    async (change) => {
      fetchMock
        .mockResolvedValueOnce(response(firstPage))
        .mockResolvedValueOnce(response(secondPage));
      const { wrapper } = setup();
      const { result, rerender } = renderHook(() => useAuditLogs({}), { wrapper });
      await waitFor(() => {
        expect(result.current.data?.pages).toEqual([firstPage]);
      });
      await act(async () => {
        await result.current.fetchNextPage();
      });
      await waitFor(() => {
        expect(result.current.data?.pages).toEqual([firstPage, secondPage]);
      });
      fetchMock.mockImplementation(() => new Promise(() => undefined));
      if (change === 'organization') auth.orgId = 'org-b';
      else auth.userId = 'user-b';
      rerender();
      expect(result.current.data).toBeUndefined();
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(3);
      });
      expect(
        new URL((fetchMock.mock.calls[2]?.[0] as Request).url).searchParams.has('cursor'),
      ).toBe(false);
    },
  );

  it.each(['signed out', 'no practice', 'loading'] as const)(
    'does not read or reveal cached rows when %s',
    (state) => {
      const { client, wrapper } = setup();
      client.setQueryData(auditLogsQueryKey({}, 'org-a', 'user-a'), {
        pages: [firstPage],
        pageParams: [undefined],
      });
      if (state === 'signed out') auth.userId = null;
      else if (state === 'no practice') auth.orgId = null;
      else auth.isLoaded = false;
      const { result } = renderHook(() => useAuditLogs({}), { wrapper });
      expect(result.current.data).toBeUndefined();
      expect(result.current.fetchStatus).toBe('idle');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('shows a closed error without returning private server content or retrying', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'SYNTHETIC_PRIVATE_ERROR' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useAuditLogs({}), { wrapper });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toBe(
      'Audit logs could not be loaded. Reload the page to try again.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

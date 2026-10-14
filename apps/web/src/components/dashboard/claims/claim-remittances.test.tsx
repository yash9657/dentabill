import { transferableAbortController } from 'node:util';

import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  RemittanceEvidence,
  RemittanceList,
  RemittancePreview,
} from '../../../lib/claims/use-remittances.js';

import {
  remittanceFixture,
  remittanceListFixture,
  remittancePreviewFixture,
  reviewedRemittanceFixture,
} from './claim-remittances.fixtures.js';
import { ClaimRemittances } from './claim-remittances.js';

const auth = vi.hoisted((): { userId: string; orgId: string | null; isLoaded: boolean } => ({
  userId: 'user_a',
  orgId: 'org_a',
  isLoaded: true,
}));
const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>());
const headersMock = vi.hoisted(() => vi.fn<() => Promise<Record<string, string>>>());
vi.mock('@clerk/nextjs', () => ({ useAuth: () => auth }));
vi.mock('../../../lib/api-client.js', async () => {
  const { createApiClient } = await import('@dentabill/api-sdk');
  const client = createApiClient({ baseUrl: 'http://synthetic.invalid', fetch: fetchMock });
  return { useDentaBillApi: () => ({ client, withAuthHeaders: headersMock }) };
});

interface CapturedRequest {
  method: string;
  path: string;
  query: string;
  body: unknown;
  authorization: string | null;
}
let requests: CapturedRequest[];
let evidence: RemittanceEvidence;
let list: RemittanceList;
let preview: RemittancePreview;
let postHandler: ((request: CapturedRequest) => Promise<Response>) | undefined;
let getHandler: ((request: CapturedRequest) => Promise<Response>) | undefined;
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  vi.unstubAllGlobals();
});
beforeEach(() => {
  // openapi-fetch uses Node Request; use its native signal realm instead of jsdom's.
  vi.stubGlobal('AbortController', function NativeAbortController() {
    return transferableAbortController();
  });
  auth.userId = 'user_a';
  auth.orgId = 'org_a';
  auth.isLoaded = true;
  requests = [];
  evidence = remittanceFixture();
  list = remittanceListFixture([evidence]);
  preview = remittancePreviewFixture(evidence);
  postHandler = undefined;
  getHandler = undefined;
  headersMock.mockReset().mockImplementation(async () => ({
    authorization: `Bearer ${auth.userId}:${auth.orgId ?? 'personal'}`,
  }));
  fetchMock.mockReset().mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const item: CapturedRequest = {
      method: request.method,
      path: url.pathname,
      query: url.search,
      body: request.method === 'POST' ? ((await request.json()) as unknown) : null,
      authorization: request.headers.get('authorization'),
    };
    requests.push(item);
    if (request.method === 'POST') {
      if (postHandler) return postHandler(item);
      if (url.pathname.endsWith('/review')) {
        const decision = (item.body as { decision: 'ACCEPT' | 'REJECT' }).decision;
        evidence = reviewedRemittanceFixture(evidence, decision);
        list = remittanceListFixture([evidence]);
        if (decision === 'ACCEPT')
          list.summary = {
            ...list.summary,
            reviewedReportedAmount: '75.00',
            allocatedAmount: '40.00',
            unallocatedAmount: '35.00',
            acceptedCount: 1,
          };
        return json(evidence);
      }
      list = remittanceListFixture([evidence]);
      return json(evidence, 201);
    }
    if (getHandler) return getHandler(item);
    return json(url.pathname.endsWith('/preview') ? preview : list);
  });
});
function renderView(claimId = 'claim_a'): {
  user: ReturnType<typeof userEvent.setup>;
  rerender: (id?: string) => void;
} {
  const client = createDentaBillQueryClient();
  const view = (id: string) => (
    <QueryProvider client={client}>
      <ClaimRemittances claimId={id} />
    </QueryProvider>
  );
  const rendered = render(view(claimId));
  return {
    user: userEvent.setup({ applyAccept: false }),
    rerender: (id = claimId) => {
      rendered.rerender(view(id));
    },
  };
}
function file(body = JSON.stringify(remittanceFixture().payload), name = 'synthetic.json'): File {
  const value = new File([body], name, {
    type: name.endsWith('.json') ? 'application/json' : 'text/plain',
  });
  Object.defineProperty(value, 'text', { value: async () => body });
  return value;
}
async function openPreview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Preview remittance report-1' }));
  await screen.findByRole('region', { name: 'Review preview' });
}
function reviewRequests(): CapturedRequest[] {
  return requests.filter((item) => item.method === 'POST' && item.path.endsWith('/review'));
}

describe('remittance workflow with actual hooks and SDK transport', () => {
  it('imports partial payment, previews repeated codes by mapped line and accepts without adding allocation totals', async () => {
    list = remittanceListFixture();
    const { user } = renderView();
    await user.upload(screen.getByLabelText('Import remittance JSON'), file());
    await user.click(await screen.findByRole('button', { name: 'Import evidence' }));
    await screen.findByRole('heading', { name: 'Evidence: report-1' });
    expect(
      screen.queryByRole('button', { name: 'Accept reported evidence' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open fresh preview' }));
    const mapped = await screen.findByRole('list', { name: 'Mapped procedure allocations' });
    expect(within(mapped).getAllByText('D2391')).toHaveLength(2);
    expect(within(mapped).getByText('14')).toBeInTheDocument();
    expect(within(mapped).getByText('15')).toBeInTheDocument();
    expect(within(mapped).getByText('22222222-2222-4222-8222-222222222222')).toBeInTheDocument();
    expect(screen.getByText(/Unallocated portion: \$35.00/)).toHaveTextContent(
      'not the amount unpaid or outstanding',
    );
    await user.click(screen.getByRole('button', { name: 'Accept reported evidence' }));
    await screen.findByText(/Reported evidence accepted into the local reviewed totals/);
    await waitFor(() => {
      expect(screen.getByText('Net accepted payer reports').nextElementSibling).toHaveTextContent(
        '$75.00',
      );
    });
    expect(screen.getByText('Allocated portion').nextElementSibling).toHaveTextContent('$40.00');
    expect(screen.getByText('Unallocated portion').nextElementSibling).toHaveTextContent('$35.00');
    expect(screen.queryByText('$115.00')).not.toBeInTheDocument();
    expect(screen.getByText(/Cash receipt: unverified/)).toBeInTheDocument();
    expect(requests.find((item) => item.method === 'POST')?.body).toEqual(
      remittanceFixture().payload,
    );
  });

  it('shows zero dollar reports, optional identities and unknown adjustment codes exactly as supplied', async () => {
    evidence = remittanceFixture();
    evidence.payload = {
      ...evidence.payload,
      reportedAmount: '0.00',
      sourceCoverageId: null,
      paymentTrace: null,
      allocations: [],
      lineDetailCompleteness: 'ABSENT',
    };
    list = remittanceListFixture([evidence]);
    preview = { ...remittancePreviewFixture(evidence), unallocatedAmount: '0.00', allocations: [] };
    const { user } = renderView();
    await openPreview(user);
    const selected = screen.getByRole('article', { name: 'Evidence: report-1' });
    expect(within(selected).getByText('Reported amount').nextElementSibling).toHaveTextContent(
      '$0.00',
    );
    expect(within(selected).getByText('Source coverage ID').nextElementSibling).toHaveTextContent(
      'Not supplied',
    );
    expect(within(selected).getByText('Payment trace').nextElementSibling).toHaveTextContent(
      'Not supplied',
    );
    expect(within(selected).getByText('Source status').nextElementSibling).toHaveTextContent(
      'PARTIAL AS REPORTED',
    );
    await user.click(within(selected).getByText('Source allocations and raw adjustments'));
    const adjustments = screen.getByRole('list', { name: 'Raw adjustments' });
    for (const text of ['UNKNOWN', 'ZZ', 'raw-code-9', '-$5.00'])
      expect(within(adjustments).getByText(text)).toBeVisible();
    expect(
      screen.getByText(/No denial, write-off or patient liability is inferred/),
    ).toBeInTheDocument();
  });

  it('blocks an orphan reversal from acceptance but allows explicit rejection', async () => {
    evidence.payload = {
      ...evidence.payload,
      kind: 'REVERSAL',
      reportedAmount: '-10.00',
      reversesSourceRecordId: 'missing-original',
      allocations: [],
      lineDetailCompleteness: 'ABSENT',
      adjustments: [],
    };
    list = remittanceListFixture([evidence]);
    preview = {
      ...remittancePreviewFixture(evidence),
      blockers: ['ORIGINAL_MISSING'],
      unallocatedAmount: '-10.00',
      allocations: [],
    };
    const { user } = renderView();
    await openPreview(user);
    expect(
      screen.getByText('The original payment report for this reversal is missing.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept reported evidence' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Reject evidence' }));
    await screen.findByText(/Evidence rejected/);
    expect(reviewRequests()[0]?.body).toMatchObject({ decision: 'REJECT' });
  });

  it('serializes double clicks and retains exact review key, token and decision after a lost response', async () => {
    const gate = deferred<Response>();
    postHandler = async () => gate.promise;
    const { user } = renderView();
    await openPreview(user);
    const accept = screen.getByRole('button', { name: 'Accept reported evidence' });
    fireEvent.click(accept);
    fireEvent.click(accept);
    await waitFor(() => {
      expect(reviewRequests()).toHaveLength(1);
    });
    await act(async () => {
      gate.resolve(json({ message: 'unconfirmed' }, 503));
    });
    const retry = await screen.findByRole('button', { name: 'Retry same review' });
    expect(screen.getByRole('button', { name: 'Preview remittance report-1' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Reject evidence' })).not.toBeInTheDocument();
    postHandler = async () => json(reviewedRemittanceFixture(evidence, 'ACCEPT'));
    await user.click(retry);
    await screen.findByText(/Reported evidence accepted/);
    expect(reviewRequests()).toHaveLength(2);
    expect(reviewRequests()[1]?.body).toEqual(reviewRequests()[0]?.body);
    expect(reviewRequests()[0]?.body).toMatchObject({
      decision: 'ACCEPT',
      reviewToken: 'b'.repeat(64),
      idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/),
    });
  });

  it('drops a stale token after409 and requires a fresh preview and human decision', async () => {
    postHandler = async () => json({ code: 'CONFLICT' }, 409);
    const { user } = renderView();
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'Accept reported evidence' }));
    await screen.findByText(/changed before the review was recorded/);
    expect(
      screen.queryByRole('button', { name: 'Accept reported evidence' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Review preview' })).not.toBeInTheDocument();
    preview = { ...preview, reviewToken: 'c'.repeat(64) };
    postHandler = async () => json(reviewedRemittanceFixture(evidence, 'ACCEPT'));
    await user.click(screen.getByRole('button', { name: 'Open fresh preview' }));
    await user.click(await screen.findByRole('button', { name: 'Accept reported evidence' }));
    await screen.findByText(/Reported evidence accepted/);
    expect(reviewRequests()[1]?.body).toMatchObject({ reviewToken: 'c'.repeat(64) });
    expect((reviewRequests()[1]?.body as { idempotencyKey: string }).idempotencyKey).not.toBe(
      (reviewRequests()[0]?.body as { idempotencyKey: string }).idempotencyKey,
    );
    expect(
      requests.filter((item) => item.method === 'GET' && item.path.endsWith('/remittances')).length,
    ).toBeGreaterThan(1);
  });

  it('retries an ambiguous import with the identical payload and blocks replacement files', async () => {
    list = remittanceListFixture();
    postHandler = async () => {
      throw new Error('private raw response');
    };
    const { user } = renderView();
    await user.upload(screen.getByLabelText('Import remittance JSON'), file());
    await user.click(await screen.findByRole('button', { name: 'Import evidence' }));
    await screen.findByText(/import could not be confirmed/);
    expect(screen.getByLabelText('Import remittance JSON')).toBeDisabled();
    expect(screen.queryByText(/private raw response/)).not.toBeInTheDocument();
    postHandler = async () => json(evidence, 200);
    await user.click(screen.getByRole('button', { name: 'Retry same import' }));
    await screen.findByText(/Evidence saved/);
    const sent = requests.filter((item) => item.method === 'POST');
    expect(sent).toHaveLength(2);
    expect(sent[1]?.body).toEqual(sent[0]?.body);
  });

  it.each(['{broken secret source text', '[]', '{"schemaVersion":2}'])(
    'rejects invalid custom JSON with a closed message',
    async (body) => {
      const { user } = renderView();
      await user.upload(screen.getByLabelText('Import remittance JSON'), file(body));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'not a valid version 1 remittance JSON object',
      );
      expect(screen.queryByText(/secret source text/)).not.toBeInTheDocument();
      expect(requests.filter((item) => item.method === 'POST')).toHaveLength(0);
    },
  );

  it('rejects empty and >1MiB input before importing', async () => {
    const { user } = renderView();
    await user.upload(screen.getByLabelText('Import remittance JSON'), file(''));
    expect(await screen.findByRole('alert')).toHaveTextContent('up to 1 MiB');
    await user.upload(
      screen.getByLabelText('Import remittance JSON'),
      file('a'.repeat(1024 * 1024 + 1)),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('up to 1 MiB');
    expect(requests.filter((item) => item.method === 'POST')).toHaveLength(0);
  });

  it('loads cursor pages at25 and bounds each500-item evidence array to50', async () => {
    const extra = remittanceFixture({ id: '55555555-5555-4555-8555-555555555555' });
    extra.payload = { ...extra.payload, sourceRecordId: 'report-2' };
    list = { ...list, nextCursor: 'cursor-one', hasMore: true };
    evidence.payload.allocations = Array.from({ length: 500 }, (_, i) => ({
      sourceLineId: `line-${String(i)}`,
      amount: '0.00',
      sourceStatus: null,
    }));
    evidence.payload.adjustments = Array.from({ length: 500 }, (_, i) => ({
      sourceAdjustmentId: `adjust-${String(i)}`,
      sourceLineId: null,
      codeSystem: 'UNKNOWN',
      groupCode: null,
      reasonCode: 'raw',
      amount: '0.00',
      sourceReference: null,
    }));
    preview = {
      ...preview,
      evidence,
      allocations: evidence.payload.allocations.map((row) => ({
        ...row,
        lineId: null,
        procedureCode: null,
        tooth: null,
      })),
    };
    getHandler = async (item) =>
      json(
        item.path.endsWith('/preview')
          ? preview
          : item.query.includes('cursor=cursor-one')
            ? remittanceListFixture([extra])
            : list,
      );
    const { user } = renderView();
    await user.click(await screen.findByRole('button', { name: 'Load more remittances' }));
    await screen.findByRole('button', { name: 'Preview remittance report-2' });
    expect(
      requests
        .filter((item) => item.method === 'GET')
        .every((item) => item.query.includes('limit=25')),
    ).toBe(true);
    await openPreview(user);
    await user.click(screen.getByText('Source allocations and raw adjustments'));
    for (const name of ['Source allocations', 'Raw adjustments', 'Mapped procedure allocations'])
      expect(within(screen.getByRole('list', { name })).getAllByRole('listitem')).toHaveLength(50);
    for (let i = 0; i < 9; i++)
      await user.click(screen.getByRole('button', { name: 'Next raw adjustments' }));
    expect(
      within(screen.getByRole('list', { name: 'Raw adjustments' })).getByText('adjust-499'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next raw adjustments' })).toBeDisabled();
  });

  it.each(['organization', 'user', 'claim'])(
    'clears evidence and blocks delayed-auth review on %s switch',
    async (change) => {
      if (change === 'user') auth.orgId = null;
      const { user, rerender } = renderView();
      await openPreview(user);
      const delayedAuth = deferred<Record<string, string>>();
      headersMock.mockReturnValueOnce(delayedAuth.promise);
      await user.click(screen.getByRole('button', { name: 'Accept reported evidence' }));
      if (change === 'organization') auth.orgId = 'org_b';
      if (change === 'user') auth.userId = 'user_b';
      const newList = deferred<Response>();
      getHandler = async () => newList.promise;
      rerender(change === 'claim' ? 'claim_b' : undefined);
      expect(screen.queryByRole('article', { name: 'Evidence: report-1' })).not.toBeInTheDocument();
      await act(async () => {
        delayedAuth.resolve({ authorization: 'Bearer other-scope' });
        newList.resolve(json(remittanceListFixture()));
      });
      expect(reviewRequests()).toHaveLength(0);
      expect(screen.queryByRole('button', { name: 'Retry same review' })).not.toBeInTheDocument();
      await screen.findByText('No remittance evidence has been imported for this claim.');
    },
  );

  it('ignores a late successful review response after switching personal users', async () => {
    auth.orgId = null;
    const gate = deferred<Response>();
    postHandler = async () => gate.promise;
    const { user, rerender } = renderView();
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'Accept reported evidence' }));
    await waitFor(() => {
      expect(reviewRequests()).toHaveLength(1);
    });
    auth.userId = 'user_b';
    list = remittanceListFixture();
    rerender();
    await screen.findByText('No remittance evidence has been imported for this claim.');
    await act(async () => {
      gate.resolve(json(reviewedRemittanceFixture(evidence, 'ACCEPT')));
    });
    expect(screen.queryByText(/Reported evidence accepted/)).not.toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Evidence: report-1' })).not.toBeInTheDocument();
  });
});

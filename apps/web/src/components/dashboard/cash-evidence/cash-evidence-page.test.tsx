import { transferableAbortController } from 'node:util';

import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CashEvidence,
  CashHistory,
  CashList,
  CashPreview,
} from '../../../lib/cash-evidence/use-cash-evidence.js';

import { CashEvidencePage } from './cash-evidence-page.js';
import {
  cashEvidenceFixture,
  cashHistoryFixture,
  cashListFixture,
  cashPreviewFixture,
  cashReviewedFixture,
  cashTransactionFixture,
} from './cash-evidence.fixtures.js';

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
interface RequestRecord {
  method: string;
  path: string;
  query: string;
  body: unknown;
}
let requests: RequestRecord[];
let evidence: CashEvidence;
let list: CashList;
let history: CashHistory;
let preview: CashPreview;
let getHandler: ((request: RequestRecord) => Promise<Response>) | undefined;
let postHandler: ((request: RequestRecord) => Promise<Response>) | undefined;
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
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
  // Node Request requires the native AbortSignal realm, rather than jsdom's signal.
  vi.stubGlobal('AbortController', function NativeAbortController() {
    return transferableAbortController();
  });
  auth.userId = 'user_a';
  auth.orgId = 'org_a';
  auth.isLoaded = true;
  requests = [];
  evidence = cashEvidenceFixture();
  list = cashListFixture([cashTransactionFixture(evidence)]);
  history = cashHistoryFixture(list.items[0]);
  preview = cashPreviewFixture(evidence);
  getHandler = undefined;
  postHandler = undefined;
  headersMock.mockReset().mockImplementation(async () => ({
    authorization: `Bearer ${auth.userId}:${auth.orgId ?? 'personal'}`,
  }));
  fetchMock.mockReset().mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const record = {
      method: req.method,
      path: url.pathname,
      query: url.search,
      body: req.method === 'POST' ? ((await req.json()) as unknown) : null,
    };
    requests.push(record);
    if (record.method === 'POST') {
      if (postHandler) return postHandler(record);
      if (record.path.endsWith('/review')) {
        const decision = (record.body as { decision: 'ACCEPT' | 'REJECT' }).decision;
        evidence = cashReviewedFixture(evidence, decision);
        const transaction = cashTransactionFixture(
          evidence,
          decision === 'ACCEPT' ? { currentAcceptedEvidence: evidence, freshness: 'CURRENT' } : {},
        );
        list = cashListFixture([transaction]);
        history = cashHistoryFixture(transaction, [evidence]);
        if (decision === 'ACCEPT')
          list.accounts[0] = {
            ...list.accounts[0]!,
            postedCreditAmount: evidence.payload.status === 'POSTED' ? '100.00' : '0.00',
            postedNetAmount: evidence.payload.status === 'POSTED' ? '100.00' : '0.00',
            postedCount: evidence.payload.status === 'POSTED' ? 1 : 0,
            unreviewedCount: 0,
            reviewNeededCount: 0,
          };
        return json(evidence);
      }
      list = cashListFixture([cashTransactionFixture(evidence)]);
      return json(evidence, 201);
    }
    if (getHandler) return getHandler(record);
    return json(
      record.path.endsWith('/preview')
        ? preview
        : record.path.includes('/transactions/')
          ? history
          : list,
    );
  });
});
function renderView(): { user: ReturnType<typeof userEvent.setup>; rerender: () => void } {
  const client = createDentaBillQueryClient();
  const view = () => (
    <QueryProvider client={client}>
      <CashEvidencePage />
    </QueryProvider>
  );
  const result = render(view());
  return {
    user: userEvent.setup({ applyAccept: false }),
    rerender: () => {
      result.rerender(view());
    },
  };
}
function file(body = JSON.stringify(cashEvidenceFixture().payload)): File {
  const f = new File([body], 'synthetic.json', { type: 'application/json' });
  Object.defineProperty(f, 'text', { value: async () => body });
  return f;
}
async function openPreview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(
    await screen.findByRole('button', {
      name: 'View transaction source-transaction-a in account opaque-account-a',
    }),
  );
  await user.click(
    await screen.findByRole('button', {
      name: `Preview source sequence ${String(evidence.payload.sourceSequence)}`,
    }),
  );
  await screen.findByRole('region', { name: 'Source review preview' });
}
const reviewRequests = (): RequestRecord[] =>
  requests.filter((r) => r.method === 'POST' && r.path.endsWith('/review'));

describe('cash evidence workflow using actual hook and SDK transport', () => {
  it('imports a source revision, preserves original signs and accepts a replacement without adding the prior amount', async () => {
    const old = cashReviewedFixture({
      ...evidence,
      id: '44444444-4444-4444-8444-444444444444',
      payload: {
        ...evidence.payload,
        sourceSequence: 1,
        status: 'PENDING',
        amount: '90.00',
        sourceAmount: '-90.00',
      },
    });
    evidence.payload.pendingSourceTransactionId = 'pending-source-transaction';
    preview = {
      ...cashPreviewFixture(evidence),
      currentAcceptedEvidence: old,
      nextIncludedAmount: '100.00',
    };
    history = cashHistoryFixture(
      cashTransactionFixture(evidence, { currentAcceptedEvidence: old, freshness: 'STALE' }),
      [evidence, old],
    );
    list = cashListFixture();
    const { user } = renderView();
    expect(screen.getByRole('link', { name: 'Download synthetic example JSON' })).toHaveAttribute(
      'download',
    );
    await user.upload(
      screen.getByLabelText('Bank-account transaction JSON'),
      file(JSON.stringify(evidence.payload)),
    );
    await user.click(await screen.findByRole('button', { name: 'Import source revision' }));
    await screen.findByText(/Source revision saved/);
    await user.click(screen.getByRole('button', { name: 'Open fresh source preview' }));
    const article = screen.getByRole('article');
    expect(
      within(article).getByText('Original source amount (USD)').nextElementSibling,
    ).toHaveTextContent('-$100.00');
    expect(
      within(article).getByText('Canonical signed amount (USD)').nextElementSibling,
    ).toHaveTextContent('$100.00');
    expect(within(article).getByText('DEBIT_POSITIVE')).toBeInTheDocument();
    expect(within(article).getByText('pending-source-transaction')).toBeInTheDocument();
    expect(screen.getByText(/not added to the previous revision/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept source revision' }));
    await screen.findByText(/Source revision accepted/);
    await waitFor(() => {
      expect(screen.getByText('Posted net').nextElementSibling).toHaveTextContent('$100.00');
    });
    expect(screen.queryByText('$190.00')).not.toBeInTheDocument();
    expect(screen.getByText(/not yet linked to claims/)).toBeInTheDocument();
  });

  it('shows stale accepted history excluded, and older unreviewed sequences can only be rejected', async () => {
    const old = {
      ...evidence,
      id: '44444444-4444-4444-8444-444444444444',
      payload: { ...evidence.payload, sourceSequence: 1, sourceRecordId: 'earlier-record' },
    };
    list.items[0] = cashTransactionFixture(evidence, {
      currentAcceptedEvidence: cashReviewedFixture(old),
      freshness: 'STALE',
    });
    history = cashHistoryFixture(list.items[0], [evidence, old]);
    preview = {
      ...cashPreviewFixture(old),
      latestSourceSequence: 2,
      blockers: ['NEWER_SOURCE_EVIDENCE'],
      currentAcceptedEvidence: cashReviewedFixture(old),
      nextIncludedAmount: null,
    };
    const { user } = renderView();
    expect(await screen.findByText('Stale accepted revision · excluded')).toBeInTheDocument();
    expect(screen.getByText('Posted net').nextElementSibling).toHaveTextContent('$0.00');
    await user.click(screen.getByRole('button', { name: /View transaction/ }));
    await user.click(await screen.findByRole('button', { name: 'Preview source sequence 1' }));
    expect(await screen.findByRole('button', { name: 'Accept source revision' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Reject source revision' }));
    await screen.findByText(/rejection does not restore a stale revision/);
    expect(reviewRequests()[0]?.body).toMatchObject({ decision: 'REJECT' });
  });

  it('keeps removal amounts unknown and distinguishes removal from a refund', async () => {
    evidence.payload = {
      ...evidence.payload,
      sourceSequence: 3,
      status: 'REMOVED',
      amount: null,
      sourceAmount: null,
    };
    list = cashListFixture([cashTransactionFixture(evidence)]);
    history = cashHistoryFixture(list.items[0]);
    preview = { ...cashPreviewFixture(evidence), priorIncludedAmount: '100.00' };
    const { user } = renderView();
    await openPreview(user);
    const article = screen.getByRole('article');
    for (const label of ['Canonical signed amount (USD)', 'Original source amount (USD)'])
      expect(within(article).getByText(label).nextElementSibling).toHaveTextContent('Unknown');
    expect(within(article).getByText(/not evidence of a refund/)).toBeInTheDocument();
    expect(
      within(article).getByText('Proposed included amount').nextElementSibling,
    ).toHaveTextContent('Excluded');
    expect(within(article).queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('keeps opaque accounts separate across connector identity without a combined total', async () => {
    list.accounts = [
      { ...list.accounts[0]!, postedCreditAmount: '100.00', postedNetAmount: '100.00' },
      {
        ...list.accounts[0]!,
        sourceProduct: 'other-connector',
        postedCreditAmount: '200.00',
        postedNetAmount: '200.00',
      },
    ];
    renderView();
    const accounts = await screen.findByRole('list', { name: 'Account source totals' });
    const rows = within(accounts).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('$100.00');
    expect(rows[1]).toHaveTextContent('$200.00');
    expect(screen.queryByText('$300.00')).not.toBeInTheDocument();
  });

  it.each(['POSTED_REPLACEMENT_OVERLAP', 'PENDING_LINK_CHANGED', 'SOURCE_LINK_LIMIT'] as const)(
    'blocks acceptance for %s while preserving rejection',
    async (blocker) => {
      preview.blockers = [blocker];
      const { user } = renderView();
      await openPreview(user);
      expect(screen.getByRole('list', { name: 'Source review blockers' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Accept source revision' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Reject source revision' })).toBeEnabled();
    },
  );

  it('does not offer another review for an already-reviewed revision', async () => {
    preview.evidence = cashReviewedFixture(evidence);
    preview.blockers = ['ALREADY_REVIEWED'];
    const { user } = renderView();
    await openPreview(user);
    expect(
      screen.queryByRole('button', { name: 'Accept source revision' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reject source revision' }),
    ).not.toBeInTheDocument();
  });

  it('guards double clicks and retries the identical review after an unconfirmed response', async () => {
    const gate = deferred<Response>();
    postHandler = async () => gate.promise;
    const { user } = renderView();
    await openPreview(user);
    const accept = screen.getByRole('button', { name: 'Accept source revision' });
    fireEvent.click(accept);
    fireEvent.click(accept);
    await waitFor(() => {
      expect(reviewRequests()).toHaveLength(1);
    });
    await act(async () => {
      gate.resolve(json({ code: 'INTERNAL_ERROR' }, 500));
    });
    const retry = await screen.findByRole('button', { name: 'Retry same review' });
    expect(screen.getByLabelText('Bank-account transaction JSON')).toBeDisabled();
    postHandler = async () => json(cashReviewedFixture(evidence));
    await user.click(retry);
    await screen.findByText(/Source revision accepted/);
    expect(reviewRequests()).toHaveLength(2);
    expect(reviewRequests()[1]?.body).toEqual(reviewRequests()[0]?.body);
  });

  it('clears a409 preview, refreshes history and requires a new explicit decision', async () => {
    postHandler = async () => json({ code: 'CONFLICT' }, 409);
    const { user } = renderView();
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'Accept source revision' }));
    await screen.findByText(/Source evidence changed before/);
    expect(screen.queryByRole('region', { name: 'Source review preview' })).not.toBeInTheDocument();
    preview.reviewToken = 'c'.repeat(64);
    postHandler = async () => json(cashReviewedFixture(evidence));
    await user.click(screen.getByRole('button', { name: 'Open fresh source preview' }));
    await user.click(await screen.findByRole('button', { name: 'Accept source revision' }));
    await screen.findByText(/Source revision accepted/);
    expect(reviewRequests()[1]?.body).toMatchObject({ reviewToken: 'c'.repeat(64) });
    expect((reviewRequests()[1]?.body as { idempotencyKey: string }).idempotencyKey).not.toBe(
      (reviewRequests()[0]?.body as { idempotencyKey: string }).idempotencyKey,
    );
    expect(requests.filter((r) => r.path.includes('/transactions/')).length).toBeGreaterThan(1);
  });

  it('keeps import payload stable on network failure and displays closed server validation errors', async () => {
    postHandler = async () => {
      throw new Error('private account detail');
    };
    const { user } = renderView();
    await user.upload(
      screen.getByLabelText('Bank-account transaction JSON'),
      file(JSON.stringify({ ...evidence.payload, sourceSignConvention: 'UNKNOWN' })),
    );
    await user.click(await screen.findByRole('button', { name: 'Import source revision' }));
    await screen.findByText(/import could not be confirmed/);
    expect(screen.getByLabelText('Bank-account transaction JSON')).toBeDisabled();
    postHandler = async () => json({ message: 'private source sign convention' }, 400);
    await user.click(screen.getByRole('button', { name: 'Retry same import' }));
    await screen.findByText(/Check its status, signed amounts, source sequence/);
    const sent = requests.filter((r) => r.method === 'POST');
    expect(sent[1]?.body).toEqual(sent[0]?.body);
    expect(sent[0]?.body).toMatchObject({ sourceSignConvention: 'UNKNOWN' });
    expect(screen.queryByText(/private/)).not.toBeInTheDocument();
  });

  it.each([
    '',
    '{private malformed',
    '[]',
    '{"schemaVersion":1,"evidenceBasis":"PMS_DEPOSIT"}',
    'x'.repeat(64 * 1024 + 1),
  ])('rejects malformed, wrong-basis and oversized files before HTTP import', async (body) => {
    const { user } = renderView();
    await user.upload(screen.getByLabelText('Bank-account transaction JSON'), file(body));
    expect(await screen.findByRole('alert')).toHaveTextContent(/JSON|64 KiB/);
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    expect(screen.queryByText(/private malformed/)).not.toBeInTheDocument();
  });

  it('paginates transactions and full source history at20, preserving account summaries from loaded pages', async () => {
    list.hasMore = true;
    list.nextCursor = 'next-transaction';
    const next = cashListFixture();
    next.accounts = [{ ...list.accounts[0]!, sourceAccountId: 'opaque-account-b' }];
    history.hasMore = true;
    history.nextCursor = 'older-revision';
    const older = {
      ...evidence,
      id: '44444444-4444-4444-8444-444444444444',
      payload: { ...evidence.payload, sourceSequence: 1 },
    };
    getHandler = async (r) =>
      json(
        r.path.includes('/transactions/')
          ? r.query.includes('older-revision')
            ? cashHistoryFixture(history.transaction, [older])
            : history
          : r.query.includes('next-transaction')
            ? next
            : list,
      );
    const { user } = renderView();
    const accounts = await screen.findByRole('list', { name: 'Account source totals' });
    expect(within(accounts).getAllByRole('listitem')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Load more transactions' }));
    await waitFor(() => {
      expect(within(accounts).getAllByRole('listitem')).toHaveLength(2);
    });
    await user.click(screen.getByRole('button', { name: /View transaction/ }));
    await user.click(await screen.findByRole('button', { name: 'Load older revisions' }));
    await screen.findByRole('button', { name: 'Preview source sequence 1' });
    expect(
      requests.filter((r) => r.method === 'GET').every((r) => r.query.includes('limit=20')),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Load older revisions' })).not.toBeInTheDocument();
  });

  it.each(['user', 'organization'])(
    'blocks pending-auth review on %s change and clears old evidence',
    async (change) => {
      auth.orgId = change === 'user' ? null : 'org_a';
      const { user, rerender } = renderView();
      await openPreview(user);
      const gate = deferred<Record<string, string>>();
      headersMock.mockReturnValueOnce(gate.promise);
      await user.click(screen.getByRole('button', { name: 'Accept source revision' }));
      if (change === 'user') auth.userId = 'user_b';
      else auth.orgId = 'org_b';
      list = cashListFixture();
      rerender();
      expect(screen.queryByRole('article')).not.toBeInTheDocument();
      await act(async () => {
        gate.resolve({ authorization: 'Bearer changed' });
      });
      await screen.findByText('No bank-account evidence has been imported.');
      expect(reviewRequests()).toHaveLength(0);
    },
  );

  it('ignores a late review success after a personal-user switch', async () => {
    auth.orgId = null;
    const gate = deferred<Response>();
    postHandler = async () => gate.promise;
    const { user, rerender } = renderView();
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'Accept source revision' }));
    await waitFor(() => {
      expect(reviewRequests()).toHaveLength(1);
    });
    auth.userId = 'user_b';
    list = cashListFixture();
    rerender();
    await act(async () => {
      gate.resolve(json(cashReviewedFixture(evidence)));
    });
    await screen.findByText('No bank-account evidence has been imported.');
    expect(screen.queryByText(/Source revision accepted/)).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});

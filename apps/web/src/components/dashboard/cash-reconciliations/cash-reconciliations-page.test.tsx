import { transferableAbortController } from 'node:util';

import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CashList } from '../../../lib/cash-evidence/use-cash-evidence.js';
import type {
  MatchCandidate,
  MatchList,
  MatchPreview,
  ReleaseCandidate,
  ReleasePreview,
} from '../../../lib/cash-reconciliations/use-cash-reconciliations.js';
import type { BatchList } from '../../../lib/remittance-batches/use-remittance-batches.js';
import {
  batchReviewedFixture,
  batchV2Fixture,
} from '../remittance-batches/remittance-batches.fixtures.js';

import { CashReconciliationsPage } from './cash-reconciliations-page.js';
import {
  cashMatchFixture,
  matchListFixture,
  matchPreviewFixture,
  matchReceiptFixture,
  reconciliationBatchesFixture,
  reconciliationCashFixture,
  releasePreviewFixture,
  releaseReceiptFixture,
} from './cash-reconciliations.fixtures.js';

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
  authorization: string | null;
}
let requests: RequestRecord[];
let cash: CashList;
let batches: BatchList;
let matches: MatchList;
let preview: MatchPreview;
let releasePreview: ReleasePreview;
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
  vi.stubGlobal('AbortController', function NativeAbortController() {
    return transferableAbortController();
  });
  auth.userId = 'user_a';
  auth.orgId = 'org_a';
  auth.isLoaded = true;
  requests = [];
  cash = reconciliationCashFixture();
  batches = reconciliationBatchesFixture();
  matches = matchListFixture();
  preview = matchPreviewFixture();
  releasePreview = releasePreviewFixture();
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
      authorization: req.headers.get('authorization'),
    };
    requests.push(record);
    if (record.method === 'POST') {
      if (postHandler) return postHandler(record);
      if (record.path.endsWith('/release/preview'))
        return json({ ...releasePreview, reason: (record.body as ReleaseCandidate).reason });
      if (record.path.endsWith('/release')) {
        const release = releaseReceiptFixture((record.body as ReleaseCandidate).reason);
        matches = matchListFixture([{ ...cashMatchFixture(), status: 'RELEASED', release }]);
        return json(release, 201);
      }
      if (record.path.endsWith('/preview')) return json({ ...preview, candidate: record.body });
      const candidate = record.body as MatchCandidate;
      matches = matchListFixture([cashMatchFixture({ amount: candidate.amount })]);
      return json(matchReceiptFixture(candidate), 201);
    }
    if (getHandler) return getHandler(record);
    return json(
      record.path === '/v1/cash-evidence'
        ? cash
        : record.path === '/v1/remittance-batches'
          ? batches
          : matches,
    );
  });
});
function renderView(): { user: ReturnType<typeof userEvent.setup>; rerender: () => void } {
  const client = createDentaBillQueryClient();
  const view = () => (
    <QueryProvider client={client}>
      <CashReconciliationsPage />
    </QueryProvider>
  );
  const result = render(view());
  return {
    user: userEvent.setup(),
    rerender: () => {
      result.rerender(view());
    },
  };
}
async function chooseSources(
  user: ReturnType<typeof userEvent.setup>,
  amount = '150.00',
): Promise<void> {
  await screen.findByRole('option', { name: /source-transaction-a/ });
  await user.selectOptions(
    screen.getByLabelText('Reviewed cash source'),
    cash.items[0]!.currentAcceptedEvidence!.id,
  );
  await user.selectOptions(
    screen.getByLabelText('Reviewed remittance batch'),
    batches.items[0]!.id,
  );
  await user.type(screen.getByLabelText('Signed match amount (USD)'), amount);
}
async function openPreview(
  user: ReturnType<typeof userEvent.setup>,
  amount = '150.00',
): Promise<void> {
  await chooseSources(user, amount);
  await user.click(screen.getByRole('button', { name: 'Open fresh match preview' }));
  await screen.findByRole('heading', { name: 'Review proposed source match' });
}
async function openRelease(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(
    await screen.findByRole('button', {
      name: 'Review release for source-transaction-a to synthetic-batch-a',
    }),
  );
  expect(screen.getByRole('button', { name: 'Open fresh release preview' })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('Release reason'), 'SOURCE_CHANGED');
  await user.click(screen.getByRole('button', { name: 'Open fresh release preview' }));
  await screen.findByRole('region', { name: 'Full release preview' });
}
const matchRequests = (): RequestRecord[] =>
  requests.filter((r) => r.method === 'POST' && r.path === '/v1/cash-reconciliations');
const releaseRequests = (): RequestRecord[] =>
  requests.filter((r) => r.method === 'POST' && r.path.endsWith('/release'));

describe('cash reconciliation with the actual hook and generated SDK transport', () => {
  it('requires explicit source selections, keeps original cash signs, and matches the150 batch net without claim allocation', async () => {
    const { user } = renderView();
    await screen.findByRole('option', { name: /source-transaction-a/ });
    expect(screen.getByLabelText('Reviewed cash source')).toHaveValue('');
    expect(screen.getByLabelText('Reviewed remittance batch')).toHaveValue('');
    expect(screen.getByLabelText('Signed match amount (USD)')).toHaveValue('');
    await openPreview(user);
    const article = screen.getByRole('article');
    for (const [label, value] of [
      ['Canonical cash amount', '+$150.00'],
      ['Original source cash amount', '−$150.00'],
      ['Claim-reported amount', '+$180.00'],
      ['Provider adjustment net effect', '−$30.00'],
      ['Batch source net', '+$150.00'],
      ['Cash available before this match', '$150.00'],
      ['Batch available before this match', '$150.00'],
    ])
      expect(within(article).getByText(label!).nextElementSibling).toHaveTextContent(value!);
    expect(within(article).getByText('DEBIT_POSITIVE')).toBeInTheDocument();
    expect(within(article).getByText('synthetic-bank / transactions')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Record reviewed match' }));
    await screen.findByText(/Match recorded/);
    expect(screen.getByText(/No money moved and no claim received/)).toBeInTheDocument();
    expect(await screen.findByText('Current source match')).toBeInTheDocument();
    expect(matchRequests()[0]?.body).toMatchObject({
      cashEvidenceId: cash.items[0]!.currentAcceptedEvidence!.id,
      batchEvidenceId: batches.items[0]!.id,
      amount: '150.00',
      reviewToken: 'a'.repeat(64),
    });
    expect(requests[0]?.authorization).toBe('Bearer user_a:org_a');
  });

  it('keeps selected cash accounts distinct across connector identity without combined totals', async () => {
    const first = cash.items[0]!;
    const other = {
      ...first.latestEvidence,
      id: '88888888-8888-4888-8888-888888888888',
      transactionId: '99999999-9999-4999-8999-999999999999',
      payload: { ...first.latestEvidence.payload, sourceProduct: 'other-connector' },
    };
    cash.items.push({
      ...first,
      id: other.transactionId,
      latestEvidence: other,
      currentAcceptedEvidence: other,
    });
    renderView();
    const options = await screen.findAllByRole('option', { name: /source-transaction-a/ });
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('synthetic-bank/transactions/synthetic-office');
    expect(options[1]).toHaveTextContent('synthetic-bank/other-connector/synthetic-office');
    expect(screen.queryByText('$300.00')).not.toBeInTheDocument();
  });

  it.each([
    'CASH_NOT_ACCEPTED',
    'CASH_NOT_CURRENT',
    'CASH_NOT_POSTED',
    'CASH_ZERO_AMOUNT',
    'BATCH_NOT_ACCEPTED',
    'BATCH_NOT_CURRENT',
    'BATCH_ZERO_NET',
    'DIRECTION_MISMATCH',
    'CASH_CAPACITY_EXCEEDED',
    'BATCH_CAPACITY_EXCEEDED',
    'STALE_CASH_RESERVATION',
    'STALE_BATCH_RESERVATION',
    'SOURCE_LINK_LIMIT',
    'CASH_IDENTITY_CONFLICT',
  ] as const)('blocks a new match for%s', async (blocker) => {
    preview.blockers = [blocker];
    const { user } = renderView();
    await openPreview(user);
    expect(screen.getByRole('list', { name: 'Match blockers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record reviewed match' })).toBeDisabled();
    expect(matchRequests()).toHaveLength(0);
  });

  it.each(['UNREVIEWED', 'REJECTED'] as const)(
    'keeps an older accepted batch unavailable when the latest observation is %s',
    async (decision) => {
      const older = batches.items[0]!;
      const newer =
        decision === 'REJECTED'
          ? batchReviewedFixture(batchV2Fixture(), 'REJECT')
          : batchV2Fixture();
      older.revision = {
        ...older.revision,
        isLatest: false,
        isCurrentAccepted: false,
        latestEvidenceId: newer.id,
        latestSourceSequence: 1,
      };
      newer.revision.latestAcceptedEvidenceId = older.id;
      batches.items = [newer, older];
      renderView();
      const options = await screen.findAllByRole('option', { name: /synthetic-batch-a/ });
      expect(options).toHaveLength(2);
      expect(options[0]).toHaveTextContent('Source sequence 1 (v2)');
      expect(options[1]).toHaveTextContent('Stale accepted revision');
      expect(options[0]).toBeDisabled();
      expect(options[1]).toBeDisabled();
      expect(matchRequests()).toHaveLength(0);
    },
  );

  it('keeps the old150 reservation until explicit release before matching the corrected140 net', async () => {
    const olderMatch = cashMatchFixture();
    const corrected = batchReviewedFixture(batchV2Fixture());
    batches.items = [corrected];
    olderMatch.status = 'STALE';
    olderMatch.blockers = ['BATCH_NOT_CURRENT'];
    olderMatch.batch = {
      ...olderMatch.batch,
      latestEvidenceId: corrected.id,
      latestSourceSequence: 1,
      latestAcceptedEvidenceId: corrected.id,
    };
    matches = matchListFixture([olderMatch]);
    preview.batch = {
      ...preview.batch,
      evidenceId: corrected.id,
      contentHash: corrected.contentHash,
      schemaVersion: 2,
      sourceSequence: 1,
      sourceRecordId: corrected.payload.sourceRecordId,
      latestEvidenceId: corrected.id,
      latestSourceSequence: 1,
      latestAcceptedEvidenceId: corrected.id,
      providerAdjustmentAmount: '-40.00',
      netAmount: '140.00',
    };
    preview.capacity = {
      cashReservedMagnitude: '150.00',
      cashAvailableMagnitude: '0.00',
      batchReservedMagnitude: '150.00',
      batchAvailableMagnitude: null,
    };
    preview.blockers = ['STALE_BATCH_RESERVATION'];
    postHandler = async (r) => {
      if (r.path.endsWith('/release/preview'))
        return json({ ...releasePreview, reason: (r.body as ReleaseCandidate).reason });
      if (r.path.endsWith('/release')) {
        const release = releaseReceiptFixture('SOURCE_CHANGED');
        matches = matchListFixture([{ ...olderMatch, status: 'RELEASED', release }]);
        preview.blockers = [];
        preview.capacity = {
          cashReservedMagnitude: '0.00',
          cashAvailableMagnitude: '150.00',
          batchReservedMagnitude: '0.00',
          batchAvailableMagnitude: '140.00',
        };
        return json(release, 201);
      }
      if (r.path.endsWith('/preview')) return json({ ...preview, candidate: r.body });
      return json(matchReceiptFixture(r.body as MatchCandidate), 201);
    };
    const { user } = renderView();
    await openPreview(user, '140.00');
    expect(screen.getByText('Batch already reserved').nextElementSibling).toHaveTextContent(
      '$150.00',
    );
    expect(
      screen.getByText('Batch available before this match').nextElementSibling,
    ).toHaveTextContent('Unknown');
    expect(screen.getByRole('button', { name: 'Record reviewed match' })).toBeDisabled();
    expect(
      screen.getByText(/Revising a batch does not free its reserved amount/),
    ).toBeInTheDocument();
    await openRelease(user);
    expect(screen.getByText('Signed match being released').nextElementSibling).toHaveTextContent(
      '+$150.00',
    );
    expect(screen.getByText('Matched batch revision').nextElementSibling).toHaveTextContent(
      'Unsequenced baseline',
    );
    await user.click(screen.getByRole('button', { name: 'Release full match' }));
    await screen.findByText(/Full match released/);
    expect(matchRequests()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Open fresh match preview' }));
    await screen.findByRole('heading', { name: 'Review proposed source match' });
    expect(
      screen.getByText('Batch available before this match').nextElementSibling,
    ).toHaveTextContent('$140.00');
    await user.click(screen.getByRole('button', { name: 'Record reviewed match' }));
    await screen.findByText(/Match recorded/);
    expect(matchRequests()[0]?.body).toMatchObject({
      batchEvidenceId: corrected.id,
      amount: '140.00',
    });
    expect(releaseRequests()[0]?.path).toContain(olderMatch.id);
  });

  it('preserves unknown capacity separately from known zero reserved magnitude', async () => {
    preview.capacity.cashAvailableMagnitude = null;
    preview.capacity.batchAvailableMagnitude = null;
    preview.blockers = ['CASH_NOT_CURRENT'];
    const { user } = renderView();
    await openPreview(user);
    expect(
      screen.getByText('Cash available before this match').nextElementSibling,
    ).toHaveTextContent('Unknown');
    expect(
      screen.getByText('Batch available before this match').nextElementSibling,
    ).toHaveTextContent('Unknown');
    expect(screen.getByText('Cash already reserved').nextElementSibling).toHaveTextContent('$0.00');
  });

  it.each(['0.00', '-0.00', '1', '1.001', '1e2', '+1.00', '100000000.00'])(
    'rejects noncanonical or zero match amount%s before preview HTTP',
    async (value) => {
      const { user } = renderView();
      await chooseSources(user, value);
      await user.click(screen.getByRole('button', { name: 'Open fresh match preview' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'nonzero signed USD amount with two decimal places',
      );
      expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    },
  );

  it('accepts a signednegative cent match and keeps reservation magnitudes positive', async () => {
    preview.cash.amount = '-0.01';
    preview.cash.sourceAmount = '0.01';
    preview.batch.netAmount = '-0.01';
    preview.capacity = {
      cashReservedMagnitude: '0.00',
      cashAvailableMagnitude: '0.01',
      batchReservedMagnitude: '0.00',
      batchAvailableMagnitude: '0.01',
    };
    const { user } = renderView();
    await openPreview(user, '-0.01');
    expect(screen.getByText('Proposed signed match: −$0.01')).toBeInTheDocument();
    expect(
      screen.getByText('Cash available before this match').nextElementSibling,
    ).toHaveTextContent('$0.01');
    await user.click(screen.getByRole('button', { name: 'Record reviewed match' }));
    await screen.findByText(/Match recorded/);
    expect(matchRequests()[0]?.body).toMatchObject({ amount: '-0.01' });
  });

  it('invalidates preview when the candidate amount changes', async () => {
    const { user } = renderView();
    await openPreview(user);
    await user.clear(screen.getByLabelText('Signed match amount (USD)'));
    expect(screen.queryByRole('button', { name: 'Record reviewed match' })).not.toBeInTheDocument();
  });

  it('guards double submits and retries the identical uncertain match while dynamic list can be stale', async () => {
    const gate = deferred<Response>();
    postHandler = async (r) =>
      r.path.endsWith('/preview') ? json({ ...preview, candidate: r.body }) : gate.promise;
    const { user } = renderView();
    await openPreview(user);
    const record = screen.getByRole('button', { name: 'Record reviewed match' });
    fireEvent.click(record);
    fireEvent.click(record);
    await waitFor(() => {
      expect(matchRequests()).toHaveLength(1);
    });
    await act(async () => {
      gate.resolve(json({ message: 'private server data' }, 500));
    });
    const retry = await screen.findByRole('button', { name: 'Retry same match' });
    expect(screen.getByLabelText('Reviewed cash source')).toBeDisabled();
    expect(screen.getByLabelText('Signed match amount (USD)')).toBeDisabled();
    matches = matchListFixture([
      cashMatchFixture({ status: 'STALE', blockers: ['CASH_NOT_CURRENT'] }),
    ]);
    postHandler = async () => json(matchReceiptFixture(), 200);
    await user.click(retry);
    await screen.findByText(/Match recorded/);
    expect(await screen.findByText('Stale source · reservation retained')).toBeInTheDocument();
    expect(matchRequests()[1]?.body).toEqual(matchRequests()[0]?.body);
    expect(screen.queryByText(/private server data/)).not.toBeInTheDocument();
  });

  it('clears conflict preview and creates a new key only after fresh explicit review', async () => {
    postHandler = async (r) =>
      r.path.endsWith('/preview')
        ? json({ ...preview, candidate: r.body })
        : json({ code: 'CONFLICT' }, 409);
    const { user } = renderView();
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'Record reviewed match' }));
    await screen.findByText(/sources or reservations changed/);
    expect(screen.queryByRole('button', { name: 'Record reviewed match' })).not.toBeInTheDocument();
    preview.reviewToken = 'c'.repeat(64);
    postHandler = async (r) =>
      r.path.endsWith('/preview')
        ? json({ ...preview, candidate: r.body })
        : json(matchReceiptFixture());
    await user.click(screen.getByRole('button', { name: 'Open fresh match preview' }));
    await user.click(await screen.findByRole('button', { name: 'Record reviewed match' }));
    await screen.findByText(/Match recorded/);
    expect(matchRequests()[1]?.body).toMatchObject({ reviewToken: 'c'.repeat(64) });
    expect((matchRequests()[1]?.body as { idempotencyKey: string }).idempotencyKey).not.toBe(
      (matchRequests()[0]?.body as { idempotencyKey: string }).idempotencyKey,
    );
  });

  it('releases a full stale match despite source graph blockers, keeping reason explicit', async () => {
    matches = matchListFixture([
      cashMatchFixture({
        status: 'STALE',
        blockers: ['STALE_CASH_RESERVATION', 'SOURCE_LINK_LIMIT'],
      }),
    ]);
    const { user } = renderView();
    await openRelease(user);
    expect(screen.getByText('Reviewed release reason').nextElementSibling).toHaveTextContent(
      'Source evidence changed',
    );
    expect(screen.getByText('Signed match being released').nextElementSibling).toHaveTextContent(
      '+$150.00',
    );
    await user.click(screen.getByRole('button', { name: 'Release full match' }));
    await screen.findByText(/Full match released/);
    expect(await screen.findByText('Released · reservation removed')).toBeInTheDocument();
    expect(releaseRequests()[0]?.body).toMatchObject({
      reason: 'SOURCE_CHANGED',
      reviewToken: 'b'.repeat(64),
    });
    expect(screen.queryByRole('button', { name: /Review release for/ })).not.toBeInTheDocument();
  });

  it('does not release an alreadyreleased match returned by fresh preview', async () => {
    matches = matchListFixture([cashMatchFixture()]);
    releasePreview.canRelease = false;
    releasePreview.release = releaseReceiptFixture();
    const { user } = renderView();
    await openRelease(user);
    expect(screen.getByRole('button', { name: 'Release full match' })).toBeDisabled();
    expect(screen.getByText(/already been released/)).toBeInTheDocument();
  });

  it('locks all choices and retries identical release body after a network failure', async () => {
    matches = matchListFixture([cashMatchFixture()]);
    postHandler = async (r) => {
      if (r.path.endsWith('/release/preview'))
        return json({ ...releasePreview, reason: (r.body as ReleaseCandidate).reason });
      throw new Error('private release detail');
    };
    const { user } = renderView();
    await openRelease(user);
    await user.click(screen.getByRole('button', { name: 'Release full match' }));
    const retry = await screen.findByRole('button', { name: 'Retry same release' });
    expect(screen.getByLabelText('Release reason')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open fresh match preview' })).toBeDisabled();
    postHandler = async () => json(releaseReceiptFixture('SOURCE_CHANGED'), 200);
    await user.click(retry);
    await screen.findByText(/Full match released/);
    expect(releaseRequests()[1]?.body).toEqual(releaseRequests()[0]?.body);
    expect(screen.queryByText(/private release detail/)).not.toBeInTheDocument();
  });

  it('requires fresh release preview after409 and clears preview on reasonchange', async () => {
    matches = matchListFixture([cashMatchFixture()]);
    postHandler = async (r) =>
      r.path.endsWith('/release/preview')
        ? json({ ...releasePreview, reason: (r.body as ReleaseCandidate).reason })
        : json({}, 409);
    const { user } = renderView();
    await openRelease(user);
    await user.click(screen.getByRole('button', { name: 'Release full match' }));
    await screen.findByText(/match or reservations changed/);
    expect(screen.queryByRole('region', { name: 'Full release preview' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open fresh release preview' }));
    await screen.findByRole('region', { name: 'Full release preview' });
    await user.selectOptions(screen.getByLabelText('Release reason'), 'WRONG_MATCH');
    expect(screen.queryByRole('button', { name: 'Release full match' })).not.toBeInTheDocument();
  });

  it('paginates all three independently and preserves loaded sources on later pagefailure', async () => {
    cash.hasMore = true;
    cash.nextCursor = 'cash-next';
    batches.hasMore = true;
    batches.nextCursor = 'batch-next';
    matches.hasMore = true;
    matches.nextCursor = 'match-next';
    getHandler = async (r) =>
      r.query.includes('cash-next')
        ? json({}, 503)
        : r.query.includes('batch-next')
          ? json({ ...batches, items: [], hasMore: false, nextCursor: null })
          : r.query.includes('match-next')
            ? json({ ...matches, items: [], hasMore: false, nextCursor: null })
            : json(
                r.path === '/v1/cash-evidence'
                  ? cash
                  : r.path === '/v1/remittance-batches'
                    ? batches
                    : matches,
              );
    const { user } = renderView();
    await user.click(await screen.findByRole('button', { name: 'Load more cash sources' }));
    await screen.findByText(/Cash sources could not be loaded/);
    expect(screen.getByRole('option', { name: /source-transaction-a/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more batch sources' }));
    await user.click(screen.getByRole('button', { name: 'Load more matches' }));
    await waitFor(() => {
      expect(requests.some((r) => r.query === '?limit=10&cursor=match-next')).toBe(true);
    });
    expect(requests.some((r) => r.query === '?limit=20&cursor=cash-next')).toBe(true);
    expect(requests.some((r) => r.query === '?limit=10&cursor=batch-next')).toBe(true);
  });

  it.each(['user', 'organization'])(
    'blocks pendingauth match on%schange and clears prior source data',
    async (change) => {
      auth.orgId = change === 'user' ? null : 'org_a';
      const { user, rerender } = renderView();
      await openPreview(user);
      const gate = deferred<Record<string, string>>();
      headersMock.mockReturnValueOnce(gate.promise);
      await user.click(screen.getByRole('button', { name: 'Record reviewed match' }));
      if (change === 'user') auth.userId = 'user_b';
      else auth.orgId = 'org_b';
      cash = { ...cash, items: [] };
      batches = { ...batches, items: [] };
      rerender();
      expect(screen.queryByRole('article')).not.toBeInTheDocument();
      await act(async () => {
        gate.resolve({ authorization: 'Bearer changed' });
      });
      await screen.findByText('No cash sources have been imported.');
      expect(matchRequests()).toHaveLength(0);
    },
  );

  it('ignores late release success after personal user changes', async () => {
    auth.orgId = null;
    matches = matchListFixture([cashMatchFixture()]);
    const gate = deferred<Response>();
    postHandler = async (r) =>
      r.path.endsWith('/release/preview')
        ? json({ ...releasePreview, reason: (r.body as ReleaseCandidate).reason })
        : gate.promise;
    const { user, rerender } = renderView();
    await openRelease(user);
    await user.click(screen.getByRole('button', { name: 'Release full match' }));
    await waitFor(() => {
      expect(releaseRequests()).toHaveLength(1);
    });
    auth.userId = 'user_b';
    matches = matchListFixture();
    rerender();
    await act(async () => {
      gate.resolve(json(releaseReceiptFixture()));
    });
    await screen.findByText('No cash source matches have been recorded.');
    expect(screen.queryByText(/Full match released/)).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});

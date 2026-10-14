import { transferableAbortController } from 'node:util';

import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PostingEvidence,
  PostingHistory,
  PostingList,
  PostingPreview,
} from '../../../lib/posting-evidence/use-posting-evidence.js';

import { PostingEvidencePage } from './posting-evidence-page.js';
import {
  postingEvidenceFixture,
  postingHistoryFixture,
  postingListFixture,
  postingPreviewFixture,
  postingReceiptFixture,
  postingReviewedFixture,
} from './posting-evidence.fixtures.js';

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
let evidence: PostingEvidence;
let list: PostingList;
let history: PostingHistory;
let preview: PostingPreview;
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
  evidence = postingEvidenceFixture();
  list = postingListFixture([postingReceiptFixture(evidence)]);
  history = postingHistoryFixture(list.items[0]);
  preview = postingPreviewFixture(evidence);
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
        evidence = postingReviewedFixture(evidence, decision);
        const receipt = postingReceiptFixture(
          evidence,
          decision === 'ACCEPT' ? { currentAcceptedEvidence: evidence, freshness: 'CURRENT' } : {},
        );
        list = postingListFixture([receipt]);
        history = postingHistoryFixture(receipt, [evidence]);
        return json(evidence);
      }
      list = postingListFixture([postingReceiptFixture(evidence)]);
      return json(evidence, 201);
    }
    if (getHandler) return getHandler(record);
    return json(
      record.path.endsWith('/preview')
        ? preview
        : record.path.includes('/receipts/')
          ? history
          : list,
    );
  });
});
function renderView(): { user: ReturnType<typeof userEvent.setup>; rerender: () => void } {
  const client = createDentaBillQueryClient();
  const view = () => (
    <QueryProvider client={client}>
      <PostingEvidencePage />
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
function file(body = JSON.stringify(postingEvidenceFixture().payload)): File {
  const f = new File([body], 'synthetic.json', { type: 'application/json' });
  Object.defineProperty(f, 'text', { value: async () => body });
  return f;
}
async function openPreview(
  user: ReturnType<typeof userEvent.setup>,
  sequence = evidence.payload.sourceSequence,
): Promise<void> {
  await user.click(
    await screen.findByRole('button', { name: 'View receipt fake-receipt-a in synthetic-office' }),
  );
  await user.click(
    await screen.findByRole('button', { name: `Preview source sequence ${String(sequence)}` }),
  );
  await screen.findByRole('region', { name: 'Source review preview' });
}
const reviewRequests = (): RequestRecord[] =>
  requests.filter((r) => r.method === 'POST' && r.path.endsWith('/review'));

describe('posting receipt observations through actual hook and generated SDK transport', () => {
  it('imports and reviews independent header and entry facts, preserving raw dates, versions, flags and references', async () => {
    list = postingListFixture();
    const { user } = renderView();
    expect(screen.getByRole('link', { name: 'Download synthetic example JSON' })).toHaveAttribute(
      'href',
      '/examples/synthetic-posting-evidence.json',
    );
    await user.upload(screen.getByLabelText('PMS payment receipt JSON'), file());
    await user.click(await screen.findByRole('button', { name: 'Import source revision' }));
    await screen.findByText(/Source revision saved/);
    await user.click(screen.getByRole('button', { name: 'Open fresh source preview' }));
    const article = screen.getByRole('article');
    for (const [label, value] of [
      ['Canonical signed header amount (USD)', '+$150.00'],
      ['Original source header amount (USD)', '−$150.00'],
      ['Known listed entry subtotal (USD)', '+$150.00'],
      ['Entries with unknown amounts', '0'],
      ['Complete entry amount (USD)', '+$150.00'],
      ['Header minus complete entries (USD)', '+$0.00'],
    ])
      expect(within(article).getByText(label!).nextElementSibling).toHaveTextContent(value!);
    await user.click(screen.getByText('Inspect source identity, dates and raw status'));
    expect(screen.getByText('Source entry date').nextElementSibling).toHaveTextContent(
      '2026-10-12',
    );
    expect(screen.getByText('Source issued date').nextElementSibling).toHaveTextContent(
      '2026-10-13',
    );
    expect(screen.getByText('Raw source partial flag').nextElementSibling).toHaveTextContent(
      'False',
    );
    const entries = screen.getByRole('region', { name: 'Receipt source entries' });
    for (const value of [
      'PAYMENT',
      'TRANSFER',
      'ADJUSTMENT',
      'fake-source-claim-a',
      'fake-source-line-a',
      'fake-source-procedure-a',
      'entry-v3',
    ])
      expect(within(entries).getByText(value)).toBeInTheDocument();
    const transfer = within(entries).getAllByRole('listitem')[1]!;
    expect(
      within(transfer).getByText('Raw source transfer flag').nextElementSibling,
    ).toHaveTextContent('True');
    expect(within(entries).queryByRole('link')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept source revision' }));
    await screen.findByText(/Source observation accepted/);
    expect(
      screen.getByText(/no local claim payment or cash allocation was created/),
    ).toBeInTheDocument();
    expect(await screen.findAllByText('Current accepted observation')).not.toHaveLength(0);
  });

  it('accepts complete header/detail mismatch as source observations without balancing it away', async () => {
    evidence.payload.amount = '170.00';
    evidence.payload.sourceAmount = '-170.00';
    evidence.totals.headerDifference = '20.00';
    const { user } = renderView();
    await openPreview(user);
    expect(
      screen.getByText('Header minus complete entries (USD)').nextElementSibling,
    ).toHaveTextContent('+$20.00');
    expect(screen.getByText(/header differs from its complete entry detail/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept source revision' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Accept source revision' }));
    await screen.findByText(/Source observation accepted/);
  });

  it('keeps partial receipt header, known subtotal and unknown child values distinct and reviewable', async () => {
    evidence.payload.status = 'PARTIAL';
    evidence.payload.sourceIsPartial = true;
    evidence.payload.detailCompleteness = 'PARTIAL';
    evidence.payload.entries[1] = {
      ...evidence.payload.entries[1]!,
      amount: null,
      sourceAmount: null,
    };
    evidence.totals = {
      knownListedEntryAmount: '70.00',
      unknownEntryCount: 1,
      completeEntryAmount: null,
      headerDifference: null,
    };
    const { user } = renderView();
    await openPreview(user);
    expect(
      screen.getByText('Canonical signed header amount (USD)').nextElementSibling,
    ).toHaveTextContent('+$150.00');
    expect(
      screen.getByText('Known listed entry subtotal (USD)').nextElementSibling,
    ).toHaveTextContent('+$70.00');
    expect(screen.getByText('Entries with unknown amounts').nextElementSibling).toHaveTextContent(
      '1',
    );
    expect(screen.getByText('Complete entry amount (USD)').nextElementSibling).toHaveTextContent(
      'Not established',
    );
    expect(
      screen.getByText('Header minus complete entries (USD)').nextElementSibling,
    ).toHaveTextContent('Not comparable');
    const transfer = within(
      screen.getByRole('region', { name: 'Receipt source entries' }),
    ).getAllByRole('listitem')[1]!;
    expect(
      within(transfer).getByText('Canonical signed entry amount (USD)').nextElementSibling,
    ).toHaveTextContent('Unknown');
    expect(screen.getByRole('button', { name: 'Accept source revision' })).toBeEnabled();
    expect(
      screen.getByText(/partial or absent accepted revision retains entry IDs/),
    ).toBeInTheDocument();
  });

  it('keeps absent or unknown headers unknown rather than equating them to empty-entry zero', async () => {
    evidence.payload = {
      ...evidence.payload,
      status: 'UNKNOWN',
      amount: null,
      sourceAmount: null,
      detailCompleteness: 'ABSENT',
      entries: [],
    };
    evidence.totals = {
      knownListedEntryAmount: '0.00',
      unknownEntryCount: 0,
      completeEntryAmount: null,
      headerDifference: null,
    };
    const { user } = renderView();
    await openPreview(user);
    expect(
      screen.getByText('Canonical signed header amount (USD)').nextElementSibling,
    ).toHaveTextContent('Unknown');
    expect(
      screen.getByText('Known listed entry subtotal (USD)').nextElementSibling,
    ).toHaveTextContent('+$0.00');
    expect(screen.getByText('Complete entry amount (USD)').nextElementSibling).toHaveTextContent(
      'Not established',
    );
    expect(
      screen.getByText(/empty list does not establish a zero receipt amount/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept source revision' })).toBeEnabled();
  });

  it('labels removal independently of refund or local payment reversal and retains unknown amounts', async () => {
    evidence.payload = {
      ...evidence.payload,
      status: 'REMOVED',
      amount: null,
      sourceAmount: null,
      detailCompleteness: 'ABSENT',
      entries: [],
    };
    evidence.totals = {
      knownListedEntryAmount: '0.00',
      unknownEntryCount: 0,
      completeEntryAmount: null,
      headerDifference: null,
    };
    const { user } = renderView();
    await openPreview(user);
    expect(
      screen.getByText(/does not establish a refund or reverse a local claim payment/),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Original source header amount (USD)').nextElementSibling,
    ).toHaveTextContent('Unknown');
  });

  it('shows stale accepted observation and rejects an older revision without restoring currentness', async () => {
    const old = {
      ...evidence,
      id: '44444444-4444-4444-8444-444444444444',
      payload: { ...evidence.payload, sourceSequence: 1, sourceRecordId: 'older-record' },
    };
    list.items[0] = postingReceiptFixture(evidence, {
      currentAcceptedEvidence: postingReviewedFixture(old),
      freshness: 'STALE',
    });
    history = postingHistoryFixture(list.items[0], [evidence, old]);
    preview = {
      ...postingPreviewFixture(old),
      blockers: ['NEWER_SOURCE_EVIDENCE'],
      latestSourceSequence: 2,
      currentAcceptedEvidence: postingReviewedFixture(old),
    };
    const { user } = renderView();
    expect(await screen.findByText('Stale accepted observation')).toBeInTheDocument();
    await openPreview(user, 1);
    expect(screen.getByRole('button', { name: 'Accept source revision' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Reject source revision' }));
    await screen.findByText(/does not make an earlier stale observation current/);
    expect(reviewRequests()[0]?.body).toMatchObject({ decision: 'REJECT' });
  });

  it('blocks duplicate entry acceptance while explaining retained reservations and preserving rejection', async () => {
    preview.blockers = ['SOURCE_ENTRY_OVERLAP'];
    const { user } = renderView();
    await openPreview(user);
    expect(screen.getByRole('list', { name: 'Source review blockers' })).toHaveTextContent(
      'do not invent new source IDs',
    );
    expect(screen.getByRole('button', { name: 'Accept source revision' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject source revision' })).toBeEnabled();
  });

  it('does not offer another review for an already-reviewed revision', async () => {
    preview.evidence = postingReviewedFixture(evidence);
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

  it('guards double clicks and retries identical review after an uncertain response', async () => {
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
      gate.resolve(json({}, 503));
    });
    const retry = await screen.findByRole('button', { name: 'Retry same review' });
    expect(screen.getByLabelText('PMS payment receipt JSON')).toBeDisabled();
    postHandler = async () => json(postingReviewedFixture(evidence));
    await user.click(retry);
    await screen.findByText(/Source observation accepted/);
    expect(reviewRequests()[1]?.body).toEqual(reviewRequests()[0]?.body);
  });

  it('clears409preview and only generates a new key after another explicit fresh decision', async () => {
    postHandler = async () => json({}, 409);
    const { user } = renderView();
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'Accept source revision' }));
    await screen.findByText(/Source evidence changed before/);
    expect(screen.queryByRole('region', { name: 'Source review preview' })).not.toBeInTheDocument();
    preview.reviewToken = 'c'.repeat(64);
    postHandler = async () => json(postingReviewedFixture(evidence));
    await user.click(screen.getByRole('button', { name: 'Open fresh source preview' }));
    await user.click(await screen.findByRole('button', { name: 'Accept source revision' }));
    await screen.findByText(/Source observation accepted/);
    expect(reviewRequests()[1]?.body).toMatchObject({ reviewToken: 'c'.repeat(64) });
    expect((reviewRequests()[1]?.body as { idempotencyKey: string }).idempotencyKey).not.toBe(
      (reviewRequests()[0]?.body as { idempotencyKey: string }).idempotencyKey,
    );
  });

  it('retries identical imports after network uncertainty and reports closed validation errors', async () => {
    postHandler = async () => {
      throw new Error('private source detail');
    };
    const { user } = renderView();
    await user.upload(
      screen.getByLabelText('PMS payment receipt JSON'),
      file(JSON.stringify({ ...evidence.payload, amount: 150 })),
    );
    await user.click(await screen.findByRole('button', { name: 'Import source revision' }));
    await screen.findByText(/import could not be confirmed/);
    expect(screen.getByLabelText('PMS payment receipt JSON')).toBeDisabled();
    postHandler = async () => json({ message: 'private source detail' }, 400);
    await user.click(screen.getByRole('button', { name: 'Retry same import' }));
    await screen.findByText(/did not meet the import contract/);
    const sent = requests.filter((r) => r.method === 'POST');
    expect(sent[1]?.body).toEqual(sent[0]?.body);
    expect(sent[0]?.body).toMatchObject({ amount: 150 });
    expect(screen.queryByText(/private source detail/)).not.toBeInTheDocument();
  });

  it.each([
    '',
    '{private malformed',
    '[]',
    '{"schemaVersion":1,"evidenceBasis":"BANK_ACCOUNT_TRANSACTION"}',
    'x'.repeat(256 * 1024 + 1),
  ])('rejects malformed, wrong-basis and oversized uploads before HTTP', async (body) => {
    const { user } = renderView();
    await user.upload(screen.getByLabelText('PMS payment receipt JSON'), file(body));
    expect(await screen.findByRole('alert')).toHaveTextContent(/JSON|256 KiB/);
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('paginates source receipts and complete revision history at10', async () => {
    list.hasMore = true;
    list.nextCursor = 'next-receipt';
    history.hasMore = true;
    history.nextCursor = 'older-revision';
    const old = {
      ...evidence,
      id: '44444444-4444-4444-8444-444444444444',
      payload: { ...evidence.payload, sourceSequence: 1 },
    };
    getHandler = async (r) =>
      json(
        r.path.includes('/receipts/')
          ? r.query.includes('older-revision')
            ? postingHistoryFixture(history.receipt, [old])
            : history
          : r.query.includes('next-receipt')
            ? postingListFixture()
            : list,
      );
    const { user } = renderView();
    await user.click(await screen.findByRole('button', { name: 'Load more receipts' }));
    await user.click(
      screen.getByRole('button', { name: 'View receipt fake-receipt-a in synthetic-office' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Load older revisions' }));
    await screen.findByRole('button', { name: 'Preview source sequence 1' });
    expect(
      requests.filter((r) => r.method === 'GET').every((r) => r.query.includes('limit=10')),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Load older revisions' })).not.toBeInTheDocument();
  });

  it('preserves loaded source history after later-page failure', async () => {
    history.hasMore = true;
    history.nextCursor = 'older-revision';
    getHandler = async (r) =>
      r.query.includes('older-revision')
        ? json({}, 503)
        : json(r.path.includes('/receipts/') ? history : list);
    const { user } = renderView();
    await user.click(
      await screen.findByRole('button', {
        name: 'View receipt fake-receipt-a in synthetic-office',
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Load older revisions' }));
    await screen.findByText('Source history could not be loaded.');
    expect(screen.getByRole('button', { name: 'Preview source sequence 2' })).toBeInTheDocument();
  });

  it.each(['user', 'organization'])(
    'blocks pending-auth review on%schange and removes old observations',
    async (change) => {
      auth.orgId = change === 'user' ? null : 'org_a';
      const { user, rerender } = renderView();
      await openPreview(user);
      const gate = deferred<Record<string, string>>();
      headersMock.mockReturnValueOnce(gate.promise);
      await user.click(screen.getByRole('button', { name: 'Accept source revision' }));
      if (change === 'user') auth.userId = 'user_b';
      else auth.orgId = 'org_b';
      list = postingListFixture();
      rerender();
      expect(screen.queryByRole('article')).not.toBeInTheDocument();
      await act(async () => {
        gate.resolve({ authorization: 'Bearer changed' });
      });
      await screen.findByText(/No PMS posting evidence has been imported/);
      expect(reviewRequests()).toHaveLength(0);
    },
  );

  it('ignores late review success after a personal-user change', async () => {
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
    list = postingListFixture();
    rerender();
    await act(async () => {
      gate.resolve(json(postingReviewedFixture(evidence)));
    });
    await screen.findByText(/No PMS posting evidence has been imported/);
    expect(screen.queryByText(/Source observation accepted/)).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});

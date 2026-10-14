import { transferableAbortController } from 'node:util';

import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import correctionExample from '../../../../public/examples/synthetic-remittance-batch-v2.json';
import baselineExample from '../../../../public/examples/synthetic-remittance-batch.json';
import type {
  BatchEvidence,
  BatchList,
  BatchHistory,
  BatchPreview,
} from '../../../lib/remittance-batches/use-remittance-batches.js';

import { RemittanceBatchesPage } from './remittance-batches-page.js';
import {
  batchEvidenceFixture,
  batchV2Fixture,
  batchHistoryFixture,
  batchListFixture,
  batchPreviewFixture,
  batchReviewedFixture,
} from './remittance-batches.fixtures.js';

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
let evidence: BatchEvidence;
let list: BatchList;
let history: BatchHistory;
let preview: BatchPreview;
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
  evidence = batchEvidenceFixture();
  list = batchListFixture([evidence]);
  history = batchHistoryFixture([evidence]);
  preview = batchPreviewFixture(evidence);
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
      if (record.path.endsWith('/review')) {
        evidence = batchReviewedFixture(
          evidence,
          (record.body as { decision: 'ACCEPT' | 'REJECT' }).decision,
        );
        list = batchListFixture([evidence]);
        return json(evidence);
      }
      list = batchListFixture([evidence]);
      return json(evidence, 201);
    }
    if (getHandler) return getHandler(record);
    return json(
      record.path.endsWith('/preview')
        ? preview
        : record.path.endsWith('/history')
          ? history
          : list,
    );
  });
});
function renderView(): { user: ReturnType<typeof userEvent.setup>; rerender: () => void } {
  const client = createDentaBillQueryClient();
  const view = () => (
    <QueryProvider client={client}>
      <RemittanceBatchesPage />
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
function file(body = JSON.stringify(batchEvidenceFixture().payload)): File {
  const f = new File([body], 'synthetic.json', { type: 'application/json' });
  Object.defineProperty(f, 'text', { value: async () => body });
  return f;
}
async function openPreview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(
    await screen.findByRole('button', {
      name: 'Preview batch synthetic-batch-a · Unsequenced baseline (v1)',
    }),
  );
  await screen.findByRole('region', { name: 'Batch review preview' });
}
const reviewRequests = (): RequestRecord[] =>
  requests.filter((r) => r.method === 'POST' && r.path.endsWith('/review'));

describe('remittance batches through the actual hook and generated SDK transport', () => {
  it('keeps the downloadable correction in the original public baseline identity with unchanged members', () => {
    const baseline = baselineExample;
    const correction = correctionExample;
    expect(correction).toMatchObject({
      schemaVersion: 2,
      sourceSequence: 1,
      sourceNamespace: baseline.sourceNamespace,
      sourceBatchId: baseline.sourceBatchId,
      reportedClaimAmount: '180.00',
      reportedAdjustmentAmount: '-40.00',
      reportedNetAmount: '140.00',
    });
    expect(correction.sourceRecordId).not.toBe(baseline.sourceRecordId);
    expect(correction.claimRemittances).toEqual(baseline.claimRemittances);
    expect(correction.providerAdjustments[0]).toMatchObject({
      amount: '-40.00',
      sourceAmount: '40.00',
      sourceSignConvention: 'REDUCTION_POSITIVE',
    });
  });
  it('imports an explicit v2 correction under the original batch identity and preserves the changed net', async () => {
    evidence = batchV2Fixture();
    list = batchListFixture([]);
    history = batchHistoryFixture([evidence, batchEvidenceFixture()]);
    preview = batchPreviewFixture(evidence);
    const { user } = renderView();
    expect(
      screen.getByRole('link', { name: 'Download synthetic v2 correction JSON' }),
    ).toHaveAttribute('href', '/examples/synthetic-remittance-batch-v2.json');
    await user.upload(
      screen.getByLabelText('Payer remittance batch JSON'),
      file(JSON.stringify(evidence.payload)),
    );
    await user.click(await screen.findByRole('button', { name: 'Import batch source' }));
    await screen.findByText(/Batch source saved/);
    await user.click(screen.getByRole('button', { name: 'Open fresh batch preview' }));
    expect(await screen.findByRole('region', { name: 'Batch review preview' })).toBeInTheDocument();
    expect(screen.getByText('Reported batch net').nextElementSibling).toHaveTextContent('+$140.00');
    expect(screen.getByText('Listed provider adjustments').nextElementSibling).toHaveTextContent(
      '−$40.00',
    );
    const imported = requests.find((r) => r.method === 'POST');
    expect(imported?.body).toMatchObject({
      schemaVersion: 2,
      sourceSequence: 1,
      sourceBatchId: 'synthetic-batch-a',
      sourceRecordId: 'synthetic-batch-record-sequence-1',
    });
    await user.click(screen.getByRole('button', { name: 'Accept batch evidence' }));
    expect(await screen.findByText(/Batch evidence accepted/)).toBeInTheDocument();
    expect(reviewRequests()[0]?.path).toContain(evidence.id);
  });

  it('preserves a v2 correction body during an uncertain import and exact replay', async () => {
    evidence = batchV2Fixture();
    let tries = 0;
    postHandler = async () => (++tries === 1 ? json({}, 503) : json(evidence, 200));
    const { user } = renderView();
    await user.upload(
      screen.getByLabelText('Payer remittance batch JSON'),
      file(JSON.stringify(evidence.payload)),
    );
    await user.click(await screen.findByRole('button', { name: 'Import batch source' }));
    await user.click(await screen.findByRole('button', { name: 'Retry same import' }));
    await screen.findByText(/Batch source saved/);
    const imports = requests.filter((r) => r.method === 'POST');
    expect(imports[1]?.body).toEqual(imports[0]?.body);
    expect(imports[1]?.body).toMatchObject({
      schemaVersion: 2,
      sourceSequence: 1,
      reportedNetAmount: '140.00',
    });
  });

  it('reads paged source-sequence history and keeps a prior accepted baseline stale after a newer rejection', async () => {
    const latest = batchReviewedFixture(batchV2Fixture(2), 'REJECT');
    const prior = batchReviewedFixture(batchEvidenceFixture());
    prior.revision = {
      ...prior.revision,
      latestEvidenceId: latest.id,
      latestSourceSequence: 2,
      isLatest: false,
      isCurrentAccepted: false,
    };
    latest.revision.latestAcceptedEvidenceId = prior.id;
    list = batchListFixture([latest, prior]);
    history = { ...batchHistoryFixture([latest]), hasMore: true, nextCursor: 'history_next' };
    getHandler = async (r) =>
      json(
        r.path.endsWith('/history')
          ? r.query.includes('history_next')
            ? batchHistoryFixture([prior])
            : history
          : list,
      );
    const { user } = renderView();
    await user.click(
      await screen.findByRole('button', {
        name: 'View history for batch synthetic-batch-a · Source sequence 2 (v2)',
      }),
    );
    const revisions = await screen.findByRole('list', { name: 'Batch revisions' });
    await within(revisions).findByText('Source sequence 2 (v2)');
    await user.click(screen.getByRole('button', { name: 'Load more revisions' }));
    await within(revisions).findByText('Unsequenced baseline (v1)');
    expect(
      within(revisions)
        .getAllByRole('listitem')
        .map((node) => node.textContent),
    ).toEqual([
      expect.stringContaining('Latest observed · Rejected'),
      expect.stringContaining('Stale accepted revision'),
    ]);
    expect(
      requests.filter((r) => r.path.endsWith('/history')).map((r) => [r.path, r.query]),
    ).toEqual([
      [`/v1/remittance-batches/${latest.id}/history`, '?limit=10'],
      [`/v1/remittance-batches/${latest.id}/history`, '?limit=10&cursor=history_next'],
    ]);
  });

  it('preserves loaded history when a later history page fails', async () => {
    history = { ...batchHistoryFixture([evidence]), hasMore: true, nextCursor: 'history_failure' };
    getHandler = async (r) =>
      r.query.includes('history_failure')
        ? json({ message: 'private source details' }, 500)
        : json(r.path.endsWith('/history') ? history : list);
    const { user } = renderView();
    await user.click(await screen.findByRole('button', { name: /View history for batch/ }));
    await user.click(await screen.findByRole('button', { name: 'Load more revisions' }));
    await screen.findByText(
      'Batch revision history could not be loaded. Loaded observations are preserved.',
    );
    expect(
      within(screen.getByRole('list', { name: 'Batch revisions' })).getByText(
        'Unsequenced baseline (v1)',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/private source details/)).not.toBeInTheDocument();
  });

  it('blocks acceptance of an older observation but allows its explicit rejection', async () => {
    evidence.revision = {
      ...evidence.revision,
      isLatest: false,
      latestEvidenceId: batchV2Fixture().id,
      latestSourceSequence: 1,
    };
    preview = { ...batchPreviewFixture(evidence), blockers: ['BATCH_NOT_CURRENT'] };
    const { user } = renderView();
    await openPreview(user);
    expect(screen.getByRole('button', { name: 'Accept batch evidence' })).toBeDisabled();
    expect(
      screen.getByText(/Only the latest observed revision can be accepted/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reject batch evidence' }));
    await screen.findByText(/Batch evidence rejected/);
    expect(reviewRequests()[0]?.body).toMatchObject({ decision: 'REJECT' });
  });

  it('separates retained and omitted members while preserving historical batch ownership', async () => {
    const prior = batchEvidenceFixture();
    evidence = batchV2Fixture();
    evidence.payload.claimRemittances = evidence.payload.claimRemittances.slice(0, 1);
    evidence.payload.reportedClaimAmount = '100.00';
    evidence.payload.reportedNetAmount = '60.00';
    list = batchListFixture([evidence]);
    preview = {
      ...batchPreviewFixture(evidence),
      listedClaimAmount: '100.00',
      calculatedNetAmount: '60.00',
    };
    preview.membershipChanges = {
      previousAcceptedEvidenceId: prior.id,
      ownershipPolicy: 'RETAINED_ACROSS_REVISIONS',
      added: [],
      retained: [
        {
          ...prior.payload.claimRemittances[0]!,
          evidenceId: '22222222-2222-4222-8222-222222222222',
          claimId: 'synthetic-claim-1',
        },
      ],
      omitted: [
        {
          ...prior.payload.claimRemittances[1]!,
          evidenceId: '33333333-3333-4333-8333-333333333333',
          claimId: 'synthetic-claim-2',
        },
      ],
    };
    const { user } = renderView();
    await user.click(
      await screen.findByRole('button', {
        name: 'Preview batch synthetic-batch-a · Source sequence 1 (v2)',
      }),
    );
    const changes = await screen.findByRole('region', { name: 'Claim membership changes' });
    expect(within(changes).getByText(/Omitted members remain owned/)).toBeInTheDocument();
    await user.click(within(changes).getByText('Omitted from prior accepted revision (1)'));
    expect(within(changes).getByText('Prior reported amount: +$80.00')).toBeInTheDocument();
    expect(
      within(changes).getByRole('link', { name: 'View linked claim synthetic-claim-2' }),
    ).toHaveAttribute('href', '/dashboard/claims/synthetic-claim-2');
    expect(screen.getByRole('button', { name: 'Accept batch evidence' })).toBeEnabled();
    expect(screen.getByText('Listed claim reports').nextElementSibling).toHaveTextContent(
      '+$100.00',
    );
  });

  it('leaves invalid v2 sequence bounds to authoritative validation without inventing a sequence', async () => {
    evidence = batchV2Fixture();
    postHandler = async () => json({ message: 'private sequence details' }, 400);
    const { user } = renderView();
    await user.upload(
      screen.getByLabelText('Payer remittance batch JSON'),
      file(JSON.stringify({ ...evidence.payload, sourceSequence: 0 })),
    );
    await user.click(await screen.findByRole('button', { name: 'Import batch source' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('integer 1–2147483647');
    expect(requests.find((r) => r.method === 'POST')?.body).toMatchObject({ sourceSequence: 0 });
  });

  it('imports and accepts 100 +80 −30 =150 with separate source/detail totals and preserved adjustment metadata', async () => {
    list = batchListFixture();
    const { user } = renderView();
    expect(screen.getByRole('link', { name: 'Download synthetic example JSON' })).toHaveAttribute(
      'download',
    );
    await user.upload(screen.getByLabelText('Payer remittance batch JSON'), file());
    await user.click(await screen.findByRole('button', { name: 'Import batch source' }));
    await screen.findByText(/Batch source saved/);
    await user.click(screen.getByRole('button', { name: 'Open fresh batch preview' }));
    const article = screen.getByRole('article');
    for (const [label, value] of [
      ['Reported claim amount', '+$180.00'],
      ['Listed claim reports', '+$180.00'],
      ['Original source amount (USD)', '+$30.00'],
      ['Canonical net effect (USD)', '−$30.00'],
      ['Calculated detail net', '+$150.00'],
    ])
      expect(within(article).getByText(label!).nextElementSibling).toHaveTextContent(value!);
    expect(within(article).getByText('REDUCTION_POSITIVE')).toBeInTheDocument();
    for (const raw of [
      'RAW-SYNTHETIC',
      'RAW-30',
      'fake-adjustment-reference',
      'fake-provider',
      '2026-09-30',
    ])
      expect(within(article).getByText(raw)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View claim synthetic-claim-1' })).toHaveAttribute(
      'href',
      '/dashboard/claims/synthetic-claim-1',
    );
    expect(screen.getByText(/Payment traces are not used/)).toBeInTheDocument();
    await user.click(screen.getByText('Inspect source identity and trace metadata'));
    expect(screen.getByText('fake-trace')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Accept batch evidence' }));
    await screen.findByText(/Batch evidence accepted/);
    expect(screen.getByText(/No cash was created or allocated/)).toBeInTheDocument();
    expect(reviewRequests()[0]?.body).toMatchObject({
      decision: 'ACCEPT',
      reviewToken: 'b'.repeat(64),
    });
    expect(requests[0]?.authorization).toBe('Bearer user_a:org_a');
  });

  it.each([
    'INCOMPLETE_DETAIL',
    'UNKNOWN_TOTALS',
    'TOTAL_MISMATCH',
    'MEMBER_MISSING',
    'MEMBER_NOT_ACCEPTED',
    'MEMBER_AMOUNT_MISMATCH',
    'MEMBER_ALREADY_BATCHED',
  ] as const)('blocks acceptance for %s while preserving rejection', async (blocker) => {
    preview.blockers = [blocker];
    const { user } = renderView();
    await openPreview(user);
    expect(screen.getByRole('list', { name: 'Batch review blockers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept batch evidence' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Reject batch evidence' }));
    await screen.findByText(/Batch evidence rejected/);
    expect(reviewRequests()[0]?.body).toMatchObject({ decision: 'REJECT' });
  });

  it('keeps absent source headers unknown despite zero listed detail, and missing members unlinked', async () => {
    evidence.payload = {
      ...evidence.payload,
      detailCompleteness: 'PARTIAL',
      reportedClaimAmount: null,
      reportedAdjustmentAmount: null,
      reportedNetAmount: null,
    };
    preview = {
      ...batchPreviewFixture(evidence),
      blockers: ['INCOMPLETE_DETAIL', 'UNKNOWN_TOTALS', 'MEMBER_MISSING'],
      listedClaimAmount: '0.00',
      listedAdjustmentAmount: '0.00',
      calculatedNetAmount: '0.00',
      members: [
        {
          ...batchPreviewFixture().members[0]!,
          claimId: null,
          evidenceId: null,
          reviewId: null,
          evidenceHash: null,
          status: 'MISSING',
        },
      ],
    };
    const { user } = renderView();
    await openPreview(user);
    for (const label of [
      'Reported claim amount',
      'Reported adjustment net effect',
      'Reported batch net',
    ])
      expect(screen.getByText(label).nextElementSibling).toHaveTextContent('Unknown');
    expect(screen.getByText('Calculated detail net').nextElementSibling).toHaveTextContent(
      '+$0.00',
    );
    expect(screen.getByText(/partial list is not a full batch total/)).toHaveTextContent('PARTIAL');
    expect(screen.queryByRole('link', { name: /View claim/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept batch evidence' })).toBeDisabled();
  });

  it('does not offer another review for reviewed evidence', async () => {
    preview.evidence = batchReviewedFixture(evidence);
    preview.blockers = ['ALREADY_REVIEWED'];
    const { user } = renderView();
    await openPreview(user);
    expect(screen.queryByRole('button', { name: 'Accept batch evidence' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject batch evidence' })).not.toBeInTheDocument();
  });

  it('guards double clicks and replays exactly the uncertain decision, token and key', async () => {
    const gate = deferred<Response>();
    postHandler = async () => gate.promise;
    const { user } = renderView();
    await openPreview(user);
    const accept = screen.getByRole('button', { name: 'Accept batch evidence' });
    fireEvent.click(accept);
    fireEvent.click(accept);
    await waitFor(() => {
      expect(reviewRequests()).toHaveLength(1);
    });
    await act(async () => {
      gate.resolve(json({ code: 'INTERNAL_ERROR' }, 500));
    });
    const retry = await screen.findByRole('button', { name: 'Retry same review' });
    expect(screen.getByLabelText('Payer remittance batch JSON')).toBeDisabled();
    expect(
      screen.getByRole('button', {
        name: 'Preview batch synthetic-batch-a · Unsequenced baseline (v1)',
      }),
    ).toBeDisabled();
    postHandler = async () => json(batchReviewedFixture(evidence));
    await user.click(retry);
    await screen.findByText(/Batch evidence accepted/);
    expect(reviewRequests()[1]?.body).toEqual(reviewRequests()[0]?.body);
  });

  it('requires a fresh preview and explicit new decision after conflict', async () => {
    postHandler = async () => json({ code: 'CONFLICT' }, 409);
    const { user } = renderView();
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'Accept batch evidence' }));
    await screen.findByText(/evidence changed before the review/);
    expect(screen.queryByRole('region', { name: 'Batch review preview' })).not.toBeInTheDocument();
    preview.reviewToken = 'c'.repeat(64);
    postHandler = async () => json(batchReviewedFixture(evidence));
    await user.click(screen.getByRole('button', { name: 'Open fresh batch preview' }));
    await user.click(await screen.findByRole('button', { name: 'Accept batch evidence' }));
    await screen.findByText(/Batch evidence accepted/);
    expect(reviewRequests()[1]?.body).toMatchObject({ reviewToken: 'c'.repeat(64) });
    expect((reviewRequests()[1]?.body as { idempotencyKey: string }).idempotencyKey).not.toBe(
      (reviewRequests()[0]?.body as { idempotencyKey: string }).idempotencyKey,
    );
  });

  it('retries the identical uncertain import and reports immutable identity conflict without exposing server detail', async () => {
    postHandler = async () => {
      throw new Error('private payer data');
    };
    const { user } = renderView();
    await user.upload(screen.getByLabelText('Payer remittance batch JSON'), file());
    await user.click(await screen.findByRole('button', { name: 'Import batch source' }));
    await screen.findByText(/import could not be confirmed/);
    expect(screen.getByLabelText('Payer remittance batch JSON')).toBeDisabled();
    postHandler = async () => json({ message: 'private payer data' }, 409);
    await user.click(screen.getByRole('button', { name: 'Retry same import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Keep the original sourceBatchId/);
    const sent = requests.filter((r) => r.method === 'POST');
    expect(sent[1]?.body).toEqual(sent[0]?.body);
    expect(screen.queryByText(/private payer data/)).not.toBeInTheDocument();
  });

  it.each([
    '',
    '{private malformed',
    '[]',
    '{"schemaVersion":1,"evidenceBasis":"BANK_ACCOUNT_TRANSACTION"}',
    'x'.repeat(256 * 1024 + 1),
  ])('rejects malformed, wrong-basis or oversized files before HTTP import', async (body) => {
    const { user } = renderView();
    await user.upload(screen.getByLabelText('Payer remittance batch JSON'), file(body));
    expect(await screen.findByRole('alert')).toHaveTextContent(/JSON|256 KiB/);
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('leaves numeric amounts to authoritative validation and displays a closed validation error', async () => {
    postHandler = async () => json({ message: 'private numeric source detail' }, 400);
    const { user } = renderView();
    await user.upload(
      screen.getByLabelText('Payer remittance batch JSON'),
      file(JSON.stringify({ ...evidence.payload, reportedNetAmount: 150 })),
    );
    await user.click(await screen.findByRole('button', { name: 'Import batch source' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('decimal-string amounts');
    expect(requests.find((r) => r.method === 'POST')?.body).toMatchObject({
      reportedNetAmount: 150,
    });
    expect(screen.queryByText(/private numeric/)).not.toBeInTheDocument();
  });

  it('loads subsequent inbox pages at10 with the returned cursor', async () => {
    list.hasMore = true;
    list.nextCursor = 'next-batch';
    const next = batchListFixture([
      {
        ...evidence,
        id: '55555555-5555-4555-8555-555555555555',
        payload: { ...evidence.payload, sourceBatchId: 'synthetic-batch-b' },
      },
    ]);
    getHandler = async (r) => json(r.query.includes('next-batch') ? next : list);
    const { user } = renderView();
    await user.click(await screen.findByRole('button', { name: 'Load more batches' }));
    await screen.findByRole('button', {
      name: 'Preview batch synthetic-batch-b · Unsequenced baseline (v1)',
    });
    expect(requests.filter((r) => r.method === 'GET').map((r) => r.query)).toEqual([
      '?limit=10',
      '?limit=10&cursor=next-batch',
    ]);
    expect(screen.queryByRole('button', { name: 'Load more batches' })).not.toBeInTheDocument();
  });

  it.each(['user', 'organization'])(
    'blocks a pending-auth review on %s change and clears prior evidence',
    async (change) => {
      auth.orgId = change === 'user' ? null : 'org_a';
      const { user, rerender } = renderView();
      await openPreview(user);
      const gate = deferred<Record<string, string>>();
      headersMock.mockReturnValueOnce(gate.promise);
      await user.click(screen.getByRole('button', { name: 'Accept batch evidence' }));
      if (change === 'user') auth.userId = 'user_b';
      else auth.orgId = 'org_b';
      list = batchListFixture();
      rerender();
      expect(screen.queryByRole('article')).not.toBeInTheDocument();
      await act(async () => {
        gate.resolve({ authorization: 'Bearer changed' });
      });
      await screen.findByText(/No remittance batch evidence/);
      expect(reviewRequests()).toHaveLength(0);
    },
  );

  it('ignores late review success after a personal-user switch', async () => {
    auth.orgId = null;
    const gate = deferred<Response>();
    postHandler = async () => gate.promise;
    const { user, rerender } = renderView();
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'Accept batch evidence' }));
    await waitFor(() => {
      expect(reviewRequests()).toHaveLength(1);
    });
    auth.userId = 'user_b';
    list = batchListFixture();
    rerender();
    await act(async () => {
      gate.resolve(json(batchReviewedFixture(evidence)));
    });
    await screen.findByText(/No remittance batch evidence/);
    expect(screen.queryByText(/Batch evidence accepted/)).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});

import { transferableAbortController } from 'node:util';

import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import example from '../../../../public/examples/synthetic-posting-associations.json';
import unresolvedExample from '../../../../public/examples/synthetic-posting-evidence.json';
import type {
  RelationshipList,
  RelationshipPreview,
  RelationshipReleasePreview,
  RelationshipTargets,
} from '../../../lib/posting-evidence/use-posting-relationships.js';

import { PostingEvidencePage } from './posting-evidence-page.js';
import {
  postingHistoryFixture,
  postingListFixture,
  postingPreviewFixture,
  postingReceiptFixture,
} from './posting-evidence.fixtures.js';
import {
  relationshipCandidateFixture,
  relationshipEvidenceFixture,
  relationshipFixture,
  relationshipListFixture,
  relationshipPreviewFixture,
  relationshipReceiptFixture,
  relationshipReleaseFixture,
  relationshipReleasePreviewFixture,
  relationshipTargetsFixture,
} from './posting-relationships.fixtures.js';
import { PostingRelationships } from './posting-relationships.js';

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
  authorization: string | null;
  body: unknown;
}
let requests: RequestRecord[];
let list: RelationshipList;
let targets: RelationshipTargets;
let preview: RelationshipPreview;
let releasePreview: RelationshipReleasePreview;
let handler: ((record: RequestRecord) => Promise<Response | undefined>) | undefined;
const lockChanged = vi.fn<(locked: boolean) => void>();
const BASE = '/v1/posting-relationships';
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function deferred<T>() {
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
  Object.assign(auth, { userId: 'user_a', orgId: 'org_a', isLoaded: true });
  requests = [];
  list = relationshipListFixture();
  targets = relationshipTargetsFixture();
  preview = relationshipPreviewFixture();
  releasePreview = relationshipReleasePreviewFixture();
  handler = undefined;
  lockChanged.mockClear();
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
      authorization: req.headers.get('authorization'),
      body: req.method === 'POST' ? ((await req.json()) as unknown) : null,
    };
    requests.push(record);
    const override = await handler?.(record);
    if (override) return override;
    if (record.method === 'GET') {
      if (record.path === BASE) return json(list);
      if (record.path.endsWith('/relationship-targets')) return json(targets);
      const evidence = relationshipEvidenceFixture();
      const receipt = postingReceiptFixture(evidence, {
        currentAcceptedEvidence: evidence,
        freshness: 'CURRENT',
      });
      if (record.path.includes('/receipts/')) return json(postingHistoryFixture(receipt));
      if (record.path.endsWith('/preview')) return json(postingPreviewFixture(evidence));
      return json(postingListFixture([receipt]));
    }
    if (record.path === `${BASE}/preview`) return json(preview);
    if (record.path.endsWith('/release/preview')) return json(releasePreview);
    if (record.path.endsWith('/release')) {
      list = relationshipListFixture([
        relationshipFixture({ status: 'RELEASED', release: relationshipReleaseFixture() }),
      ]);
      return json(relationshipReleaseFixture(), 201);
    }
    if (record.path === BASE) {
      list = relationshipListFixture([relationshipFixture()]);
      return json(relationshipReceiptFixture(), 201);
    }
    return json({ code: 'UNEXPECTED_TEST_ROUTE' }, 500);
  });
});
function renderView(fullPage = false) {
  const client = createDentaBillQueryClient();
  const view = () => (
    <QueryProvider client={client}>
      {fullPage ? (
        <PostingEvidencePage />
      ) : (
        <PostingRelationships
          key={JSON.stringify([auth.userId, auth.orgId])}
          scope={[auth.userId, auth.orgId]}
          evidence={relationshipEvidenceFixture()}
          disabled={false}
          onLockChange={lockChanged}
        />
      )}
    </QueryProvider>
  );
  const rendered = render(view());
  return {
    user: userEvent.setup(),
    rerender: () => {
      rendered.rerender(view());
    },
    unmount: rendered.unmount,
  };
}
async function openPreview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Inspect exact claim candidates' }));
  await user.click(
    await screen.findByRole('button', { name: 'Preview association for fake-payment-entry' }),
  );
  await screen.findByRole('region', { name: 'Review exact claim association' });
}
async function openRelease(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(
    await screen.findByRole('button', { name: 'Release association for fake-payment-entry' }),
  );
  await user.selectOptions(screen.getByLabelText('Reason for full release'), 'SOURCE_CHANGED');
  await user.click(screen.getByRole('button', { name: 'Open fresh release preview' }));
  await screen.findByRole('button', { name: 'Confirm full release' });
}
const decisions = () => requests.filter((r) => r.method === 'POST' && r.path === BASE);
const releases = () => requests.filter((r) => r.method === 'POST' && r.path.endsWith('/release'));

describe('posting associations through actual hook and generated SDK transport', () => {
  it('inspects exact candidates, preserves source facts, previews and records a reviewed claim and line association', async () => {
    const { user } = renderView();
    await openPreview(user);
    const region = screen.getByRole('region', { name: 'Review exact claim association' });
    expect(within(region).getByRole('link', { name: 'Claim FAKE-CLAIM-100' })).toHaveAttribute(
      'href',
      '/dashboard/claims/fake-local-claim-a',
    );
    for (const [label, value] of [
      ['Signed entry amount (USD)', '+$100.00'],
      ['Original source entry amount (USD)', '−$100.00'],
      ['Raw source transfer flag', 'False'],
      ['Signed receipt header (USD)', '+$150.00'],
      ['Original source header (USD)', '−$150.00'],
    ])
      expect(within(region).getByText(label!).nextElementSibling).toHaveTextContent(value!);
    expect(within(region).getByText(/Claim cash: unallocated/)).toHaveTextContent(
      'Bank verification: unverified',
    );
    expect(requests.find((r) => r.path === `${BASE}/preview`)?.body).toEqual(
      relationshipCandidateFixture(),
    );
    expect(decisions()).toHaveLength(0);
    await user.click(within(region).getByRole('button', { name: 'Record claim association' }));
    await screen.findByText(/Claim association recorded/);
    expect(decisions()[0]?.body).toEqual({
      ...relationshipCandidateFixture(),
      reviewToken: preview.reviewToken,
      idempotencyKey: expect.any(String),
    });
    expect(await screen.findByText('Current association')).toBeInTheDocument();
    expect(
      screen.getByText(/no payment, recovered revenue or claim cash allocation was created/),
    ).toBeInTheDocument();
  });

  it('records claim-only evidence without guessing a line from a raw procedure reference or unknown amount', async () => {
    preview.candidate.claimSourceLineId = null;
    preview.claim.line = null;
    preview.source.entry = {
      ...preview.source.entry,
      sourceLineId: null,
      sourceProcedureId: 'fake-unresolved-procedure',
      entryKind: 'TRANSFER',
      sourceIsTransfer: true,
      amount: null,
      sourceAmount: null,
    };
    targets.items[0] = {
      source: preview.source,
      candidate: preview.candidate,
      claim: preview.claim,
      blockers: [],
    };
    const { user } = renderView();
    await openPreview(user);
    const region = screen.getByRole('region', { name: 'Review exact claim association' });
    expect(within(region).getByText(/Claim-only association/)).toHaveTextContent(
      'raw procedure reference remains unresolved',
    );
    expect(
      within(region).getByText('Raw source procedure ID').nextElementSibling,
    ).toHaveTextContent('fake-unresolved-procedure');
    expect(
      within(region).getByText('Signed entry amount (USD)').nextElementSibling,
    ).toHaveTextContent('Unknown');
    expect(
      within(region).getByText('Raw source transfer flag').nextElementSibling,
    ).toHaveTextContent('True');
    await user.click(within(region).getByRole('button', { name: 'Record claim association' }));
    await screen.findByText(/Claim association recorded/);
    expect(decisions()[0]?.body).toMatchObject({ claimSourceLineId: null });
  });

  it.each<RelationshipPreview['blockers'][number]>([
    'SOURCE_NOT_ACCEPTED',
    'SOURCE_NOT_CURRENT',
    'SOURCE_SYSTEM_UNSUPPORTED',
    'SOURCE_CLAIM_ID_MISSING',
    'CLAIM_SOURCE_IDENTITY_MISMATCH',
    'SOURCE_LINE_ID_MISSING',
    'SOURCE_LINE_NOT_FOUND',
    'SOURCE_PROCEDURE_MISMATCH',
    'ENTRY_ALREADY_LINKED',
    'CLAIM_CHANGED',
  ])('honors server blocker %s without recording', async (blocker) => {
    preview.blockers = [blocker];
    const { user } = renderView();
    await openPreview(user);
    expect(screen.getByRole('button', { name: 'Record claim association' })).toBeDisabled();
    expect(screen.getByRole('list', { name: 'Association blockers' })).toBeInTheDocument();
    expect(decisions()).toHaveLength(0);
  });

  it('keeps unsupported sources unresolved and offers no inferred target or claim link', async () => {
    targets.items[0] = {
      ...targets.items[0]!,
      candidate: null,
      claim: null,
      blockers: ['SOURCE_SYSTEM_UNSUPPORTED'],
    };
    const { user } = renderView();
    await user.click(screen.getByRole('button', { name: 'Inspect exact claim candidates' }));
    const region = await screen.findByRole('region', { name: 'Exact claim candidates' });
    expect(within(region).getByText(/Raw source references remain unresolved/)).toBeInTheDocument();
    expect(within(region).queryByRole('link')).not.toBeInTheDocument();
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
  });

  it.each(['network', 'server', 'empty'] as const)(
    'retains an identical association request after an uncertain %s result',
    async (failure) => {
      let calls = 0;
      handler = async (r) => {
        if (r.method === 'POST' && r.path === BASE && calls++ === 0) {
          if (failure === 'network') throw new Error('test connection lost');
          return failure === 'empty'
            ? new Response(null, { status: 204 })
            : json({ code: 'UNAVAILABLE' }, 503);
        }
        return undefined;
      };
      const { user } = renderView();
      await openPreview(user);
      await user.click(screen.getByRole('button', { name: 'Record claim association' }));
      const retry = await screen.findByRole('button', { name: 'Retry same association' });
      expect(screen.getByRole('button', { name: 'Refresh exact claim candidates' })).toBeDisabled();
      expect(lockChanged).toHaveBeenLastCalledWith(true);
      await user.click(retry);
      await screen.findByText(/Claim association recorded/);
      expect(decisions()).toHaveLength(2);
      expect(decisions()[1]?.body).toEqual(decisions()[0]?.body);
      expect(lockChanged).toHaveBeenLastCalledWith(false);
    },
  );

  it.each([400, 401, 403, 404, 409, 422])(
    'requires a new preview after a definitive create refusal %s',
    async (status) => {
      handler = async (r) =>
        r.method === 'POST' && r.path === BASE ? json({ code: 'REFUSED' }, status) : undefined;
      const { user } = renderView();
      await openPreview(user);
      await user.click(screen.getByRole('button', { name: 'Record claim association' }));
      await screen.findByRole('alert');
      expect(
        screen.queryByRole('button', { name: 'Retry same association' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Record claim association' }),
      ).not.toBeInTheDocument();
    },
  );

  it('releases a stale reservation with an explicit reason and identical uncertain retry, without automatically relinking', async () => {
    list = relationshipListFixture([
      relationshipFixture({ status: 'STALE', blockers: ['SOURCE_NOT_CURRENT', 'CLAIM_CHANGED'] }),
    ]);
    let calls = 0;
    handler = async (r) =>
      r.method === 'POST' && r.path.endsWith('/release') && calls++ === 0
        ? json({ code: 'UNAVAILABLE' }, 503)
        : undefined;
    const { user } = renderView();
    await user.click(
      await screen.findByRole('button', { name: 'Release association for fake-payment-entry' }),
    );
    expect(screen.getByRole('button', { name: 'Open fresh release preview' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Reason for full release'), 'SOURCE_CHANGED');
    await user.click(screen.getByRole('button', { name: 'Open fresh release preview' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm full release' }));
    await screen.findByRole('button', { name: 'Retry same release' });
    expect(screen.getByLabelText('Reason for full release')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry same release' }));
    await screen.findByText(/Association fully released/);
    expect(releases()[1]?.body).toEqual(releases()[0]?.body);
    expect(releases()[0]?.body).toEqual({
      reason: 'SOURCE_CHANGED',
      reviewToken: releasePreview.reviewToken,
      idempotencyKey: expect.any(String),
    });
    expect(releases()[0]?.path).toBe(`${BASE}/${releasePreview.relationship.id}/release`);
    expect(await screen.findByText('Released association')).toBeInTheDocument();
    expect(decisions()).toHaveLength(0);
  });

  it('invalidates a release preview when the human reason changes and respects an already released response', async () => {
    list = relationshipListFixture([relationshipFixture()]);
    const { user } = renderView();
    await openRelease(user);
    await user.selectOptions(screen.getByLabelText('Reason for full release'), 'WRONG_LINK');
    expect(screen.queryByRole('button', { name: 'Confirm full release' })).not.toBeInTheDocument();
    releasePreview = relationshipReleasePreviewFixture({
      reason: 'WRONG_LINK',
      canRelease: false,
      release: relationshipReleaseFixture(),
    });
    await user.click(screen.getByRole('button', { name: 'Open fresh release preview' }));
    await screen.findByText(/This association has already been released/);
    expect(releases()).toHaveLength(0);
  });

  it('preserves loaded association rows through a next-page failure and pages with the opaque cursor', async () => {
    list = {
      ...relationshipListFixture([relationshipFixture()]),
      hasMore: true,
      nextCursor: 'fake-cursor',
    };
    handler = async (r) =>
      r.path === BASE && r.query.includes('cursor=')
        ? json({ code: 'UNAVAILABLE' }, 503)
        : undefined;
    const { user } = renderView();
    await user.click(await screen.findByRole('button', { name: 'Load older associations' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Current association')).toBeInTheDocument();
    expect(requests.find((r) => r.query.includes('cursor='))?.query).toBe(
      '?limit=10&cursor=fake-cursor',
    );
    expect(screen.getByRole('button', { name: 'Retry association history' })).toBeEnabled();
  });

  it.each(['user', 'org', 'personal'] as const)(
    'separates query data and rejects old pending responses after a %s scope change',
    async (scope) => {
      const pending = deferred<Response>();
      let delayed = false;
      handler = async (r) => {
        if (r.path.endsWith('/relationship-targets') && !delayed) {
          delayed = true;
          return pending.promise;
        }
        return undefined;
      };
      const { user, rerender } = renderView();
      await user.click(screen.getByRole('button', { name: 'Inspect exact claim candidates' }));
      await waitFor(() => {
        expect(delayed).toBe(true);
      });
      if (scope === 'user') auth.userId = 'user_b';
      else auth.orgId = scope === 'personal' ? null : 'org_b';
      rerender();
      await act(async () => {
        pending.resolve(json(targets));
      });
      expect(
        screen.queryByRole('region', { name: 'Exact claim candidates' }),
      ).not.toBeInTheDocument();
      await waitFor(() => {
        expect(requests.filter((r) => r.path === BASE)).toHaveLength(2);
      });
      expect(requests.filter((r) => r.path === BASE).at(-1)?.authorization).toBe(
        `Bearer ${auth.userId}:${auth.orgId ?? 'personal'}`,
      );
    },
  );

  it('does not send a pending create after its account changes while auth headers are being obtained', async () => {
    const { user, rerender } = renderView();
    await openPreview(user);
    const pending = deferred<Record<string, string>>();
    headersMock.mockImplementationOnce(() => pending.promise);
    await user.click(screen.getByRole('button', { name: 'Record claim association' }));
    auth.orgId = 'org_b';
    rerender();
    await act(async () => {
      pending.resolve({ authorization: 'Bearer old-scope' });
    });
    expect(decisions()).toHaveLength(0);
    expect(screen.queryByText(/Claim association recorded/)).not.toBeInTheDocument();
  });

  it('locks receipt import and selection while an association decision is uncertain in the complete page', async () => {
    handler = async (r) =>
      r.method === 'POST' && r.path === BASE ? json({ code: 'UNAVAILABLE' }, 503) : undefined;
    const { user } = renderView(true);
    await user.click(
      await screen.findByRole('button', {
        name: 'View receipt fake-receipt-a in synthetic-office',
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Preview source sequence 2' }));
    await openPreview(user);
    await user.click(screen.getByRole('button', { name: 'Record claim association' }));
    await screen.findByRole('button', { name: 'Retry same association' });
    expect(screen.getByLabelText('PMS payment receipt JSON')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'View receipt fake-receipt-a in synthetic-office' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview source sequence 2' })).toBeDisabled();
    expect(
      screen.getByRole('link', { name: 'Download synthetic exact-association example' }),
    ).toHaveAttribute('href', '/examples/synthetic-posting-associations.json');
  });

  it('preserves candidate facts after a failed refresh and never commits a failed association preview', async () => {
    const { user } = renderView();
    await user.click(screen.getByRole('button', { name: 'Inspect exact claim candidates' }));
    await screen.findByRole('region', { name: 'Exact claim candidates' });
    handler = async (r) =>
      r.path.endsWith('/relationship-targets') || r.path === `${BASE}/preview`
        ? json({ code: 'UNAVAILABLE' }, 503)
        : undefined;
    await user.click(screen.getByRole('button', { name: 'Refresh exact claim candidates' }));
    await screen.findByText(/Exact claim candidates could not be loaded/);
    expect(screen.getByRole('region', { name: 'Exact claim candidates' })).toHaveTextContent(
      'fake-payment-entry',
    );
    await user.click(
      screen.getByRole('button', { name: 'Preview association for fake-payment-entry' }),
    );
    await screen.findByText(/association preview could not be confirmed/);
    expect(
      screen.queryByRole('button', { name: 'Record claim association' }),
    ).not.toBeInTheDocument();
    expect(decisions()).toHaveLength(0);
  });

  it('keeps failed release previews separate from a release decision', async () => {
    list = relationshipListFixture([relationshipFixture({ status: 'STALE' })]);
    handler = async (r) =>
      r.path.endsWith('/release/preview') ? json({ code: 'UNAVAILABLE' }, 503) : undefined;
    const { user } = renderView();
    await user.click(
      await screen.findByRole('button', { name: 'Release association for fake-payment-entry' }),
    );
    await user.selectOptions(screen.getByLabelText('Reason for full release'), 'SOURCE_CHANGED');
    await user.click(screen.getByRole('button', { name: 'Open fresh release preview' }));
    await screen.findByText(/release preview could not be loaded/);
    expect(screen.queryByRole('button', { name: 'Confirm full release' })).not.toBeInTheDocument();
    expect(releases()).toHaveLength(0);
  });

  it('requires a fresh release preview after a definitive conflict', async () => {
    list = relationshipListFixture([relationshipFixture({ status: 'STALE' })]);
    handler = async (r) =>
      r.path.endsWith('/release') ? json({ code: 'CONFLICT' }, 409) : undefined;
    const { user } = renderView();
    await openRelease(user);
    await user.click(screen.getByRole('button', { name: 'Confirm full release' }));
    await screen.findByText(/association changed/);
    expect(screen.queryByRole('button', { name: 'Retry same release' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm full release' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open fresh release preview' })).toBeEnabled();
  });

  it('does not send a release after its account changes while auth headers are pending', async () => {
    list = relationshipListFixture([relationshipFixture({ status: 'STALE' })]);
    const { user, rerender } = renderView();
    await openRelease(user);
    const pending = deferred<Record<string, string>>();
    headersMock.mockImplementationOnce(() => pending.promise);
    await user.click(screen.getByRole('button', { name: 'Confirm full release' }));
    auth.userId = 'user_b';
    rerender();
    await act(async () => {
      pending.resolve({ authorization: 'Bearer old-scope' });
    });
    expect(releases()).toHaveLength(0);
    expect(screen.queryByText(/Association fully released/)).not.toBeInTheDocument();
  });

  it('keeps the supported synthetic example separate from unresolved source observations and preserves original signs', () => {
    expect(example.sourceSystem).toBe('OPEN_DENTAL');
    expect(unresolvedExample.sourceSystem).toBe('synthetic-pms');
    expect(example.entries[0]).toMatchObject({
      sourceClaimId: 'fake-source-claim-a',
      sourceLineId: 'fake-source-line-a',
      sourceProcedureId: 'fake-source-procedure-a',
      amount: '100.00',
      sourceAmount: '-100.00',
    });
    expect(example.entries[1]).toMatchObject({
      sourceLineId: null,
      sourceProcedureId: 'fake-unresolved-procedure-b',
      entryKind: 'TRANSFER',
      sourceIsTransfer: true,
    });
  });
});

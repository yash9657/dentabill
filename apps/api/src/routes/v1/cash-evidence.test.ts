import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { prisma, type UserRole } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import {
  CashEvidenceSchema,
  CashHistorySchema,
  CashInputSchema,
  CashListSchema,
  CashPreviewSchema,
  type CashInput,
  type CashReviewInput,
} from '../../lib/cash-evidence/contract.js';

type FixtureName =
  | '01-pending-100.json'
  | '02-posted-90.json'
  | '03-removed.json'
  | '04-independent-debit-20.json'
  | '05-pending-p-75.json'
  | '06-posted-q-75.json';
function fixture(name: FixtureName): CashInput {
  // The finite filename union references checked-in fabricated inputs only.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const content = readFileSync(
    new URL(`../../../test/fixtures/cash-evidence/${name}`, import.meta.url),
    'utf8',
  );
  const value: unknown = JSON.parse(content);
  return CashInputSchema.parse(value);
}
function input(overrides: Partial<CashInput> = {}): CashInput {
  const base = fixture('01-pending-100.json');
  const sourceTransactionId = overrides.sourceTransactionId ?? base.sourceTransactionId;
  const sourceSequence = overrides.sourceSequence ?? base.sourceSequence;
  return {
    ...base,
    ...overrides,
    sourceRecordId:
      overrides.sourceRecordId ?? `${sourceTransactionId}-seq-${String(sourceSequence)}`,
  };
}
function posted(overrides: Partial<CashInput> = {}): CashInput {
  return input({
    status: 'POSTED',
    amount: '90.00',
    sourceAmount: '90.00',
    postingDate: '2026-10-02',
    ...overrides,
  });
}
function removed(overrides: Partial<CashInput> = {}): CashInput {
  return input({
    sourceSequence: 2,
    status: 'REMOVED',
    amount: null,
    sourceAmount: null,
    ...overrides,
  });
}
async function seed(role: UserRole = 'BILLING_STAFF', existingOrganizationId?: string) {
  const organizationId =
    existingOrganizationId ??
    (
      await prisma.organization.create({
        data: {
          name: 'Synthetic cash evidence practice',
          clerkOrgId: `org_${randomUUID()}`,
        },
      })
    ).id;
  const user = await prisma.user.create({
    data: {
      organizationId,
      clerkUserId: `user_${randomUUID()}`,
      email: `${randomUUID()}@example.test`,
      role,
    },
  });
  return { organizationId, user, headers: { 'x-test-user-id': user.clerkUserId } };
}
type Seed = Awaited<ReturnType<typeof seed>>;
const BASE = '/v1/cash-evidence';
const PRIVATE_MARKER = 'SYNTHETIC-PRIVATE-CASH-CONTENT';

describe('cash evidence API (synthetic, real Postgres)', () => {
  let app: FastifyInstance;
  const logs: string[] = [];
  let requestOrdinal = 0;
  function inject(options: InjectOptions) {
    // These in-memory route tests exercise the ledger, not a shared client-IP
    // quota. Distinct documentation-only IPv6 addresses keep the 100-node
    // graph setup from consuming the production rate limiter's same bucket.
    requestOrdinal += 1;
    return app.inject({ ...options, remoteAddress: `2001:db8::${requestOrdinal.toString(16)}` });
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.startsWith('/dentabill_')
    )
      throw new Error('Cash evidence tests require an isolated local DentaBill database.');
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    app = await buildServer({
      logger: createLogger({
        level: 'info',
        pretty: false,
        stream: {
          write: (line) => {
            logs.push(line);
          },
        },
      }),
    });
    await prisma.$connect();
  });
  async function removeAuditFailure(): Promise<void> {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_cash_test_audit ON "AuditLog"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_cash_test_audit()');
  }
  afterEach(async () => {
    await removeAuditFailure();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
    logs.length = 0;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function imported(s: Seed, payload = input()) {
    const response = await inject({ method: 'POST', url: BASE, headers: s.headers, payload });
    expect(response.statusCode, response.body).toBe(201);
    return CashEvidenceSchema.parse(response.json());
  }
  async function preview(s: Seed, evidenceId: string) {
    const response = await inject({
      method: 'GET',
      url: `${BASE}/${evidenceId}/preview`,
      headers: s.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    return CashPreviewSchema.parse(response.json());
  }
  async function reviewBody(
    s: Seed,
    evidenceId: string,
    decision: CashReviewInput['decision'] = 'ACCEPT',
  ): Promise<CashReviewInput> {
    return {
      decision,
      reviewToken: (await preview(s, evidenceId)).reviewToken,
      idempotencyKey: randomUUID(),
    };
  }
  function review(s: Seed, evidenceId: string, payload: CashReviewInput) {
    return inject({
      method: 'POST',
      url: `${BASE}/${evidenceId}/review`,
      headers: s.headers,
      payload,
    });
  }
  async function accepted(s: Seed, evidenceId: string) {
    const response = await review(s, evidenceId, await reviewBody(s, evidenceId));
    expect(response.statusCode, response.body).toBe(200);
    return CashEvidenceSchema.parse(response.json());
  }
  async function acceptInput(s: Seed, payload: CashInput) {
    const row = await imported(s, payload);
    await accepted(s, row.id);
    return row;
  }
  async function list(s: Seed, suffix = '') {
    const response = await inject({
      method: 'GET',
      url: `${BASE}${suffix}`,
      headers: s.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(Buffer.byteLength(response.body)).toBeLessThanOrEqual(2 * 1024 * 1024);
    return CashListSchema.parse(response.json());
  }
  async function history(s: Seed, transactionId: string, suffix = '') {
    const response = await inject({
      method: 'GET',
      url: `${BASE}/transactions/${transactionId}${suffix}`,
      headers: s.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(Buffer.byteLength(response.body)).toBeLessThanOrEqual(2 * 1024 * 1024);
    return CashHistorySchema.parse(response.json());
  }
  async function failAudit(action: 'cash.import' | 'cash.review' | 'cash.read'): Promise<void> {
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_cash_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION '${PRIVATE_MARKER}'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_cash_test_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_cash_test_audit()',
    );
  }
  async function financialCounts() {
    return {
      claims: await prisma.claim.count(),
      remittances: await prisma.claimRemittanceEvidence.count(),
      allocations: await prisma.claimRemittanceAllocation.count(),
      usage: await prisma.billingUsageRecord.count(),
    };
  }

  it('reads and reviews direct database evidence at every UTF-16 token boundary', async () => {
    const s = await seed();
    const p = posted({
      sourceSystem: '𐐀'.repeat(40),
      sourceProduct: '𐐀'.repeat(40),
      sourceAccountId: '𐐀'.repeat(100),
      sourceTransactionId: '𐐀'.repeat(100),
      sourceRecordId: '𐐀'.repeat(100),
      sourceVersion: '𐐀'.repeat(100),
      sourceDocumentId: '𐐀'.repeat(100),
      counterpartyName: '𐐀'.repeat(100),
      paymentTrace: '𐐀'.repeat(100),
      sourceStatus: '𐐀'.repeat(40),
      sourceDescription: '𐐀'.repeat(250),
      pendingSourceTransactionId: 'p' + '𐐀'.repeat(99) + 'x',
    });
    const row = await prisma.$transaction(async (tx) => {
      const transaction = await tx.cashSourceTransaction.create({
        data: {
          organizationId: s.organizationId,
          sourceSystem: p.sourceSystem,
          sourceProduct: p.sourceProduct,
          sourceNamespace: p.sourceNamespace,
          sourceAccountId: p.sourceAccountId,
          sourceTransactionId: p.sourceTransactionId,
        },
      });
      return tx.cashSourceEvidence.create({
        data: {
          organizationId: s.organizationId,
          transactionId: transaction.id,
          sourceNamespace: p.sourceNamespace,
          sourceAccountId: p.sourceAccountId,
          sourceRecordId: p.sourceRecordId,
          sourceVersion: p.sourceVersion,
          sourceDocumentId: p.sourceDocumentId,
          sourceSequence: p.sourceSequence,
          status: p.status,
          amount: p.amount,
          payload: p,
          contentHash: 'a'.repeat(64),
        },
      });
    });
    expect((await list(s)).items[0]?.latestEvidence.payload).toEqual(p);
    expect((await history(s, row.transactionId)).items[0]?.payload).toEqual(p);
    expect((await accepted(s, row.id)).payload).toEqual(p);
    expect((await list(s)).accounts[0]?.postedNetAmount).toBe('90.00');
    const accesses = await prisma.auditLog.findMany({
      where: { organizationId: s.organizationId, action: 'cash.read' },
      select: { resourceType: true, resourceId: true },
    });
    expect(accesses).toEqual(
      expect.arrayContaining([
        { resourceType: 'Organization', resourceId: s.organizationId },
        { resourceType: 'CashSourceTransaction', resourceId: row.transactionId },
        { resourceType: 'CashSourceEvidence', resourceId: row.id },
      ]),
    );
  });

  it('rejects astral overflow and malformed Unicode before importing any evidence', async () => {
    const s = await seed();
    for (const sourceDescription of [
      '𐐀'.repeat(250) + 'a',
      '\u00a0x',
      'x\u3000',
      'x\u200by',
      'x\u{e0001}y',
      '\ud800',
    ]) {
      const response = await inject({
        method: 'POST',
        url: BASE,
        headers: s.headers,
        payload: posted({ sourceDescription }),
      });
      expect(response.statusCode, response.body).toBe(400);
    }
    expect(
      await prisma.cashSourceEvidence.count({ where: { organizationId: s.organizationId } }),
    ).toBe(0);
  });

  it('requires authentication on list, import, history, preview and review', async () => {
    const s = await seed();
    const e = await imported(s);
    const body = await reviewBody(s, e.id);
    const responses = await Promise.all([
      inject({ method: 'GET', url: BASE }),
      inject({ method: 'POST', url: BASE, payload: input() }),
      inject({ method: 'GET', url: `${BASE}/transactions/${e.transactionId}` }),
      inject({ method: 'GET', url: `${BASE}/${e.id}/preview` }),
      inject({ method: 'POST', url: `${BASE}/${e.id}/review`, payload: body }),
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([401, 401, 401, 401, 401]);
    expect(await prisma.cashSourceReview.count()).toBe(0);
  });

  it.each(['OWNER', 'ADMIN', 'BILLING_STAFF'] as const)(
    'allows stored %s authority and records the reviewing role',
    async (role) => {
      const s = await seed(role);
      const e = await imported(s, posted());
      expect((await accepted(s, e.id)).review).toMatchObject({
        reviewedByUserId: s.user.id,
        reviewedByRole: role,
        decision: 'ACCEPT',
      });
      expect((await list(s)).accounts[0]?.postedNetAmount).toBe('90.00');
    },
  );

  it('rejects an unregistered actor despite caller-supplied role and organization headers', async () => {
    const s = await seed();
    const response = await inject({
      method: 'POST',
      url: BASE,
      headers: {
        'x-test-user-id': 'missing-user',
        'x-role': 'OWNER',
        'x-organization-id': s.organizationId,
      },
      payload: input(),
    });
    expect(response.statusCode).toBe(403);
    expect(await prisma.cashSourceTransaction.count()).toBe(0);
  });

  it('keeps the same source IDs independent across tenants and blocks cross-tenant history/preview/review', async () => {
    const own = await seed();
    const other = await seed();
    const a = await imported(own);
    const b = await imported(other);
    expect(a.transactionId).not.toBe(b.transactionId);
    for (const url of [`${BASE}/transactions/${b.transactionId}`, `${BASE}/${b.id}/preview`]) {
      const response = await inject({ method: 'GET', url, headers: own.headers });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('synthetic-checking');
    }
    expect((await review(own, b.id, await reviewBody(other, b.id))).statusCode).toBe(404);
    expect((await list(own)).items.map((item) => item.id)).toEqual([a.transactionId]);
    expect(await prisma.cashSourceReview.count()).toBe(0);
  });

  it('executes all copyable fixtures without cloning revisions, inventing a removal debit, or altering another ledger', async () => {
    const s = await seed();
    const before = await financialCounts();
    const pending = await acceptInput(s, fixture('01-pending-100.json'));
    expect((await list(s)).accounts[0]).toMatchObject({ postedNetAmount: '0.00', pendingCount: 1 });
    const postedRow = await imported(s, fixture('02-posted-90.json'));
    expect(postedRow.transactionId).toBe(pending.transactionId);
    expect((await list(s)).items[0]).toMatchObject({
      freshness: 'STALE',
      currentAcceptedEvidence: { id: pending.id },
    });
    await accepted(s, postedRow.id);
    expect((await list(s)).accounts[0]).toMatchObject({
      postedCreditAmount: '90.00',
      postedDebitAmount: '0.00',
      postedNetAmount: '90.00',
      transactionCount: 1,
    });
    const removal = await imported(s, fixture('03-removed.json'));
    const stale = await list(s);
    expect(stale.accounts[0]).toMatchObject({ postedNetAmount: '0.00', staleCount: 1 });
    expect(stale.items[0]?.currentAcceptedEvidence?.id).toBe(postedRow.id);
    const approvedRemoval = await accepted(s, removal.id);
    expect(approvedRemoval.review?.previousAcceptedEvidenceId).toBe(postedRow.id);
    const debit = await acceptInput(s, fixture('04-independent-debit-20.json'));
    expect(debit.payload).toMatchObject({
      amount: '-20.00',
      sourceAmount: '20.00',
      sourceSignConvention: 'DEBIT_POSITIVE',
    });
    await acceptInput(s, fixture('05-pending-p-75.json'));
    await acceptInput(s, fixture('06-posted-q-75.json'));
    expect((await list(s)).accounts).toEqual([
      expect.objectContaining({
        postedCreditAmount: '75.00',
        postedDebitAmount: '20.00',
        postedNetAmount: '55.00',
        transactionCount: 4,
        postedCount: 2,
        pendingCount: 1,
        removedCount: 1,
        bankVerification: 'UNVERIFIED',
        settlement: 'UNVERIFIED',
      }),
    ]);
    const old = await history(s, pending.transactionId);
    expect(old.items.map((row) => row.payload.sourceSequence)).toEqual([3, 2, 1]);
    expect(old.items.find((row) => row.id === pending.id)?.payload).toEqual(
      fixture('01-pending-100.json'),
    );
    expect(await financialCounts()).toEqual(before);
  }, 15_000);

  it('uses source sequence rather than observed/arrival time or opaque version order', async () => {
    const s = await seed();
    const latest = await imported(
      s,
      posted({ sourceSequence: 3, sourceVersion: 'aaa', observedAt: '2026-01-01T00:00:00.000Z' }),
    );
    const old = await imported(
      s,
      input({ sourceSequence: 1, sourceVersion: 'zzz', observedAt: '2026-12-01T00:00:00.000Z' }),
    );
    expect((await preview(s, old.id)).blockers).toContain('NEWER_SOURCE_EVIDENCE');
    expect((await review(s, old.id, await reviewBody(s, old.id))).statusCode).toBe(409);
    await accepted(s, latest.id);
    await imported(s, input({ sourceSequence: 2, observedAt: '2027-01-01T00:00:00.000Z' }));
    const page = await list(s);
    expect(page.items[0]).toMatchObject({
      latestSourceSequence: 3,
      freshness: 'CURRENT',
      currentAcceptedEvidence: { id: latest.id },
    });
    expect(page.accounts[0]?.postedNetAmount).toBe('90.00');
    expect((await review(s, old.id, await reviewBody(s, old.id, 'REJECT'))).statusCode).toBe(200);
    expect(
      (await history(s, latest.transactionId)).items.map((row) => row.payload.sourceSequence),
    ).toEqual([3, 2, 1]);
  });

  it('keeps prior accepted cash stale after a newer observation is rejected, until a newer eligible source is accepted', async () => {
    const s = await seed();
    const first = await acceptInput(s, posted());
    const uncertain = await imported(
      s,
      input({ sourceSequence: 2, status: 'UNKNOWN', amount: null, sourceAmount: null }),
    );
    expect(
      (await review(s, uncertain.id, await reviewBody(s, uncertain.id, 'REJECT'))).statusCode,
    ).toBe(200);
    const stale = await list(s);
    expect(stale.items[0]).toMatchObject({
      freshness: 'STALE',
      currentAcceptedEvidence: { id: first.id },
      latestEvidence: { id: uncertain.id, review: { decision: 'REJECT' } },
    });
    expect(stale.accounts[0]).toMatchObject({ postedNetAmount: '0.00', staleCount: 1 });
    const next = await acceptInput(
      s,
      posted({ sourceSequence: 3, amount: '80.00', sourceAmount: '80.00' }),
    );
    expect((await list(s)).items[0]).toMatchObject({
      freshness: 'CURRENT',
      currentAcceptedEvidence: { id: next.id },
    });
    expect((await list(s)).accounts[0]?.postedNetAmount).toBe('80.00');
    expect((await preview(s, first.id)).blockers).toContain('ALREADY_REVIEWED');
  });

  it('does not include unreviewed, pending, unknown or removed reports in posted sums', async () => {
    const s = await seed();
    await imported(s, posted({ sourceTransactionId: 'unreviewed' }));
    await acceptInput(s, input({ sourceTransactionId: 'pending' }));
    await acceptInput(
      s,
      input({
        sourceTransactionId: 'unknown',
        status: 'UNKNOWN',
        amount: '30.00',
        sourceAmount: '30.00',
      }),
    );
    await acceptInput(s, removed({ sourceTransactionId: 'removed', sourceSequence: 1 }));
    expect((await list(s)).accounts[0]).toMatchObject({
      postedCreditAmount: '0.00',
      postedDebitAmount: '0.00',
      postedNetAmount: '0.00',
      postedCount: 0,
      pendingCount: 1,
      unknownCount: 1,
      removedCount: 1,
      unreviewedCount: 1,
    });
  });

  it('returns manual/unverified provenance even for a caller naming a familiar bank-data product', async () => {
    const s = await seed();
    const e = await acceptInput(
      s,
      posted({ sourceSystem: 'PLAID', sourceProduct: 'TRANSACTIONS' }),
    );
    const p = await preview(s, e.id);
    expect(p.evidence).toMatchObject({
      provenance: 'MANUAL_UPLOAD',
      bankVerification: 'UNVERIFIED',
      settlement: 'UNVERIFIED',
    });
    expect(p).toMatchObject({ bankVerification: 'UNVERIFIED', settlement: 'UNVERIFIED' });
  });

  it('serializes concurrent exact imports into one parent/evidence with audited replays', async () => {
    const s = await seed();
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        inject({ method: 'POST', url: BASE, headers: s.headers, payload: input() }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 201]);
    expect(new Set(responses.map((r) => CashEvidenceSchema.parse(r.json()).id)).size).toBe(1);
    expect(await prisma.cashSourceTransaction.count()).toBe(1);
    expect(await prisma.cashSourceEvidence.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'cash.import' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'cash.read' } })).toBe(3);
  });

  it.each([
    { amount: '99.00', sourceAmount: '99.00' },
    { sourceVersion: 'changed' },
    { sourceTransactionId: 'different-transaction', sourceRecordId: 'synthetic-credit-a-seq-1' },
    { sourceRecordId: 'different-record-same-sequence' },
  ] satisfies Partial<CashInput>[])(
    'rejects changed record facts or rebound source identity %#',
    async (overrides) => {
      const s = await seed();
      const original = await imported(s);
      const response = await inject({
        method: 'POST',
        url: BASE,
        headers: s.headers,
        payload: input(overrides),
      });
      expect(response.statusCode).toBe(409);
      expect(await prisma.cashSourceTransaction.count()).toBe(1);
      expect(await prisma.cashSourceEvidence.count()).toBe(1);
      expect((await history(s, original.transactionId)).items[0]?.payload).toEqual(input());
    },
  );

  it.each(['sourceSystem', 'sourceProduct'] as const)(
    'rejects %s drift anywhere within one namespace/account',
    async (field) => {
      const s = await seed();
      await imported(s);
      for (const sourceTransactionId of ['synthetic-credit-a', 'new-transaction']) {
        const response = await inject({
          method: 'POST',
          url: BASE,
          headers: s.headers,
          payload: input({ [field]: 'different-product', sourceTransactionId, sourceSequence: 2 }),
        });
        expect(response.statusCode).toBe(409);
      }
      expect(await prisma.cashSourceEvidence.count()).toBe(1);
    },
  );

  it('groups totals by namespace/account/product and never deduplicates or adds them as one global receipt', async () => {
    const s = await seed();
    for (const overrides of [
      {},
      { sourceAccountId: 'second-account' },
      {
        sourceNamespace: 'second-source',
        sourceSystem: 'OTHER_SYNTHETIC_BANK',
        sourceProduct: 'OTHER_PRODUCT',
      },
    ])
      await acceptInput(s, posted(overrides));
    const page = await list(s);
    expect(page.accounts).toHaveLength(3);
    expect(page.accounts.map((a) => a.postedNetAmount)).toEqual(['90.00', '90.00', '90.00']);
    expect(page).not.toHaveProperty('postedNetAmount');
    expect(new Set(page.items.map((item) => item.id)).size).toBe(3);
  });

  it('rejects stale previews after any organization cash evidence/review change', async () => {
    const s = await seed();
    const a = await imported(s, posted());
    const b = await imported(s, posted({ sourceTransactionId: 'other-transaction' }));
    const body = await reviewBody(s, a.id);
    await accepted(s, b.id);
    expect((await review(s, a.id, body)).statusCode).toBe(409);
    const refreshed = await reviewBody(s, a.id);
    await imported(s, input({ sourceTransactionId: 'third-transaction' }));
    expect((await review(s, a.id, refreshed)).statusCode).toBe(409);
    await accepted(s, a.id);
  });

  it('serializes concurrent different reviews and requires the loser to refresh', async () => {
    const s = await seed();
    const a = await imported(s, posted());
    const b = await imported(s, posted({ sourceTransactionId: 'other-transaction' }));
    const bodies = await Promise.all([reviewBody(s, a.id), reviewBody(s, b.id)]);
    const responses = await Promise.all([review(s, a.id, bodies[0]), review(s, b.id, bodies[1])]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const loser = responses[0].statusCode === 409 ? a : b;
    await accepted(s, loser.id);
    expect((await list(s)).accounts[0]?.postedNetAmount).toBe('180.00');
  });

  it('replays an exact lost response and simultaneous same-key approvals without duplicate history', async () => {
    const s = await seed();
    const e = await imported(s, posted());
    const body = await reviewBody(s, e.id);
    const responses = await Promise.all([review(s, e.id, body), review(s, e.id, body)]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(responses[0].json()).toEqual(responses[1].json());
    await imported(s, removed());
    const replay = await review(s, e.id, body);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(responses[0].json());
    expect(await prisma.cashSourceReview.count()).toBe(1);
    expect((await list(s)).accounts[0]?.postedNetAmount).toBe('0.00');
  });

  it('binds approval replay to actor, exact decision/token and evidence', async () => {
    const s = await seed();
    const e = await imported(s, posted());
    const body = await reviewBody(s, e.id);
    expect((await review(s, e.id, body)).statusCode).toBe(200);
    const other = await seed('OWNER', s.organizationId);
    expect((await review(other, e.id, body)).statusCode).toBe(409);
    expect((await review(s, e.id, { ...body, decision: 'REJECT' })).statusCode).toBe(409);
    expect((await review(s, e.id, { ...body, reviewToken: 'f'.repeat(64) })).statusCode).toBe(409);
    const second = await imported(s, posted({ sourceTransactionId: 'other-transaction' }));
    expect(
      (
        await review(s, second.id, {
          ...(await reviewBody(s, second.id)),
          idempotencyKey: body.idempotencyKey,
        })
      ).statusCode,
    ).toBe(409);
    expect(await prisma.cashSourceReview.count()).toBe(1);
  });

  it('blocks posted replacement of a stale accepted posted parent until the parent is explicitly retired', async () => {
    const s = await seed();
    const parent = await acceptInput(s, posted({ sourceTransactionId: 'parent' }));
    const child = await imported(
      s,
      posted({ sourceTransactionId: 'child', pendingSourceTransactionId: 'parent' }),
    );
    expect((await preview(s, child.id)).blockers).toContain('POSTED_REPLACEMENT_OVERLAP');
    const removal = await imported(s, removed({ sourceTransactionId: 'parent' }));
    expect((await history(s, parent.transactionId)).transaction.freshness).toBe('STALE');
    expect((await preview(s, child.id)).blockers).toContain('POSTED_REPLACEMENT_OVERLAP');
    expect((await review(s, child.id, await reviewBody(s, child.id))).statusCode).toBe(409);
    await accepted(s, removal.id);
    await accepted(s, child.id);
    expect((await list(s)).accounts[0]?.postedNetAmount).toBe('90.00');
  });

  it('does not clear replacement overlap by rejecting a newer parent removal', async () => {
    const s = await seed();
    await acceptInput(s, posted({ sourceTransactionId: 'parent' }));
    const removal = await imported(s, removed({ sourceTransactionId: 'parent' }));
    expect(
      (await review(s, removal.id, await reviewBody(s, removal.id, 'REJECT'))).statusCode,
    ).toBe(200);
    const child = await imported(
      s,
      posted({ sourceTransactionId: 'child', pendingSourceTransactionId: 'parent' }),
    );
    expect((await preview(s, child.id)).blockers).toContain('POSTED_REPLACEMENT_OVERLAP');
  });

  it('blocks sibling posted replacements even while their common parent is pending', async () => {
    const s = await seed();
    await acceptInput(s, input({ sourceTransactionId: 'parent' }));
    await acceptInput(
      s,
      posted({ sourceTransactionId: 'child-a', pendingSourceTransactionId: 'parent' }),
    );
    const sibling = await imported(
      s,
      posted({ sourceTransactionId: 'child-b', pendingSourceTransactionId: 'parent' }),
    );
    expect((await preview(s, sibling.id)).blockers).toContain('POSTED_REPLACEMENT_OVERLAP');
    expect((await review(s, sibling.id, await reviewBody(s, sibling.id))).statusCode).toBe(409);
    expect((await list(s)).accounts[0]?.postedNetAmount).toBe('90.00');
  });

  it('follows historical chain links when a newer accepted revision omits its old pending reference', async () => {
    const s = await seed();
    await acceptInput(s, input({ sourceTransactionId: 'a' }));
    await acceptInput(s, input({ sourceTransactionId: 'b', pendingSourceTransactionId: 'a' }));
    await acceptInput(
      s,
      input({ sourceTransactionId: 'b', sourceSequence: 2, pendingSourceTransactionId: null }),
    );
    await acceptInput(s, posted({ sourceTransactionId: 'c', pendingSourceTransactionId: 'b' }));
    const head = await imported(s, posted({ sourceTransactionId: 'a', sourceSequence: 2 }));
    expect((await preview(s, head.id)).blockers).toContain('POSTED_REPLACEMENT_OVERLAP');
    const rewired = await imported(
      s,
      input({
        sourceTransactionId: 'b',
        sourceSequence: 3,
        pendingSourceTransactionId: 'different-parent',
      }),
    );
    expect((await preview(s, rewired.id)).blockers).toContain('PENDING_LINK_CHANGED');
    expect((await review(s, rewired.id, await reviewBody(s, rewired.id))).statusCode).toBe(409);
    expect(
      (await review(s, rewired.id, await reviewBody(s, rewired.id, 'REJECT'))).statusCode,
    ).toBe(200);
  });

  it('traverses cycles finitely and prevents a second posted member of the connected component', async () => {
    const s = await seed();
    await acceptInput(s, input({ sourceTransactionId: 'a', pendingSourceTransactionId: 'b' }));
    await acceptInput(s, input({ sourceTransactionId: 'b', pendingSourceTransactionId: 'a' }));
    await acceptInput(
      s,
      posted({ sourceTransactionId: 'a', sourceSequence: 2, pendingSourceTransactionId: null }),
    );
    const second = await imported(
      s,
      posted({ sourceTransactionId: 'b', sourceSequence: 2, pendingSourceTransactionId: null }),
    );
    expect((await preview(s, second.id)).blockers).toContain('POSTED_REPLACEMENT_OVERLAP');
  });

  it('blocks a pending bridge that would join two separately accepted posted components', async () => {
    const s = await seed();
    await acceptInput(s, posted({ sourceTransactionId: 'a' }));
    await acceptInput(s, posted({ sourceTransactionId: 'b', pendingSourceTransactionId: 'c' }));
    const bridge = await imported(
      s,
      input({ sourceTransactionId: 'c', pendingSourceTransactionId: 'a' }),
    );
    expect((await preview(s, bridge.id)).blockers).toContain('POSTED_REPLACEMENT_OVERLAP');
    expect((await review(s, bridge.id, await reviewBody(s, bridge.id))).statusCode).toBe(409);
    expect((await review(s, bridge.id, await reviewBody(s, bridge.id, 'REJECT'))).statusCode).toBe(
      200,
    );
    expect((await list(s)).accounts[0]?.postedNetAmount).toBe('180.00');
  });

  it('does not join identically named replacement nodes across accounts or namespaces', async () => {
    const s = await seed();
    await acceptInput(s, posted({ sourceTransactionId: 'parent' }));
    await acceptInput(
      s,
      posted({
        sourceTransactionId: 'child',
        sourceAccountId: 'other-account',
        pendingSourceTransactionId: 'parent',
      }),
    );
    await acceptInput(
      s,
      posted({
        sourceTransactionId: 'child',
        sourceNamespace: 'other-namespace',
        pendingSourceTransactionId: 'parent',
      }),
    );
    expect((await list(s)).accounts.map((a) => a.postedNetAmount)).toEqual([
      '90.00',
      '90.00',
      '90.00',
    ]);
  });

  it('allows only one winner for concurrent sibling replacement reviews', async () => {
    const s = await seed();
    await acceptInput(s, input({ sourceTransactionId: 'parent' }));
    const a = await imported(
      s,
      posted({ sourceTransactionId: 'child-a', pendingSourceTransactionId: 'parent' }),
    );
    const b = await imported(
      s,
      posted({ sourceTransactionId: 'child-b', pendingSourceTransactionId: 'parent' }),
    );
    const bodies = await Promise.all([reviewBody(s, a.id), reviewBody(s, b.id)]);
    const responses = await Promise.all([review(s, a.id, bodies[0]), review(s, b.id, bodies[1])]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const loser = responses[0].statusCode === 409 ? a : b;
    expect((await preview(s, loser.id)).blockers).toContain('POSTED_REPLACEMENT_OVERLAP');
    expect((await review(s, loser.id, await reviewBody(s, loser.id))).statusCode).toBe(409);
    expect((await list(s)).accounts[0]?.postedNetAmount).toBe('90.00');
  });

  it('bounds a linked component at 100 without blocking an unrelated transaction in that account', async () => {
    const s = await seed();
    for (let i = 0; i < 100; i++)
      await acceptInput(
        s,
        input({
          sourceTransactionId: `chain-${String(i)}`,
          pendingSourceTransactionId: i === 0 ? null : `chain-${String(i - 1)}`,
        }),
      );
    const excessive = await imported(
      s,
      posted({ sourceTransactionId: 'chain-100', pendingSourceTransactionId: 'chain-99' }),
    );
    expect((await preview(s, excessive.id)).blockers).toContain('SOURCE_LINK_LIMIT');
    expect((await review(s, excessive.id, await reviewBody(s, excessive.id))).statusCode).toBe(409);
    await acceptInput(s, posted({ sourceTransactionId: 'unrelated' }));
    expect((await list(s)).accounts[0]?.postedNetAmount).toBe('90.00');
  }, 60_000);

  it.each(['cash.import', 'cash.review'] as const)(
    'rolls back parent/evidence/review after late %s audit failure and permits the exact retry',
    async (action) => {
      const s = await seed();
      const row = action === 'cash.review' ? await imported(s, posted()) : null;
      const body = row ? await reviewBody(s, row.id) : null;
      await failAudit(action);
      const response =
        row && body
          ? await review(s, row.id, body)
          : await inject({
              method: 'POST',
              url: BASE,
              headers: s.headers,
              payload: input({ sourceDescription: PRIVATE_MARKER }),
            });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain(PRIVATE_MARKER);
      expect(logs.join('')).not.toContain(PRIVATE_MARKER);
      expect(await prisma.cashSourceTransaction.count()).toBe(row ? 1 : 0);
      expect(await prisma.cashSourceEvidence.count()).toBe(row ? 1 : 0);
      expect(await prisma.cashSourceReview.count()).toBe(0);
      await removeAuditFailure();
      if (row && body) expect((await review(s, row.id, body)).statusCode).toBe(200);
      else await imported(s, input({ sourceDescription: PRIVATE_MARKER }));
    },
  );

  it.each(['list', 'history', 'preview', 'import replay', 'review replay'] as const)(
    'fails %s closed on access-audit failure without exposing payload or changing saved evidence',
    async (kind) => {
      const s = await seed();
      const payload = posted({ sourceDescription: PRIVATE_MARKER });
      const row = await imported(s, payload);
      const body = await reviewBody(s, row.id);
      expect((await review(s, row.id, body)).statusCode).toBe(200);
      const before = await prisma.cashSourceEvidence.findMany({ include: { review: true } });
      const audits = await prisma.auditLog.count();
      await failAudit('cash.read');
      const request = () => {
        if (kind === 'review replay') return review(s, row.id, body);
        if (kind === 'import replay')
          return inject({ method: 'POST', url: BASE, headers: s.headers, payload });
        const url =
          kind === 'list'
            ? BASE
            : kind === 'history'
              ? `${BASE}/transactions/${row.transactionId}`
              : `${BASE}/${row.id}/preview`;
        return inject({ method: 'GET', url, headers: s.headers });
      };
      const response = await request();
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain(PRIVATE_MARKER);
      expect(logs.join('')).not.toContain(PRIVATE_MARKER);
      expect(await prisma.cashSourceEvidence.findMany({ include: { review: true } })).toEqual(
        before,
      );
      expect(await prisma.auditLog.count()).toBe(audits);
      await removeAuditFailure();
      expect((await request()).statusCode).toBe(200);
      expect(await prisma.auditLog.count()).toBe(audits + 1);
    },
  );

  it('paginates transaction and source-ordered history without duplicate entries or foreign cursors', async () => {
    const s = await seed();
    const rows = [];
    for (let i = 0; i < 5; i++)
      rows.push(await imported(s, input({ sourceTransactionId: `page-${String(i)}` })));
    const page = await list(s, '?limit=2');
    expect(page.hasMore).toBe(true);
    const next = await list(s, `?limit=2&cursor=${encodeURIComponent(page.nextCursor!)}`);
    const last = await list(s, `?limit=2&cursor=${encodeURIComponent(next.nextCursor!)}`);
    expect(new Set([...page.items, ...next.items, ...last.items].map((item) => item.id)).size).toBe(
      5,
    );
    expect(last.hasMore).toBe(false);
    expect(next.accounts).toEqual(page.accounts);
    const other = await seed();
    expect(
      (
        await inject({
          method: 'GET',
          url: `${BASE}?cursor=${encodeURIComponent(page.nextCursor!)}`,
          headers: other.headers,
        })
      ).statusCode,
    ).toBe(400);
    const transaction = rows[0]!;
    for (const sequence of [3, 2, 5, 4])
      await imported(s, input({ sourceTransactionId: 'page-0', sourceSequence: sequence }));
    const historyPage = await history(s, transaction.transactionId, '?limit=2');
    const historyNext = await history(
      s,
      transaction.transactionId,
      `?limit=2&cursor=${encodeURIComponent(historyPage.nextCursor!)}`,
    );
    const historyLast = await history(
      s,
      transaction.transactionId,
      `?limit=2&cursor=${encodeURIComponent(historyNext.nextCursor!)}`,
    );
    expect(
      [...historyPage.items, ...historyNext.items, ...historyLast.items].map(
        (item) => item.payload.sourceSequence,
      ),
    ).toEqual([5, 4, 3, 2, 1]);
    expect(historyLast.hasMore).toBe(false);
    expect(
      (
        await inject({
          method: 'GET',
          url: `${BASE}/transactions/${rows[1]!.transactionId}?cursor=${encodeURIComponent(historyPage.nextCursor!)}`,
          headers: s.headers,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('returns full-account totals only for account tuples represented on the current transaction page', async () => {
    const s = await seed();
    await acceptInput(s, posted({ sourceAccountId: 'account-a', sourceTransactionId: 'a1' }));
    await acceptInput(
      s,
      posted({
        sourceAccountId: 'account-a',
        sourceTransactionId: 'a2',
        amount: '10.00',
        sourceAmount: '10.00',
      }),
    );
    await acceptInput(
      s,
      posted({
        sourceAccountId: 'account-b',
        sourceTransactionId: 'b1',
        amount: '20.00',
        sourceAmount: '20.00',
      }),
    );
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const page = await list(
        s,
        cursor ? `?limit=1&cursor=${encodeURIComponent(cursor)}` : '?limit=1',
      );
      expect(page.items).toHaveLength(1);
      const item = page.items[0]!;
      seen.add(item.id);
      expect(page.accounts).toHaveLength(1);
      const sourceAccountId = item.latestEvidence.payload.sourceAccountId;
      expect(page.accounts[0]).toMatchObject({
        sourceAccountId,
        postedNetAmount: sourceAccountId === 'account-a' ? '100.00' : '20.00',
        transactionCount: sourceAccountId === 'account-a' ? 2 : 1,
      });
      cursor = page.nextCursor;
    }
    expect(cursor).toBeNull();
    expect(seen.size).toBe(3);
  });

  it.each([
    '?limit=0',
    '?limit=101',
    '?limit=1.5',
    '?cursor=malformed',
    '?unknown=SYNTHETIC-PRIVATE-CASH-CONTENT',
  ])('rejects invalid pagination %s with a fixed safe response', async (suffix) => {
    const s = await seed();
    const response = await inject({
      method: 'GET',
      url: `${BASE}${suffix}`,
      headers: s.headers,
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(PRIVATE_MARKER);
  });

  it('rejects invalid signs/states/identity fields, caller verification, malformed JSON and oversized raw input without writes or payload logging', async () => {
    const s = await seed();
    const invalid: unknown[] = [
      { ...input(), evidenceBasis: 'PMS_DEPOSIT' },
      { ...input(), bankVerification: 'VERIFIED' },
      { ...input(), provenance: 'AUTHENTICATED_CONNECTOR' },
      { ...input(), claimId: 'not-an-allocation' },
      input({ amount: '100.00', sourceAmount: '-100.00' }),
      input({ amount: '-100.00', sourceAmount: '-100.00', sourceSignConvention: 'DEBIT_POSITIVE' }),
      input({ amount: '-0.00', sourceAmount: '-0.00' }),
      input({ amount: null }),
      posted({ amount: null, sourceAmount: null }),
      removed({ amount: '90.00', sourceAmount: '90.00' }),
      { ...input(), status: 'RETURNED' },
      input({ sourceSequence: 0 }),
      input({ sourceSequence: 1.5 }),
      input({ sourceSequence: 2_147_483_648 }),
      input({ pendingSourceTransactionId: 'synthetic-credit-a' }),
      input({ transactionDate: '2026-02-30' }),
      input({ sourceAccountId: ` ${PRIVATE_MARKER}` }),
      input({ sourceDescription: PRIVATE_MARKER.repeat(25) }),
      { ...input(), amount: PRIVATE_MARKER },
    ];
    for (const payload of invalid) {
      const response = await inject({
        method: 'POST',
        url: BASE,
        headers: { ...s.headers, 'content-type': 'application/json' },
        payload: JSON.stringify(payload),
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain(PRIVATE_MARKER);
    }
    const malformed = await inject({
      method: 'POST',
      url: BASE,
      headers: { ...s.headers, 'content-type': 'application/json' },
      payload: `{"sourceDescription":"${PRIVATE_MARKER}",`,
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain(PRIVATE_MARKER);
    const oversized = await inject({
      method: 'POST',
      url: BASE,
      headers: { ...s.headers, 'content-type': 'application/json' },
      payload: `${JSON.stringify(input())}${' '.repeat(64 * 1024)}`,
    });
    expect(oversized.statusCode).toBe(413);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('')).not.toContain(PRIVATE_MARKER);
    expect(await prisma.cashSourceTransaction.count()).toBe(0);
    expect(await prisma.cashSourceEvidence.count()).toBe(0);
  });

  it('exposes no mutation/delete endpoint for retained evidence and accepts no caller-controlled review result', async () => {
    const s = await seed();
    const row = await imported(s);
    for (const method of ['PATCH', 'DELETE'] as const)
      expect(
        (await inject({ method, url: `${BASE}/${row.id}`, headers: s.headers })).statusCode,
      ).toBe(404);
    const body = await reviewBody(s, row.id);
    for (const payload of [
      { ...body, approvedAmount: '1.00' },
      { ...body, reviewedByRole: 'OWNER' },
      { ...body, reviewToken: PRIVATE_MARKER },
      { ...body, idempotencyKey: PRIVATE_MARKER },
    ]) {
      const response = await inject({
        method: 'POST',
        url: `${BASE}/${row.id}/review`,
        headers: s.headers,
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain(PRIVATE_MARKER);
    }
    expect(await prisma.cashSourceEvidence.count()).toBe(1);
    expect(await prisma.cashSourceReview.count()).toBe(0);
    expect(logs.join('')).not.toContain(PRIVATE_MARKER);
  });
});

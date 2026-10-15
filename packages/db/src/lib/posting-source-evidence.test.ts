import { randomUUID } from 'node:crypto';

import {
  Prisma,
  type PostingSourceEvidence,
  type PostingSourceReceipt,
  type PostingSourceReview,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { prisma } from '../client.js';

import { MissingOrgScopeError } from './errors.js';
import { getOrgScopedDb } from './with-org.js';

type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
interface Entry extends Prisma.InputJsonObject {
  sourceEntryId: string;
  sourceClaimId: string | null;
  sourceLineId: string | null;
  sourceProcedureId: string | null;
  sourceVersion: string | null;
  sourceIsTransfer: boolean | null;
  entryKind: 'PAYMENT' | 'TRANSFER' | 'ADJUSTMENT' | 'UNKNOWN';
  sourceStatus: string | null;
  amount: string | null;
  sourceAmount: string | null;
  sourceSignConvention: 'CREDIT_POSITIVE' | 'DEBIT_POSITIVE';
}
interface Payload extends Prisma.InputJsonObject {
  sourceSystem: string;
  sourceProduct: string;
  sourceNamespace: string;
  sourceReceiptId: string;
  sourceRecordId: string;
  sourceSequence: number;
  sourceVersion: string | null;
  sourceDocumentId: string;
  status: 'POSTED' | 'PARTIAL' | 'REMOVED' | 'UNKNOWN';
  detailCompleteness: 'COMPLETE' | 'PARTIAL' | 'ABSENT';
  amount: string | null;
  sourceAmount: string | null;
  entries: Entry[];
}
interface Evidence {
  row: PostingSourceEvidence;
  receipt: PostingSourceReceipt;
  payload: Payload;
}
function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    sourceEntryId: randomUUID(),
    sourceClaimId: 'unlinked-claim',
    sourceLineId: null,
    sourceProcedureId: '000-procedure',
    sourceVersion: null,
    sourceIsTransfer: null,
    entryKind: 'PAYMENT',
    sourceStatus: 'Received',
    amount: '80.00',
    sourceAmount: '80.00',
    sourceSignConvention: 'CREDIT_POSITIVE',
    ...overrides,
  };
}
function payload(overrides: Partial<Payload> = {}): Payload {
  return {
    schemaVersion: 1,
    evidenceBasis: 'PMS_PAYMENT_RECEIPT',
    sourceSystem: 'OPEN_DENTAL',
    sourceProduct: 'Synthetic export',
    sourceNamespace: 'synthetic',
    sourceReceiptId: randomUUID(),
    sourceRecordId: randomUUID(),
    sourceSequence: 1,
    sourceVersion: null,
    sourceDocumentId: 'document',
    observedAt: '2026-01-02T12:00:00.000Z',
    status: 'POSTED',
    sourceStatus: null,
    sourceIsPartial: null,
    currency: 'USD',
    amount: '100.00',
    sourceAmount: '100.00',
    sourceSignConvention: 'CREDIT_POSITIVE',
    sourceEntryDate: '2026-01-02',
    sourceIssuedDate: '2026-01-01',
    paymentTrace: null,
    sourceDepositId: null,
    detailCompleteness: 'COMPLETE',
    entries: [entry()],
    ...overrides,
  };
}
async function fixture() {
  const org = await prisma.organization.create({
    data: { name: 'Synthetic PMS evidence', clerkOrgId: randomUUID() },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      clerkUserId: randomUUID(),
      email: 'synthetic@example.invalid',
      role: 'BILLING_STAFF',
    },
  });
  return { org, user };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function receiptData(f: Fixture, p: Payload): Prisma.PostingSourceReceiptUncheckedCreateInput {
  return {
    organizationId: f.org.id,
    sourceSystem: p.sourceSystem,
    sourceProduct: p.sourceProduct,
    sourceNamespace: p.sourceNamespace,
    sourceReceiptId: p.sourceReceiptId,
  };
}
function evidenceData(
  f: Fixture,
  receipt: PostingSourceReceipt,
  p: Payload,
): Prisma.PostingSourceEvidenceUncheckedCreateInput {
  return {
    organizationId: f.org.id,
    receiptId: receipt.id,
    sourceSystem: p.sourceSystem,
    sourceNamespace: p.sourceNamespace,
    sourceRecordId: p.sourceRecordId,
    sourceSequence: p.sourceSequence,
    sourceVersion: p.sourceVersion,
    sourceDocumentId: p.sourceDocumentId,
    status: p.status,
    detailCompleteness: p.detailCompleteness,
    amount: p.amount,
    payload: p,
    contentHash: 'a'.repeat(64),
  };
}
async function evidence(
  f: Fixture,
  p = payload(),
  overrides: Partial<Prisma.PostingSourceEvidenceUncheckedCreateInput> = {},
): Promise<Evidence> {
  return prisma.$transaction(async (tx) => {
    const receipt =
      (await tx.postingSourceReceipt.findFirst({
        where: {
          organizationId: f.org.id,
          sourceSystem: p.sourceSystem,
          sourceNamespace: p.sourceNamespace,
          sourceReceiptId: p.sourceReceiptId,
        },
      })) ?? (await tx.postingSourceReceipt.create({ data: receiptData(f, p) }));
    const row = await tx.postingSourceEvidence.create({
      data: { ...evidenceData(f, receipt, p), ...overrides },
    });
    return { row, receipt, payload: p };
  });
}
function revision(e: Evidence, overrides: Partial<Payload> = {}): Payload {
  return {
    ...e.payload,
    sourceRecordId: randomUUID(),
    sourceSequence: e.row.sourceSequence + 1,
    ...overrides,
  };
}
function entryData(
  f: Fixture,
  e: Evidence,
  review: PostingSourceReview,
  sourceIndex: number,
): Prisma.PostingSourceEntryUncheckedCreateInput {
  const item = e.payload.entries[sourceIndex];
  if (!item) throw new Error('missing source entry');
  return {
    ...item,
    organizationId: f.org.id,
    reviewId: review.id,
    receiptId: e.receipt.id,
    evidenceId: e.row.id,
    sourceIndex,
  };
}
async function createReview(
  tx: Db,
  f: Fixture,
  e: Evidence,
  overrides: Partial<Prisma.PostingSourceReviewUncheckedCreateInput> = {},
  beforeInsert?: () => Promise<void>,
  children = true,
  entryOverrides: Partial<Prisma.PostingSourceEntryUncheckedCreateInput> = {},
): Promise<PostingSourceReview> {
  const previous = await tx.postingSourceReview.findFirst({
    where: { organizationId: f.org.id, receiptId: e.receipt.id, decision: 'ACCEPT' },
    orderBy: { sourceSequence: 'desc' },
  });
  const evidenceCount = await tx.postingSourceEvidence.count({
    where: { organizationId: f.org.id },
  });
  const reviewCount = await tx.postingSourceReview.count({ where: { organizationId: f.org.id } });
  if (beforeInsert) await beforeInsert();
  const review = await tx.postingSourceReview.create({
    data: {
      organizationId: f.org.id,
      receiptId: e.receipt.id,
      evidenceId: e.row.id,
      decision: 'ACCEPT',
      reviewedByUserId: f.user.id,
      reviewedByRole: f.user.role,
      idempotencyKey: randomUUID(),
      requestHash: 'b'.repeat(64),
      reviewToken: 'c'.repeat(64),
      evidenceHash: e.row.contentHash,
      ledgerVersion: `${String(evidenceCount)}:${String(reviewCount)}`,
      previousAcceptedEvidenceId: previous?.evidenceId ?? null,
      sourceSequence: e.row.sourceSequence,
      ...overrides,
    },
  });
  if (children && review.decision === 'ACCEPT')
    for (let index = 0; index < e.payload.entries.length; index++) {
      await tx.postingSourceEntry.create({
        data: { ...entryData(f, e, review, index), ...entryOverrides },
      });
    }
  return review;
}
async function review(
  f: Fixture,
  e: Evidence,
  overrides: Partial<Prisma.PostingSourceReviewUncheckedCreateInput> = {},
) {
  return prisma.$transaction((tx) => createReview(tx, f, e, overrides));
}
async function conflict(f: Fixture, e: Evidence): Promise<boolean> {
  const result = await prisma.$queryRaw<
    { conflict: boolean }[]
  >`SELECT dentabill_posting_entry_conflict(${f.org.id},${e.row.id}::uuid) AS conflict`;
  return result[0]?.conflict ?? true;
}

describe('immutable independent PMS source receipts', () => {
  it('accepts a multiclaim source observation with unresolved references, signed details, mismatch and native flags without financial writes', async () => {
    const f = await fixture();
    const p = payload({
      status: 'PARTIAL',
      sourceIsPartial: true,
      sourceStatus: 'Native-custom',
      sourceDepositId: '000-deposit',
      entries: [
        entry({ sourceClaimId: 'claim-a', sourceVersion: 'opaque-z', sourceIsTransfer: false }),
        entry({
          sourceClaimId: 'claim-b',
          sourceProcedureId: '0',
          entryKind: 'TRANSFER',
          sourceIsTransfer: true,
          amount: '-20.00',
          sourceAmount: '20.00',
          sourceSignConvention: 'DEBIT_POSITIVE',
        }),
        entry({
          sourceClaimId: null,
          sourceLineId: 'unresolved-line',
          sourceProcedureId: null,
          entryKind: 'UNKNOWN',
          sourceStatus: 'Unrecognized',
          amount: null,
          sourceAmount: null,
        }),
      ],
    });
    const e = await evidence(f, p);
    const r = await review(f, e);
    const rows = await prisma.postingSourceEntry.findMany({
      where: { organizationId: f.org.id, reviewId: r.id },
      orderBy: { sourceIndex: 'asc' },
    });
    expect(rows.map((row) => [row.sourceClaimId, row.amount?.toFixed(2) ?? null])).toEqual([
      ['claim-a', '80.00'],
      ['claim-b', '-20.00'],
      [null, null],
    ]);
    expect(rows[0]?.sourceVersion).toBe('opaque-z');
    expect(rows[1]?.sourceIsTransfer).toBe(true);
    expect(e.row.payload).toEqual(p);
    for (const count of await Promise.all([
      prisma.claim.count(),
      prisma.claimRemittanceReview.count(),
      prisma.cashSourceEvidence.count(),
      prisma.remittanceBatchReview.count(),
      prisma.cashBatchMatch.count(),
    ]))
      expect(count).toBe(0);
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).updatedAt,
    ).toEqual(f.org.updatedAt);
  });

  it.each(['POSTED', 'PARTIAL', 'UNKNOWN'] as const)(
    'reviews %s with unknown header and known zero entry without fabricating amounts',
    async (status) => {
      const f = await fixture();
      const e = await evidence(
        f,
        payload({
          status,
          amount: null,
          sourceAmount: null,
          entries: [entry({ amount: '0.00', sourceAmount: '0.00' })],
        }),
      );
      await review(f, e);
      expect(e.row.amount).toBeNull();
      expect(await prisma.postingSourceEntry.count()).toBe(1);
    },
  );
  it('preserves nullable source dates and accepts negative header with mixed signed entries', async () => {
    const f = await fixture();
    const e = await evidence(
      f,
      payload({
        amount: '-30.00',
        sourceAmount: '30.00',
        sourceSignConvention: 'DEBIT_POSITIVE',
        sourceEntryDate: null,
        sourceIssuedDate: null,
        entries: [
          entry({ amount: '-80.00', sourceAmount: '-80.00' }),
          entry({ amount: '50.00', sourceAmount: '50.00' }),
        ],
      }),
    );
    await review(f, e);
    expect(e.row.amount?.toFixed(2)).toBe('-30.00');
  });
  it('seals every newly created receipt at transaction commit', async () => {
    const f = await fixture();
    await expect(
      prisma.postingSourceReceipt.create({ data: receiptData(f, payload()) }),
    ).rejects.toThrow();
    expect(await prisma.postingSourceReceipt.count()).toBe(0);
  });
  it('uses exact system/namespace receipt identity, preserves leading zero IDs, and seals product identity', async () => {
    const f = await fixture();
    const p = payload({ sourceReceiptId: '0001', sourceRecordId: '000-event' });
    const e = await evidence(f, p);
    await review(f, e);
    await evidence(f, payload({ sourceReceiptId: '1' }));
    await evidence(
      f,
      payload({ sourceReceiptId: '0001', sourceRecordId: '000-event', sourceSystem: 'OTHER_PMS' }),
    );
    await evidence(
      f,
      payload({ sourceReceiptId: '0001', sourceRecordId: '000-event', sourceNamespace: 'other' }),
    );
    await expect(evidence(f, payload({ sourceProduct: 'Changed product' }))).rejects.toThrow();
    expect(await prisma.postingSourceReceipt.count()).toBe(4);
  });
  it('rejects duplicate source events across receipt IDs and duplicate receipt sequences', async () => {
    const f = await fixture();
    const e = await evidence(f);
    await expect(evidence(f, payload({ sourceRecordId: e.row.sourceRecordId }))).rejects.toThrow();
    await expect(evidence(f, revision(e, { sourceSequence: 1 }))).rejects.toThrow();
    await expect(evidence(f, e.payload)).rejects.toThrow();
    expect(await prisma.postingSourceEvidence.count()).toBe(1);
  });

  it.each([
    ['unknown header key', { extra: true }],
    ['wrong basis', { evidenceBasis: 'BANK_ACCOUNT_TRANSACTION' }],
    ['wrong currency', { currency: 'EUR' }],
    ['bad sign', { sourceAmount: '-100.00' }],
    ['missing source amount', { sourceAmount: null }],
    ['null sign', { sourceSignConvention: null }],
    ['invalid sign', { sourceSignConvention: 'REDUCTION_POSITIVE' }],
    ['numeric amount', { amount: 100 }],
    ['noncanonical money', { amount: '0100.00', sourceAmount: '0100.00' }],
    ['negative zero', { amount: '-0.00', sourceAmount: '-0.00' }],
    ['missing amount', { amount: undefined }],
    ['numeric status', { sourceStatus: 2 }],
    ['string boolean', { sourceIsPartial: 'true' }],
    ['invalid date', { sourceEntryDate: '2026-02-30' }],
    ['zero year', { sourceIssuedDate: '0000-01-01' }],
    ['invalid timestamp', { observedAt: '2026-02-30T12:00:00Z' }],
    ['offset timestamp', { observedAt: '2026-01-02T12:00:00+01:00' }],
    ['absent detail with entries', { detailCompleteness: 'ABSENT' }],
    ['removed with amounts', { status: 'REMOVED', entries: [] }],
    ['removed with entries', { status: 'REMOVED', amount: null, sourceAmount: null }],
    ['100-entry bound', { entries: Array.from({ length: 101 }, () => entry()) }],
    ['format control token', { paymentTrace: 'a\u200bb' }],
    ['JS leading trim', { sourceVersion: '\u00a0version' }],
    ['astral UTF16 bound', { sourceDocumentId: '😀'.repeat(101) }],
    ['newline token', { sourceDepositId: 'a\nb' }],
  ])('rejects malformed direct DB payload: %s', async (_name, change) => {
    const f = await fixture();
    await expect(evidence(f, payload(change as Partial<Payload>))).rejects.toThrow();
    expect(await prisma.postingSourceEvidence.count()).toBe(0);
  });
  it.each([
    [
      'duplicate identity',
      () => {
        const item = entry();
        return [item, item];
      },
    ],
    ['unknown field', () => [entry({ hidden: 'value' })]],
    ['null kind', () => [entry({ entryKind: null } as unknown as Partial<Entry>)]],
    ['wrong entry sign', () => [entry({ sourceAmount: '-80.00' })]],
    [
      'unknown entry sign',
      () => [entry({ sourceSignConvention: 'unknown' } as unknown as Partial<Entry>)],
    ],
    [
      'invalid transfer boolean',
      () => [entry({ sourceIsTransfer: 'false' } as unknown as Partial<Entry>)],
    ],
    ['invalid source token', () => [entry({ sourceClaimId: ' bad' })]],
  ])('rejects malformed source entries: %s', async (_name, entries) => {
    const f = await fixture();
    await expect(evidence(f, payload({ entries: entries() }))).rejects.toThrow();
  });
  it('accepts exact 100-entry and UTF16 limits including internal noncontrol whitespace', async () => {
    const f = await fixture();
    const e = await evidence(
      f,
      payload({
        sourceSystem: '😀'.repeat(16),
        sourceDocumentId: '😀'.repeat(100),
        sourceVersion: 'inside\u00a0space',
        entries: Array.from({ length: 100 }, () => entry()),
      }),
    );
    await review(f, e);
    expect(await prisma.postingSourceEntry.count()).toBe(100);
  });
  it('rejects source/scalar mismatches through SQL admission', async () => {
    const f = await fixture();
    const e = await evidence(f);
    await expect(evidence(f, revision(e), { amount: '1.00' })).rejects.toThrow();
    await expect(evidence(f, revision(e), { sourceNamespace: 'other' })).rejects.toThrow();
    await expect(
      prisma.$executeRaw`INSERT INTO "PostingSourceEvidence" (id,"organizationId","receiptId","sourceSystem","sourceNamespace","sourceRecordId","sourceSequence","sourceDocumentId",status,"detailCompleteness",amount,payload,"contentHash") SELECT ${randomUUID()}::uuid,"organizationId","receiptId","sourceSystem","sourceNamespace",${randomUUID()},2,"sourceDocumentId",status,"detailCompleteness",amount,payload,"contentHash" FROM "PostingSourceEvidence" WHERE id=${e.row.id}::uuid`,
    ).rejects.toThrow();
  });

  it.each(['PARTIAL', 'ABSENT'] as const)(
    'retains omitted entry ownership across accepted %s details',
    async (detailCompleteness) => {
      const f = await fixture();
      const first = await evidence(f);
      await review(f, first);
      const later = await evidence(f, revision(first, { detailCompleteness, entries: [] }));
      await review(f, later);
      const other = await evidence(f, payload({ entries: first.payload.entries }));
      expect(await conflict(f, other)).toBe(true);
      await expect(review(f, other)).rejects.toThrow();
    },
  );
  it('unions every incomplete accepted snapshot after the most recent complete boundary', async () => {
    const f = await fixture();
    const first = await evidence(f, payload({ detailCompleteness: 'PARTIAL' }));
    await review(f, first);
    const second = await evidence(
      f,
      revision(first, { detailCompleteness: 'PARTIAL', entries: [entry()] }),
    );
    await review(f, second);
    const third = await evidence(
      f,
      revision(second, { detailCompleteness: 'ABSENT', entries: [] }),
    );
    await review(f, third);
    for (const previous of [first, second]) {
      const other = await evidence(f, payload({ entries: previous.payload.entries }));
      expect(await conflict(f, other)).toBe(true);
    }
  });
  it.each(['COMPLETE', 'REMOVED'] as const)(
    'releases omitted source entry identity only after accepted %s replacement',
    async (boundary) => {
      const f = await fixture();
      const first = await evidence(f);
      await review(f, first);
      const next = await evidence(
        f,
        revision(first, {
          entries: [],
          detailCompleteness: boundary === 'COMPLETE' ? 'COMPLETE' : 'ABSENT',
          ...(boundary === 'REMOVED'
            ? { status: 'REMOVED', amount: null, sourceAmount: null }
            : {}),
        }),
      );
      const other = await evidence(f, payload({ entries: first.payload.entries }));
      expect(await conflict(f, other)).toBe(true);
      await review(f, next);
      expect(await conflict(f, other)).toBe(false);
      await review(f, other);
      expect(await prisma.postingSourceEntry.count()).toBe(2);
    },
  );
  it('complete replacement drops older union while subsequent partial snapshots retain its new membership', async () => {
    const f = await fixture();
    const old = await evidence(f, payload({ detailCompleteness: 'PARTIAL' }));
    await review(f, old);
    const complete = await evidence(
      f,
      revision(old, { detailCompleteness: 'COMPLETE', entries: [entry()] }),
    );
    await review(f, complete);
    const absent = await evidence(
      f,
      revision(complete, { detailCompleteness: 'ABSENT', entries: [] }),
    );
    await review(f, absent);
    const freed = await evidence(f, payload({ entries: old.payload.entries }));
    await review(f, freed);
    const blocked = await evidence(f, payload({ entries: complete.payload.entries }));
    expect(await conflict(f, blocked)).toBe(true);
  });
  it('removal clears history and later incomplete reappearance starts fresh ownership', async () => {
    const f = await fixture();
    const old = await evidence(f);
    await review(f, old);
    const removed = await evidence(
      f,
      revision(old, {
        status: 'REMOVED',
        amount: null,
        sourceAmount: null,
        entries: [],
        detailCompleteness: 'ABSENT',
      }),
    );
    await review(f, removed);
    const next = await evidence(
      f,
      revision(removed, { status: 'UNKNOWN', detailCompleteness: 'PARTIAL', entries: [entry()] }),
    );
    await review(f, next);
    const freed = await evidence(f, payload({ entries: old.payload.entries }));
    await review(f, freed);
    const blocked = await evidence(f, payload({ entries: next.payload.entries }));
    expect(await conflict(f, blocked)).toBe(true);
  });
  it.each(['POSTED', 'PARTIAL', 'UNKNOWN'] as const)(
    'all nonremoved statuses fence entry IDs: %s',
    async (status) => {
      const f = await fixture();
      const a = await evidence(
        f,
        payload({ status, amount: null, sourceAmount: null, detailCompleteness: 'PARTIAL' }),
      );
      await review(f, a);
      const b = await evidence(f, payload({ entries: a.payload.entries }));
      await expect(review(f, b)).rejects.toThrow();
    },
  );
  it.each(['PAYMENT', 'TRANSFER', 'ADJUSTMENT', 'UNKNOWN'] as const)(
    'all entry kinds fence identity including null amounts: %s',
    async (entryKind) => {
      const f = await fixture();
      const a = await evidence(
        f,
        payload({ entries: [entry({ entryKind, amount: null, sourceAmount: null })] }),
      );
      await review(f, a);
      const b = await evidence(f, payload({ entries: a.payload.entries }));
      expect(await conflict(f, b)).toBe(true);
    },
  );
  it('newer rejected removal never releases an older accepted membership', async () => {
    const f = await fixture();
    const first = await evidence(f);
    await review(f, first);
    const removal = await evidence(
      f,
      revision(first, { status: 'REMOVED', amount: null, sourceAmount: null, entries: [] }),
    );
    await review(f, removal, { decision: 'REJECT' });
    const next = await evidence(f, payload({ entries: first.payload.entries }));
    await expect(review(f, next)).rejects.toThrow();
  });
  it('accepts entry identity in separate system, namespace and tenant scopes only', async () => {
    const f = await fixture();
    const e = await evidence(f);
    await review(f, e);
    for (const change of [{ sourceSystem: 'OTHER' }, { sourceNamespace: 'other' }]) {
      const next = await evidence(f, payload({ ...change, entries: e.payload.entries }));
      await review(f, next);
    }
    const g = await fixture();
    const other = await evidence(g, payload({ entries: e.payload.entries }));
    await review(g, other);
    expect(await conflict(g, e)).toBe(true);
  });
  it('fences same-transaction cross-receipt overlaps before child mirrors have been inserted', async () => {
    const f = await fixture();
    const a = await evidence(f);
    const b = await evidence(f, payload({ entries: a.payload.entries }));
    await expect(
      prisma.$transaction(async (tx) => {
        await createReview(tx, f, a, {}, undefined, false);
        await createReview(tx, f, b, {}, undefined, false);
      }),
    ).rejects.toThrow();
    expect(await prisma.postingSourceReview.count()).toBe(0);
  });

  it('orders source revisions by explicit sequence, permits rejecting old evidence, and never sorts opaque versions', async () => {
    const f = await fixture();
    const old = await evidence(f, payload({ sourceSequence: 10, sourceVersion: 'zzz' }));
    const latest = await evidence(f, revision(old, { sourceSequence: 20, sourceVersion: 'aaa' }));
    await expect(review(f, old)).rejects.toThrow();
    await review(f, old, { decision: 'REJECT' });
    await review(f, latest);
    const late = await evidence(f, revision(latest, { sourceSequence: 15 }));
    await expect(review(f, late)).rejects.toThrow();
    await review(f, late, { decision: 'REJECT' });
    expect(await prisma.postingSourceEntry.count()).toBe(1);
  });
  it('binds previous accepted evidence exactly and rejects stale organization ledgers', async () => {
    const f = await fixture();
    const a = await evidence(f);
    await review(f, a);
    const b = await evidence(f, revision(a));
    await expect(review(f, b, { previousAcceptedEvidenceId: null })).rejects.toThrow();
    await expect(review(f, b, { ledgerVersion: '1:1' })).rejects.toThrow();
    await review(f, b);
    expect(await prisma.postingSourceReview.count()).toBe(2);
  });
  it.each([
    { evidenceHash: 'd'.repeat(64) },
    { sourceSequence: 2 },
    { reviewedByRole: 'ADMIN' },
    { requestHash: 'x'.repeat(64) },
    { reviewToken: 'BAD' },
    { ledgerVersion: '1:0:0' },
  ] as Partial<Prisma.PostingSourceReviewUncheckedCreateInput>[])(
    'rejects changed review hash, sequence, actor role and ledger shape %j',
    async (change) => {
      const f = await fixture();
      const e = await evidence(f);
      await expect(review(f, e, change)).rejects.toThrow();
    },
  );
  it('accepts only authorized stored actor roles, never a forged elevated role', async () => {
    const f = await fixture();
    const e = await evidence(f);
    await prisma.user.update({
      where: { id: f.user.id, organizationId: f.org.id },
      data: { role: 'ADMIN' },
    });
    await expect(review(f, e)).rejects.toThrow();
    await review(f, e, { reviewedByRole: 'ADMIN' });
  });
  it('enforces one immutable review and per-organization idempotency keys', async () => {
    const f = await fixture();
    const e = await evidence(f);
    const r = await review(f, e);
    await expect(review(f, e)).rejects.toThrow();
    const other = await evidence(f);
    await expect(review(f, other, { idempotencyKey: r.idempotencyKey })).rejects.toThrow();
  });
  it('rejects cross-tenant parent, actor, review, previous evidence, and child bindings', async () => {
    const f = await fixture();
    const g = await fixture();
    const e = await evidence(f);
    const other = await evidence(g);
    await expect(evidence(f, revision(e), { receiptId: other.receipt.id })).rejects.toThrow();
    await expect(review(f, e, { reviewedByUserId: g.user.id })).rejects.toThrow();
    await expect(review(f, e, { evidenceId: other.row.id })).rejects.toThrow();
    await expect(review(f, e, { receiptId: other.receipt.id })).rejects.toThrow();
    await expect(review(f, e, { previousAcceptedEvidenceId: other.row.id })).rejects.toThrow();
    await expect(
      prisma.$transaction((tx) =>
        createReview(tx, f, e, {}, undefined, true, { organizationId: g.org.id }),
      ),
    ).rejects.toThrow();
  });
  it('enforces tenant-scoped reads and mandatory write organization', async () => {
    const f = await fixture();
    const g = await fixture();
    const e = await evidence(f);
    await review(f, e);
    const other = await evidence(g);
    await review(g, other);
    const scoped = getOrgScopedDb(f.org.id);
    expect(await scoped.postingSourceReceipt.count()).toBe(1);
    expect(await scoped.postingSourceEvidence.count()).toBe(1);
    expect(await scoped.postingSourceReview.count()).toBe(1);
    expect(await scoped.postingSourceEntry.count()).toBe(1);
    expect(
      await scoped.postingSourceEvidence.findFirst({
        where: { id: other.row.id, organizationId: g.org.id },
      }),
    ).toBeNull();
    await expect(
      prisma.postingSourceReceipt.create({
        data: {
          ...receiptData(f, payload()),
          organizationId: undefined,
        } as unknown as Prisma.PostingSourceReceiptUncheckedCreateInput,
      }),
    ).rejects.toBeInstanceOf(MissingOrgScopeError);
  });
  it('requires every accepted child at deferred commit and forbids rejected child creation', async () => {
    const f = await fixture();
    const e = await evidence(f);
    await expect(
      prisma.$transaction((tx) => createReview(tx, f, e, {}, undefined, false)),
    ).rejects.toThrow();
    const r = await review(f, e, { decision: 'REJECT' });
    await expect(
      prisma.postingSourceEntry.create({ data: entryData(f, e, r, 0) }),
    ).rejects.toThrow();
  });
  it.each([
    { sourceIndex: 1 },
    { sourceEntryId: 'different' },
    { sourceClaimId: 'different' },
    { sourceLineId: 'different' },
    { sourceProcedureId: 'different' },
    { sourceVersion: 'different' },
    { sourceIsTransfer: true },
    { sourceStatus: 'different' },
    { entryKind: 'TRANSFER' },
    { amount: '79.00', sourceAmount: '79.00' },
    { sourceSignConvention: 'DEBIT_POSITIVE', sourceAmount: '-80.00' },
  ])('enforces exact source child mirrors %j', async (change) => {
    const f = await fixture();
    const e = await evidence(f);
    await expect(
      prisma.$transaction((tx) => createReview(tx, f, e, {}, undefined, true, change)),
    ).rejects.toThrow();
    expect(await prisma.postingSourceReview.count()).toBe(0);
  });
  it('rejects wrong same-tenant child evidence and receipt bindings', async () => {
    const f = await fixture();
    const e = await evidence(f);
    const other = await evidence(f);
    for (const change of [{ evidenceId: other.row.id }, { receiptId: other.receipt.id }])
      await expect(
        prisma.$transaction((tx) => createReview(tx, f, e, {}, undefined, true, change)),
      ).rejects.toThrow();
  });
  it('makes receipts, evidence, reviews and entries immutable even through direct SQL', async () => {
    const f = await fixture();
    const e = await evidence(f);
    await review(f, e);
    for (const table of [
      'PostingSourceReceipt',
      'PostingSourceEvidence',
      'PostingSourceReview',
      'PostingSourceEntry',
    ]) {
      await expect(
        prisma.$executeRawUnsafe(`UPDATE "${table}" SET "organizationId"="organizationId"`),
      ).rejects.toThrow();
      await expect(prisma.$executeRawUnsafe(`DELETE FROM "${table}"`)).rejects.toThrow();
    }
    await expect(
      prisma.user.delete({ where: { id: f.user.id, organizationId: f.org.id } }),
    ).rejects.toThrow();
  });

  it.each([
    Prisma.TransactionIsolationLevel.ReadCommitted,
    Prisma.TransactionIsolationLevel.RepeatableRead,
  ])('serializes competing source entry ownership at %s', async (isolationLevel) => {
    const f = await fixture();
    const a = await evidence(f);
    const b = await evidence(f, payload({ entries: a.payload.entries }));
    let ready = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const barrier = async () => {
      ready++;
      if (ready === 2) release();
      await gate;
    };
    const results = await Promise.allSettled(
      [a, b].map((e) =>
        prisma.$transaction((tx) => createReview(tx, f, e, {}, barrier), { isolationLevel }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await prisma.postingSourceReview.count()).toBe(1);
    expect(await prisma.postingSourceEntry.count()).toBe(1);
    const winner = await prisma.postingSourceReview.findFirstOrThrow();
    const loser = winner.evidenceId === a.row.id ? b : a;
    await expect(review(f, loser)).rejects.toThrow();
  });
  it.each([
    Prisma.TransactionIsolationLevel.ReadCommitted,
    Prisma.TransactionIsolationLevel.RepeatableRead,
  ])(
    'rejects a source update that commits after a review preview at %s',
    async (isolationLevel) => {
      const f = await fixture();
      const e = await evidence(f);
      let observed!: () => void;
      let resume!: () => void;
      const previewed = new Promise<void>((resolve) => {
        observed = resolve;
      });
      const updated = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const pending = prisma.$transaction(
        (tx) =>
          createReview(tx, f, e, {}, async () => {
            observed();
            await updated;
          }),
        { isolationLevel },
      );
      const settled = Promise.allSettled([pending]);
      await previewed;
      await evidence(f, revision(e));
      resume();
      expect((await settled)[0].status).toBe('rejected');
      expect(await prisma.postingSourceReview.count()).toBe(0);
    },
  );
});

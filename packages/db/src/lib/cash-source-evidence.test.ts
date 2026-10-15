import { randomUUID } from 'node:crypto';

import {
  Prisma,
  type CashSourceEvidence,
  type CashSourceReview,
  type CashSourceTransaction,
  type Organization,
  type User,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { prisma } from '../client.js';

import { MissingOrgScopeError } from './errors.js';
import { getOrgScopedDb } from './with-org.js';

interface Payload extends Prisma.InputJsonObject {
  schemaVersion: number;
  evidenceBasis: string;
  sourceSystem: string;
  sourceProduct: string;
  sourceNamespace: string;
  sourceAccountId: string;
  sourceTransactionId: string;
  sourceRecordId: string;
  sourceSequence: number;
  sourceVersion: string | null;
  sourceDocumentId: string;
  observedAt: string;
  status: 'PENDING' | 'POSTED' | 'REMOVED' | 'UNKNOWN';
  currency: string;
  amount: string | null;
  sourceAmount: string | null;
  sourceSignConvention: 'CREDIT_POSITIVE' | 'DEBIT_POSITIVE';
  transactionDate: string | null;
  postingDate: string | null;
  counterpartyName: string | null;
  paymentTrace: string | null;
  sourceStatus: string | null;
  sourceDescription: string | null;
  pendingSourceTransactionId: string | null;
}
interface Fixture {
  org: Organization;
  user: User;
}
interface Evidence {
  row: CashSourceEvidence;
  transaction: CashSourceTransaction;
  payload: Payload;
}
type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
function payload(overrides: Partial<Payload> = {}): Payload {
  return {
    schemaVersion: 1,
    evidenceBasis: 'BANK_ACCOUNT_TRANSACTION',
    sourceSystem: 'Synthetic Bank',
    sourceProduct: 'Synthetic ordered export',
    sourceNamespace: 'synthetic-bank',
    sourceAccountId: '000-account',
    sourceTransactionId: randomUUID(),
    sourceRecordId: randomUUID(),
    sourceSequence: 1,
    sourceVersion: null,
    sourceDocumentId: 'synthetic-document',
    observedAt: '2026-01-02T12:00:00.000Z',
    status: 'POSTED',
    currency: 'USD',
    amount: '100.00',
    sourceAmount: '100.00',
    sourceSignConvention: 'CREDIT_POSITIVE',
    transactionDate: '2026-01-01',
    postingDate: '2026-01-02',
    counterpartyName: null,
    paymentTrace: null,
    sourceStatus: null,
    sourceDescription: null,
    pendingSourceTransactionId: null,
    ...overrides,
  };
}
async function fixture(): Promise<Fixture> {
  const org = await prisma.organization.create({
    data: { name: 'Synthetic bank evidence', clerkOrgId: `synthetic_${randomUUID()}` },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      clerkUserId: `synthetic_${randomUUID()}`,
      email: 'synthetic@example.invalid',
      role: 'BILLING_STAFF',
    },
  });
  return { org, user };
}
function transactionData(
  parent: Fixture,
  p: Payload,
): Prisma.CashSourceTransactionUncheckedCreateInput {
  return {
    organizationId: parent.org.id,
    sourceSystem: p.sourceSystem,
    sourceProduct: p.sourceProduct,
    sourceNamespace: p.sourceNamespace,
    sourceAccountId: p.sourceAccountId,
    sourceTransactionId: p.sourceTransactionId,
  };
}
function evidenceData(
  parent: Fixture,
  transaction: CashSourceTransaction,
  p: Payload,
): Prisma.CashSourceEvidenceUncheckedCreateInput {
  return {
    organizationId: parent.org.id,
    transactionId: transaction.id,
    sourceNamespace: p.sourceNamespace,
    sourceAccountId: p.sourceAccountId,
    sourceRecordId: p.sourceRecordId,
    sourceSequence: p.sourceSequence,
    sourceVersion: p.sourceVersion,
    sourceDocumentId: p.sourceDocumentId,
    status: p.status,
    amount: p.amount,
    payload: p,
    contentHash: 'a'.repeat(64),
  };
}
async function evidence(
  parent: Fixture,
  p = payload(),
  overrides: Partial<Prisma.CashSourceEvidenceUncheckedCreateInput> = {},
): Promise<Evidence> {
  return prisma.$transaction(async (tx) => {
    const data = transactionData(parent, p);
    const transaction =
      (await tx.cashSourceTransaction.findFirst({
        where: {
          organizationId: parent.org.id,
          sourceNamespace: p.sourceNamespace,
          sourceAccountId: p.sourceAccountId,
          sourceTransactionId: p.sourceTransactionId,
        },
      })) ?? (await tx.cashSourceTransaction.create({ data }));
    const row = await tx.cashSourceEvidence.create({
      data: { ...evidenceData(parent, transaction, p), ...overrides },
    });
    return { row, transaction, payload: p };
  });
}
function revision(e: Evidence, sourceSequence: number, overrides: Partial<Payload> = {}): Payload {
  return { ...e.payload, sourceSequence, sourceRecordId: randomUUID(), ...overrides };
}
async function createReview(
  tx: Db,
  parent: Fixture,
  e: Evidence,
  overrides: Partial<Prisma.CashSourceReviewUncheckedCreateInput> = {},
  beforeInsert?: () => Promise<void>,
): Promise<CashSourceReview> {
  const accepted = await tx.cashSourceReview.findFirst({
    where: { organizationId: parent.org.id, transactionId: e.transaction.id, decision: 'ACCEPT' },
    orderBy: { sourceSequence: 'desc' },
  });
  const evidenceCount = await tx.cashSourceEvidence.count({
    where: { organizationId: parent.org.id },
  });
  const reviewCount = await tx.cashSourceReview.count({ where: { organizationId: parent.org.id } });
  if (beforeInsert) await beforeInsert();
  return tx.cashSourceReview.create({
    data: {
      organizationId: parent.org.id,
      transactionId: e.transaction.id,
      evidenceId: e.row.id,
      decision: 'ACCEPT',
      reviewedByUserId: parent.user.id,
      reviewedByRole: parent.user.role,
      idempotencyKey: randomUUID(),
      requestHash: 'b'.repeat(64),
      reviewToken: 'c'.repeat(64),
      evidenceHash: e.row.contentHash,
      ledgerVersion: `${String(evidenceCount)}:${String(reviewCount)}`,
      previousAcceptedEvidenceId: accepted?.evidenceId ?? null,
      sourceSequence: e.row.sourceSequence,
      ...overrides,
    },
  });
}
async function review(
  parent: Fixture,
  e: Evidence,
  overrides: Partial<Prisma.CashSourceReviewUncheckedCreateInput> = {},
): Promise<CashSourceReview> {
  return prisma.$transaction((tx) => createReview(tx, parent, e, overrides));
}
async function blocker(parent: Fixture, e: Evidence): Promise<string | null> {
  const result = await prisma.$queryRaw<
    { blocker: string | null }[]
  >`SELECT dentabill_cash_link_blocker(${parent.org.id}, ${e.transaction.id}::uuid, ${e.payload.pendingSourceTransactionId}, ${e.payload.status}) AS blocker`;
  return result[0]?.blocker ?? null;
}
async function accepted(parent: Fixture, e: Evidence): Promise<CashSourceReview | null> {
  return prisma.cashSourceReview.findFirst({
    where: { organizationId: parent.org.id, transactionId: e.transaction.id, decision: 'ACCEPT' },
    orderBy: { sourceSequence: 'desc' },
  });
}

describe('immutable cash source evidence', () => {
  it.each([
    ['sourceSystem', 80],
    ['sourceProduct', 80],
    ['sourceAccountId', 200],
    ['sourceTransactionId', 200],
    ['sourceRecordId', 200],
    ['sourceVersion', 200],
    ['sourceDocumentId', 200],
    ['counterpartyName', 200],
    ['paymentTrace', 200],
    ['sourceStatus', 80],
    ['sourceDescription', 500],
    ['pendingSourceTransactionId', 200],
  ] as const)('enforces UTF-16 and Unicode token admission for %s', async (field, maximum) => {
    const parent = await fixture();
    const boundary = '𐐀'.repeat(maximum / 2);
    const p = payload({ [field]: boundary });
    const e = await evidence(parent, p);
    expect(e.payload[field]).toBe(boundary);
    for (const invalid of [boundary + 'a', `\u00a0x`, `x\u3000`, `x\u200by`, `x\u{e0001}y`]) {
      await expect(
        evidence(parent, payload({ sourceAccountId: randomUUID(), [field]: invalid })),
      ).rejects.toThrow();
    }
    expect(
      await prisma.cashSourceEvidence.count({ where: { organizationId: parent.org.id } }),
    ).toBe(1);
    expect(
      await prisma.cashSourceTransaction.count({ where: { organizationId: parent.org.id } }),
    ).toBe(1);
  });
  it('matches JS category and trim rules at all forbidden scalar values and their boundaries', async () => {
    const codepoints = new Set<number>([0x41, 0x301, 0x1f600, 0x10ffff]);
    for (let point = 1; point <= 0x10ffff; point += 1) {
      const character = String.fromCodePoint(point);
      if (/[\p{Cc}\p{Cf}]/u.test(character) || character.trim() !== character) {
        for (const neighbor of [point - 1, point, point + 1]) {
          if (neighbor > 0 && neighbor <= 0x10ffff && !(neighbor >= 0xd800 && neighbor <= 0xdfff))
            codepoints.add(neighbor);
        }
      }
    }
    const tokens = [...codepoints].flatMap((point) => {
      const character = String.fromCodePoint(point);
      return [character, `${character}x`, `x${character}`, `x${character}y`];
    });
    tokens.push('', '𐐀'.repeat(39) + 'ab', '𐐀'.repeat(40) + 'a');
    const cases = tokens.map((value) => ({
      value,
      valid:
        value.length > 0 &&
        value.length <= 80 &&
        value.trim() === value &&
        !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value),
    }));
    const mismatches = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value FROM jsonb_to_recordset(${JSON.stringify(cases)}::jsonb) AS cases(value TEXT, valid BOOLEAN)
      WHERE dentabill_cash_token_valid(value,80) IS DISTINCT FROM valid`;
    expect(mismatches).toEqual([]);
  });
  it('rejects empty, nonstring, missing, NUL and unpaired-surrogate tokens through direct SQL', async () => {
    const parent = await fixture();
    const e = await evidence(parent);
    for (const malformed of ['', 42, {}, ['token'], '\u0000', '\ud800', '\udfff', undefined]) {
      const p = { ...revision(e, 2), sourceDescription: malformed };
      await expect(prisma.$executeRaw`
        INSERT INTO "CashSourceEvidence" (id,"organizationId","transactionId","sourceNamespace","sourceAccountId",
          "sourceRecordId","sourceSequence","sourceVersion","sourceDocumentId",status,amount,payload,"contentHash")
        VALUES (${randomUUID()}::uuid,${parent.org.id},${e.transaction.id}::uuid,${p.sourceNamespace},${p.sourceAccountId},
          ${p.sourceRecordId},2,NULL,${p.sourceDocumentId},${p.status},100,${JSON.stringify(p)}::jsonb,${'a'.repeat(64)})
      `).rejects.toThrow();
    }
    expect(
      await prisma.cashSourceEvidence.count({ where: { organizationId: parent.org.id } }),
    ).toBe(1);
  });
  it('admits sealed source identity and signed source observations without creating claims or financial settlement', async () => {
    const parent = await fixture();
    const before = parent.org;
    const e = await evidence(
      parent,
      payload({
        sourceSignConvention: 'DEBIT_POSITIVE',
        sourceAmount: '125.00',
        amount: '-125.00',
        sourceVersion: '000-revision-Z',
      }),
    );
    const r = await review(parent, e);
    expect(e.row.amount?.toFixed(2)).toBe('-125.00');
    expect(r.reviewedByRole).toBe('BILLING_STAFF');
    expect(r.previousAcceptedEvidenceId).toBeNull();
    expect(r.sourceSequence).toBe(1);
    expect(await prisma.organization.findUnique({ where: { id: parent.org.id } })).toEqual(before);
    expect(await prisma.claim.count({ where: { organizationId: parent.org.id } })).toBe(0);
    expect(
      await prisma.claimRemittanceEvidence.count({ where: { organizationId: parent.org.id } }),
    ).toBe(0);
  });
  it('requires at least one evidence row at commit and rolls back an empty source transaction', async () => {
    const parent = await fixture();
    let inserted = false;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.cashSourceTransaction.create({ data: transactionData(parent, payload()) });
        inserted = true;
      }),
    ).rejects.toThrow();
    expect(inserted).toBe(true);
    expect(
      await prisma.cashSourceTransaction.count({ where: { organizationId: parent.org.id } }),
    ).toBe(0);
  });
  it('preserves exact source identity case/leading zeros and rejects duplicate events or sequence collisions', async () => {
    const parent = await fixture();
    const e = await evidence(
      parent,
      payload({ sourceTransactionId: '000-Ab', sourceRecordId: '000-event' }),
    );
    await expect(evidence(parent, e.payload)).rejects.toThrow();
    await expect(evidence(parent, revision(e, 1))).rejects.toThrow();
    await expect(evidence(parent, payload({ sourceRecordId: '000-event' }))).rejects.toThrow();
    await evidence(
      parent,
      payload({
        sourceTransactionId: '000-ab',
        sourceRecordId: '000-event',
        sourceAccountId: 'other-account',
      }),
    );
    await evidence(
      parent,
      payload({
        sourceTransactionId: '000-ab',
        sourceRecordId: '000-event',
        sourceNamespace: 'other-namespace',
      }),
    );
  });
  it.each(['sourceSystem', 'sourceProduct'] as const)(
    'forbids changing %s within a namespace/account even on a different transaction',
    async (field) => {
      const parent = await fixture();
      await evidence(parent);
      await expect(evidence(parent, payload({ [field]: 'different' }))).rejects.toThrow();
      await evidence(parent, payload({ [field]: 'different', sourceAccountId: 'other-account' }));
    },
  );
  it('orders revisions by explicit sequence, rejects accepting historical evidence, and permits historical rejection', async () => {
    const parent = await fixture();
    const latest = await evidence(parent, payload({ sourceSequence: 30, sourceVersion: 'a' }));
    const old = await evidence(
      parent,
      revision(latest, 1, { sourceVersion: 'zzz', observedAt: '2027-01-01T00:00:00Z' }),
    );
    await expect(review(parent, old)).rejects.toThrow();
    await review(parent, latest);
    const rejected = await review(parent, old, { decision: 'REJECT' });
    expect(rejected.previousAcceptedEvidenceId).toBe(latest.row.id);
    expect((await accepted(parent, latest))?.evidenceId).toBe(latest.row.id);
  });
  it('keeps accepted history when a newer source observation is rejected and records current prior accepted binding', async () => {
    const parent = await fixture();
    const first = await evidence(parent);
    await review(parent, first);
    const next = await evidence(
      parent,
      revision(first, 2, { amount: '120.00', sourceAmount: '120.00' }),
    );
    await expect(review(parent, next, { previousAcceptedEvidenceId: null })).rejects.toThrow();
    const rejected = await review(parent, next, { decision: 'REJECT' });
    expect(rejected.previousAcceptedEvidenceId).toBe(first.row.id);
    expect((await accepted(parent, first))?.evidenceId).toBe(first.row.id);
  });
  it('stores removal as null source amounts and a separate debit as another transaction', async () => {
    const parent = await fixture();
    const first = await evidence(parent);
    await review(parent, first);
    const removed = await evidence(
      parent,
      revision(first, 2, { status: 'REMOVED', amount: null, sourceAmount: null }),
    );
    await review(parent, removed);
    expect((await accepted(parent, first))?.evidenceId).toBe(removed.row.id);
    expect(removed.row.amount).toBeNull();
    expect(first.row.amount?.toFixed(2)).toBe('100.00');
    const debit = await evidence(parent, payload({ amount: '-100.00', sourceAmount: '-100.00' }));
    await review(parent, debit);
    expect(debit.transaction.id).not.toBe(first.transaction.id);
  });
  it.each([
    { schemaVersion: 2 },
    { evidenceBasis: 'PMS_DEPOSIT' },
    { currency: 'EUR' },
    { extra: 'unrecognized' },
    { sourceSequence: '1' },
    { sourceSequence: 0 },
    { sourceSignConvention: 'UNKNOWN' },
    { amount: '100.001' },
    { amount: '-0.00', sourceAmount: '-0.00' },
    { sourceAmount: '99.99' },
    { sourceAmount: null },
    { amount: null, sourceAmount: null },
    { sourceStatus: 'synthetic\ncontrol' },
    { sourceDescription: 'x'.repeat(501) },
    { transactionDate: '2026-02-30' },
    { postingDate: '0000-01-01' },
    { observedAt: '0000-01-01T00:00:00Z' },
    { observedAt: '2026-02-30T00:00:00Z' },
    { observedAt: '2026-01-01T24:00:00Z' },
    {
      observedAt:
        '2026-01-01T00:00:00.123456789012345678901234567890123456789012345678901234567890Z',
    },
  ])(
    'rejects noncanonical source payload %j without persisting a transaction shell',
    async (invalid) => {
      const parent = await fixture();
      const p = payload();
      await expect(evidence(parent, p, { payload: { ...p, ...invalid } })).rejects.toThrow();
      expect(
        await prisma.cashSourceTransaction.count({ where: { organizationId: parent.org.id } }),
      ).toBe(0);
    },
  );
  it.each([
    { sourceNamespace: 'different' },
    { sourceAccountId: 'different' },
    { sourceRecordId: 'different' },
    { sourceDocumentId: 'different' },
    { sourceVersion: 'different' },
    { sourceSequence: 2 },
    { status: 'UNKNOWN' },
    { amount: '99.99' },
    { amount: 'NaN' },
    { contentHash: 'invalid' },
  ] satisfies Partial<Prisma.CashSourceEvidenceUncheckedCreateInput>[])(
    'rejects column/payload identity mismatch %j',
    async (overrides) => {
      const parent = await fixture();
      await expect(evidence(parent, payload(), overrides)).rejects.toThrow();
    },
  );
  it('accepts nullable unknown/pending amounts but forbids removed known amounts or self replacement links', async () => {
    const parent = await fixture();
    for (const status of ['PENDING', 'UNKNOWN'] as const)
      await evidence(parent, payload({ status, amount: null, sourceAmount: null }));
    await expect(evidence(parent, payload({ status: 'REMOVED' }))).rejects.toThrow();
    const p = payload();
    await expect(
      evidence(parent, { ...p, pendingSourceTransactionId: p.sourceTransactionId }),
    ).rejects.toThrow();
  });
  it.each([
    { sourceSequence: 2 },
    { evidenceHash: 'd'.repeat(64) },
    { ledgerVersion: '0:0' },
    { reviewedByRole: 'OWNER' },
    { requestHash: 'bad' },
    { reviewToken: 'bad' },
  ] satisfies Partial<Prisma.CashSourceReviewUncheckedCreateInput>[])(
    'rejects forged review snapshots %j',
    async (overrides) => {
      const parent = await fixture();
      const e = await evidence(parent);
      await expect(review(parent, e, overrides)).rejects.toThrow();
    },
  );
  it('binds ledger freshness organization-wide and prohibits duplicate evidence review/idempotency reuse', async () => {
    const parent = await fixture();
    const first = await evidence(parent);
    const second = await evidence(parent);
    await expect(review(parent, first, { ledgerVersion: '1:0' })).rejects.toThrow();
    const r = await review(parent, first);
    await expect(review(parent, first)).rejects.toThrow();
    await expect(review(parent, second, { idempotencyKey: r.idempotencyKey })).rejects.toThrow();
    const other = await fixture();
    await review(other, await evidence(other), { idempotencyKey: r.idempotencyKey });
  });
  it('enforces scoped transaction, evidence, previous-accepted, and actor references', async () => {
    const parent = await fixture();
    const other = await fixture();
    const e = await evidence(parent);
    const foreign = await evidence(other);
    await review(other, foreign);
    await expect(
      evidence(parent, revision(e, 2), { transactionId: foreign.transaction.id }),
    ).rejects.toThrow();
    await expect(review(parent, e, { evidenceId: foreign.row.id })).rejects.toThrow();
    await expect(review(parent, e, { transactionId: foreign.transaction.id })).rejects.toThrow();
    await expect(
      review(parent, e, { previousAcceptedEvidenceId: foreign.row.id }),
    ).rejects.toThrow();
    await expect(review(parent, e, { reviewedByUserId: other.user.id })).rejects.toThrow();
  });
  it('retains all identities, source revisions, decisions and actor records against updates/deletes', async () => {
    const parent = await fixture();
    const e = await evidence(parent);
    await review(parent, e);
    const where = { organizationId: parent.org.id };
    await expect(
      prisma.cashSourceTransaction.updateMany({
        where,
        data: { sourceTransactionId: 'different' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.cashSourceEvidence.updateMany({ where, data: { amount: '1.00' } }),
    ).rejects.toThrow();
    await expect(
      prisma.cashSourceReview.updateMany({ where, data: { decision: 'REJECT' } }),
    ).rejects.toThrow();
    await expect(prisma.cashSourceTransaction.deleteMany({ where })).rejects.toThrow();
    await expect(prisma.cashSourceEvidence.deleteMany({ where })).rejects.toThrow();
    await expect(prisma.cashSourceReview.deleteMany({ where })).rejects.toThrow();
    await expect(prisma.organization.delete({ where: { id: parent.org.id } })).rejects.toThrow();
    await expect(
      prisma.user.delete({ where: { id: parent.user.id, organizationId: parent.org.id } }),
    ).rejects.toThrow();
  });
  it('rejects parent/sibling overlap and keeps stale posted acceptance fenced until removal is reviewed', async () => {
    const parent = await fixture();
    const first = await evidence(
      parent,
      payload({ sourceTransactionId: 'posted-A', pendingSourceTransactionId: 'pending-X' }),
    );
    await review(parent, first);
    const second = await evidence(
      parent,
      payload({ sourceTransactionId: 'posted-B', pendingSourceTransactionId: 'pending-X' }),
    );
    expect(await blocker(parent, second)).toBe('POSTED_REPLACEMENT_OVERLAP');
    await expect(review(parent, second)).rejects.toThrow();
    const removed = await evidence(
      parent,
      revision(first, 2, {
        status: 'REMOVED',
        amount: null,
        sourceAmount: null,
        pendingSourceTransactionId: null,
      }),
    );
    expect(await blocker(parent, second)).toBe('POSTED_REPLACEMENT_OVERLAP');
    await review(parent, removed);
    expect(await blocker(parent, second)).toBeNull();
    await review(parent, second);
  });
  it('retains prior accepted nonnull links through null revisions and rejects later identity changes', async () => {
    const parent = await fixture();
    const e = await evidence(
      parent,
      payload({ status: 'PENDING', pendingSourceTransactionId: 'original-link' }),
    );
    await review(parent, e);
    const unknown = await evidence(
      parent,
      revision(e, 2, { status: 'UNKNOWN', pendingSourceTransactionId: null }),
    );
    await review(parent, unknown);
    const changed = await evidence(
      parent,
      revision(e, 3, { pendingSourceTransactionId: 'different-link' }),
    );
    expect(await blocker(parent, changed)).toBe('PENDING_LINK_CHANGED');
    await expect(review(parent, changed)).rejects.toThrow();
    await review(parent, changed, { decision: 'REJECT' });
  });
  it('blocks a nonposted late bridge that joins two currently posted components', async () => {
    const parent = await fixture();
    const a = await evidence(parent, payload({ sourceTransactionId: 'A' }));
    await review(parent, a);
    const b = await evidence(
      parent,
      payload({ sourceTransactionId: 'B', pendingSourceTransactionId: 'C' }),
    );
    await review(parent, b);
    const c = await evidence(
      parent,
      payload({ sourceTransactionId: 'C', status: 'PENDING', pendingSourceTransactionId: 'A' }),
    );
    expect(await blocker(parent, c)).toBe('POSTED_REPLACEMENT_OVERLAP');
    await expect(review(parent, c)).rejects.toThrow();
    await review(parent, c, { decision: 'REJECT' });
  });
  it('traverses chains/cycles without dropping historical edges or counting the candidate twice', async () => {
    const parent = await fixture();
    const a = await evidence(
      parent,
      payload({ sourceTransactionId: 'A', status: 'PENDING', pendingSourceTransactionId: 'B' }),
    );
    await review(parent, a);
    const b = await evidence(
      parent,
      payload({ sourceTransactionId: 'B', status: 'PENDING', pendingSourceTransactionId: 'C' }),
    );
    await review(parent, b);
    const c = await evidence(
      parent,
      payload({ sourceTransactionId: 'C', status: 'PENDING', pendingSourceTransactionId: 'A' }),
    );
    await review(parent, c);
    const posted = await evidence(
      parent,
      revision(a, 2, { status: 'POSTED', pendingSourceTransactionId: null }),
    );
    await review(parent, posted);
    const change = await evidence(
      parent,
      revision(posted, 3, { amount: '125.00', sourceAmount: '125.00' }),
    );
    expect(await blocker(parent, change)).toBeNull();
    await review(parent, change);
    const overlap = await evidence(
      parent,
      revision(c, 2, { status: 'POSTED', pendingSourceTransactionId: null }),
    );
    expect(await blocker(parent, overlap)).toBe('POSTED_REPLACEMENT_OVERLAP');
    await expect(review(parent, overlap)).rejects.toThrow();
  });
  it('does not connect identical source IDs across accounts, namespaces, or organizations', async () => {
    const parent = await fixture();
    const original = payload({ sourceTransactionId: 'A', pendingSourceTransactionId: 'root' });
    await review(parent, await evidence(parent, original));
    for (const override of [
      { sourceAccountId: 'other-account' },
      { sourceNamespace: 'other-namespace' },
    ]) {
      const e = await evidence(
        parent,
        payload({ ...override, sourceTransactionId: 'B', pendingSourceTransactionId: 'root' }),
      );
      expect(await blocker(parent, e)).toBeNull();
      await review(parent, e);
    }
    const other = await fixture();
    const e = await evidence(
      other,
      payload({ sourceTransactionId: 'B', pendingSourceTransactionId: 'root' }),
    );
    expect(await blocker(other, e)).toBeNull();
    await review(other, e);
  });
  it('returns a closed blocker when the known component exceeds100 source IDs, retaining rejection access', async () => {
    const parent = await fixture();
    for (let index = 0; index < 99; index += 1) {
      const e = await evidence(
        parent,
        payload({
          sourceTransactionId: `node-${String(index)}`,
          status: 'PENDING',
          pendingSourceTransactionId: 'unknown-root',
        }),
      );
      await review(parent, e);
    }
    const oversized = await evidence(
      parent,
      payload({
        sourceTransactionId: 'node-100',
        status: 'PENDING',
        pendingSourceTransactionId: 'unknown-root',
      }),
    );
    expect(await blocker(parent, oversized)).toBe('SOURCE_LINK_LIMIT');
    await expect(review(parent, oversized)).rejects.toThrow();
    await review(parent, oversized, { decision: 'REJECT' });
  }, 60_000);
  it.each([
    Prisma.TransactionIsolationLevel.ReadCommitted,
    Prisma.TransactionIsolationLevel.RepeatableRead,
  ])(
    'serializes concurrent posted siblings under %s without double admission',
    async (isolationLevel) => {
      const parent = await fixture();
      const first = await evidence(
        parent,
        payload({ sourceTransactionId: 'A', pendingSourceTransactionId: 'root' }),
      );
      const second = await evidence(
        parent,
        payload({ sourceTransactionId: 'B', pendingSourceTransactionId: 'root' }),
      );
      let ready = 0;
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const barrier = async (): Promise<void> => {
        ready += 1;
        if (ready === 2) release?.();
        await gate;
      };
      const results = await Promise.allSettled(
        [first, second].map((e) =>
          prisma.$transaction((tx) => createReview(tx, parent, e, {}, barrier), {
            isolationLevel,
            timeout: 10_000,
          }),
        ),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const unreviewed = await prisma.cashSourceEvidence.findFirstOrThrow({
        where: { organizationId: parent.org.id, review: null },
      });
      const retry = unreviewed.id === first.row.id ? first : second;
      expect(await blocker(parent, retry)).toBe('POSTED_REPLACEMENT_OVERLAP');
      await expect(review(parent, retry)).rejects.toThrow();
      expect(
        await prisma.cashSourceReview.count({ where: { organizationId: parent.org.id } }),
      ).toBe(1);
      expect(
        (await prisma.organization.findUniqueOrThrow({ where: { id: parent.org.id } })).updatedAt,
      ).toEqual(parent.org.updatedAt);
    },
  );
  it.each([
    Prisma.TransactionIsolationLevel.ReadCommitted,
    Prisma.TransactionIsolationLevel.RepeatableRead,
  ])('serializes conflicting account product admissions under %s', async (isolationLevel) => {
    const parent = await fixture();
    let ready = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const results = await Promise.allSettled(
      ['product-A', 'product-B'].map((sourceProduct) =>
        prisma.$transaction(
          async (tx) => {
            await tx.cashSourceTransaction.count({ where: { organizationId: parent.org.id } });
            ready += 1;
            if (ready === 2) release?.();
            await gate;
            const p = payload({ sourceProduct });
            const transaction = await tx.cashSourceTransaction.create({
              data: transactionData(parent, p),
            });
            await tx.cashSourceEvidence.create({ data: evidenceData(parent, transaction, p) });
          },
          { isolationLevel, timeout: 10_000 },
        ),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      await prisma.cashSourceTransaction.count({ where: { organizationId: parent.org.id } }),
    ).toBe(1);
  });
  it('scopes all three delegates for reads and rejects mutations without organization scope', async () => {
    const parent = await fixture();
    const other = await fixture();
    const e = await evidence(parent);
    await review(parent, e);
    await review(other, await evidence(other));
    const db = getOrgScopedDb(parent.org.id);
    expect(await db.cashSourceTransaction.count()).toBe(1);
    expect(await db.cashSourceEvidence.count()).toBe(1);
    expect(await db.cashSourceReview.count()).toBe(1);
    expect(
      await db.cashSourceTransaction.findFirst({ where: { organizationId: other.org.id } }),
    ).toMatchObject({ organizationId: parent.org.id });
    expect(
      (await db.cashSourceEvidence.findMany()).every(
        (item) => item.organizationId === parent.org.id,
      ),
    ).toBe(true);
    expect((await db.cashSourceEvidence.aggregate({ _count: true }))._count).toBe(1);
    expect(await db.cashSourceReview.groupBy({ by: ['organizationId'], _count: true })).toEqual([
      { organizationId: parent.org.id, _count: 1 },
    ]);
    await expect(
      prisma.cashSourceTransaction.deleteMany({ where: { id: e.transaction.id } }),
    ).rejects.toThrow(MissingOrgScopeError);
    await expect(
      prisma.cashSourceEvidence.deleteMany({ where: { transactionId: e.transaction.id } }),
    ).rejects.toThrow(MissingOrgScopeError);
    await expect(
      prisma.cashSourceReview.deleteMany({ where: { transactionId: e.transaction.id } }),
    ).rejects.toThrow(MissingOrgScopeError);
  });
});

import { randomUUID } from 'node:crypto';

import {
  Prisma,
  type CashBatchMatch,
  type ClaimRemittanceEvidence,
  type ClaimRemittanceReview,
  type CashBatchRelease,
  type CashSourceEvidence,
  type CashSourceReview,
  type CashSourceTransaction,
  type RemittanceBatchEvidence,
  type RemittanceBatchReview,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { prisma } from '../client.js';

import { MissingOrgScopeError } from './errors.js';
import { getOrgScopedDb } from './with-org.js';

type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
async function fixture() {
  const org = await prisma.organization.create({
    data: { name: 'Synthetic reconciliation', clerkOrgId: randomUUID() },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      clerkUserId: randomUUID(),
      email: 'synthetic@example.invalid',
      role: 'BILLING_STAFF',
    },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      claimNumber: 'synthetic',
      patientDOBHash: 'synthetic',
      claimAmount: '200.00',
      payerCode: 'UNKNOWN',
      serviceDate: new Date('2026-01-01'),
    },
  });
  return { org, user, claim };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
interface CashPayload extends Prisma.InputJsonObject {
  sourceSystem: string;
  sourceProduct: string;
  sourceNamespace: string;
  sourceAccountId: string;
  sourceTransactionId: string;
  sourceRecordId: string;
  sourceSequence: number;
  sourceVersion: string | null;
  sourceDocumentId: string;
  status: 'PENDING' | 'POSTED' | 'REMOVED' | 'UNKNOWN';
  amount: string | null;
  sourceAmount: string | null;
  pendingSourceTransactionId: string | null;
}
interface Cash {
  transaction: CashSourceTransaction;
  row: CashSourceEvidence;
  review: CashSourceReview | null;
  payload: CashPayload;
}
interface Batch {
  row: RemittanceBatchEvidence;
  review: RemittanceBatchReview | null;
}
interface ComponentNode {
  transaction_id: string | null;
  source_id: string | null;
  overflow: boolean;
}
function cashPayload(overrides: Partial<CashPayload> = {}): CashPayload {
  return {
    schemaVersion: 1,
    evidenceBasis: 'BANK_ACCOUNT_TRANSACTION',
    sourceSystem: 'Synthetic Bank',
    sourceProduct: 'Synthetic Export',
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
async function cash(
  f: Fixture,
  overrides: Partial<CashPayload> = {},
  previous?: Cash,
  decision: 'ACCEPT' | 'REJECT' | null = 'ACCEPT',
  tx?: Db,
): Promise<Cash> {
  const p = cashPayload({
    ...(previous
      ? {
          ...previous.payload,
          sourceSequence: previous.row.sourceSequence + 1,
          sourceRecordId: randomUUID(),
        }
      : {}),
    ...overrides,
  });
  const save = async (db: Db): Promise<Cash> => {
    const transaction =
      previous?.transaction ??
      (await db.cashSourceTransaction.create({
        data: {
          organizationId: f.org.id,
          sourceSystem: p.sourceSystem,
          sourceProduct: p.sourceProduct,
          sourceNamespace: p.sourceNamespace,
          sourceAccountId: p.sourceAccountId,
          sourceTransactionId: p.sourceTransactionId,
        },
      }));
    const row = await db.cashSourceEvidence.create({
      data: {
        organizationId: f.org.id,
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
      },
    });
    const accepted = await db.cashSourceReview.findFirst({
      where: { organizationId: f.org.id, transactionId: transaction.id, decision: 'ACCEPT' },
      orderBy: { sourceSequence: 'desc' },
    });
    const evidenceCount = await db.cashSourceEvidence.count({
      where: { organizationId: f.org.id },
    });
    const reviewCount = await db.cashSourceReview.count({ where: { organizationId: f.org.id } });
    const review =
      decision === null
        ? null
        : await db.cashSourceReview.create({
            data: {
              organizationId: f.org.id,
              transactionId: transaction.id,
              evidenceId: row.id,
              decision,
              reviewedByUserId: f.user.id,
              reviewedByRole: f.user.role,
              idempotencyKey: randomUUID(),
              requestHash: 'b'.repeat(64),
              reviewToken: 'c'.repeat(64),
              evidenceHash: row.contentHash,
              ledgerVersion: `${String(evidenceCount)}:${String(reviewCount)}`,
              previousAcceptedEvidenceId: accepted?.evidenceId ?? null,
              sourceSequence: p.sourceSequence,
            },
          });
    return { transaction, row, review, payload: p };
  };
  return tx ? save(tx) : prisma.$transaction(save);
}
async function claimRemittance(
  f: Fixture,
  amount: string,
): Promise<{ row: ClaimRemittanceEvidence; review: ClaimRemittanceReview }> {
  const reversed = amount.startsWith('-') ? await claimRemittance(f, '100.00') : null;
  const p = {
    schemaVersion: 1,
    sourceNamespace: 'synthetic-payer',
    sourceRecordId: randomUUID(),
    sourceDocumentId: 'document-1',
    sourceVersion: null,
    kind: reversed ? 'REVERSAL' : 'PAYMENT',
    reversesSourceRecordId: reversed?.row.sourceRecordId ?? null,
    currency: 'USD',
    reportedAmount: amount,
    payerName: 'Synthetic payer',
    payerIdentifier: null,
    payerIdentifierSystem: null,
    payerClaimControlNumber: null,
    sourceCoverageId: null,
    paymentTrace: null,
    paymentTraceType: null,
    paymentTraceIssuer: null,
    reportedDate: null,
    sourceStatus: null,
    lineDetailCompleteness: 'ABSENT',
    allocations: [],
    adjustments: [],
  };
  const row = await prisma.claimRemittanceEvidence.create({
    data: {
      organizationId: f.org.id,
      claimId: f.claim.id,
      sourceNamespace: p.sourceNamespace,
      sourceRecordId: p.sourceRecordId,
      sourceDocumentId: p.sourceDocumentId,
      kind: p.kind,
      reversesSourceRecordId: p.reversesSourceRecordId,
      reportedAmount: amount,
      currency: 'USD',
      payload: p,
      contentHash: 'd'.repeat(64),
    },
  });
  const counts = `${String(await prisma.claimRemittanceEvidence.count({ where: { organizationId: f.org.id, claimId: f.claim.id } }))}:${String(await prisma.claimRemittanceReview.count({ where: { organizationId: f.org.id, claimId: f.claim.id } }))}`;
  const review = await prisma.claimRemittanceReview.create({
    data: {
      organizationId: f.org.id,
      claimId: f.claim.id,
      evidenceId: row.id,
      decision: 'ACCEPT',
      reviewedByUserId: f.user.id,
      idempotencyKey: randomUUID(),
      requestHash: 'b'.repeat(64),
      reviewToken: 'c'.repeat(64),
      evidenceHash: row.contentHash,
      claimUpdatedAt: f.claim.updatedAt,
      ledgerVersion: counts,
      reversedEvidenceId: reversed?.row.id ?? null,
      reportedAmount: amount,
      allocationCount: 0,
      adjustmentCount: 0,
    },
  });
  return { row, review };
}
async function batch(
  f: Fixture,
  options: {
    claimAmounts?: string[];
    adjustment?: string;
    decision?: 'ACCEPT' | 'REJECT' | null;
    detail?: 'COMPLETE' | 'PARTIAL';
  } = {},
): Promise<Batch> {
  const claims: Awaited<ReturnType<typeof claimRemittance>>[] = [];
  for (const amount of options.claimAmounts ?? []) claims.push(await claimRemittance(f, amount));
  const claimTotal = claims
    .reduce((sum, item) => sum.add(item.row.reportedAmount), new Prisma.Decimal(0))
    .toFixed(2);
  const adjustment = options.adjustment ?? '100.00';
  const net = new Prisma.Decimal(claimTotal).add(adjustment).toFixed(2);
  const p = {
    schemaVersion: 1,
    evidenceBasis: 'PAYER_REMITTANCE_BATCH',
    sourceNamespace: 'synthetic-payer',
    sourceBatchId: randomUUID(),
    sourceRecordId: randomUUID(),
    sourceDocumentId: 'document-1',
    sourceVersion: null,
    payerName: 'Synthetic payer',
    payerIdentifier: null,
    payerIdentifierSystem: null,
    payeeIdentifier: null,
    payeeIdentifierSystem: null,
    currency: 'USD',
    paymentTrace: null,
    paymentTraceType: null,
    paymentTraceIssuer: null,
    reportedDate: null,
    sourceStatus: null,
    detailCompleteness: options.detail ?? 'COMPLETE',
    reportedClaimAmount: claimTotal,
    reportedAdjustmentAmount: adjustment,
    reportedNetAmount: net,
    claimRemittances: claims.map((item) => ({
      sourceNamespace: item.row.sourceNamespace,
      sourceRecordId: item.row.sourceRecordId,
      reportedAmount: item.row.reportedAmount.toFixed(2),
    })),
    providerAdjustments: [
      {
        sourceAdjustmentId: 'adj-001',
        codeSystem: 'X12-PLB',
        reasonCode: 'ZZ',
        sourceReference: null,
        providerIdentifier: null,
        fiscalPeriodEnd: null,
        amount: adjustment,
        sourceAmount: adjustment,
        sourceSignConvention: 'NET_EFFECT_POSITIVE',
      },
    ],
  };
  const row = await prisma.remittanceBatchEvidence.create({
    data: {
      organizationId: f.org.id,
      sourceNamespace: p.sourceNamespace,
      sourceBatchId: p.sourceBatchId,
      sourceRecordId: p.sourceRecordId,
      sourceDocumentId: p.sourceDocumentId,
      sourceVersion: null,
      detailCompleteness: p.detailCompleteness,
      reportedClaimAmount: claimTotal,
      reportedAdjustmentAmount: adjustment,
      reportedNetAmount: net,
      payload: p,
      contentHash: 'e'.repeat(64),
    },
  });
  const decision = options.decision === undefined ? 'ACCEPT' : options.decision;
  const review =
    decision === null
      ? null
      : await prisma.$transaction(async (tx) => {
          const r = await tx.remittanceBatchReview.create({
            data: {
              organizationId: f.org.id,
              evidenceId: row.id,
              decision,
              reviewedByUserId: f.user.id,
              reviewedByRole: f.user.role,
              idempotencyKey: randomUUID(),
              requestHash: 'b'.repeat(64),
              reviewToken: 'c'.repeat(64),
              evidenceHash: row.contentHash,
              ledgerVersion: `${String(await tx.remittanceBatchEvidence.count({ where: { organizationId: f.org.id } }))}:${String(await tx.remittanceBatchReview.count({ where: { organizationId: f.org.id } }))}`,
              claimReportedAmount: decision === 'ACCEPT' ? claimTotal : null,
              providerAdjustmentAmount: decision === 'ACCEPT' ? adjustment : null,
              netAmount: decision === 'ACCEPT' ? net : null,
              claimCount: decision === 'ACCEPT' ? claims.length : 0,
              adjustmentCount: decision === 'ACCEPT' ? 1 : 0,
            },
          });
          if (decision === 'ACCEPT') {
            for (const [sourceIndex, item] of claims.entries())
              await tx.remittanceBatchClaim.create({
                data: {
                  organizationId: f.org.id,
                  reviewId: r.id,
                  batchEvidenceId: row.id,
                  sourceIndex,
                  claimId: f.claim.id,
                  remittanceEvidenceId: item.row.id,
                  remittanceReviewId: item.review.id,
                  amount: item.row.reportedAmount,
                },
              });
            await tx.remittanceBatchAdjustment.create({
              data: {
                organizationId: f.org.id,
                reviewId: r.id,
                sourceIndex: 0,
                sourceAdjustmentId: 'adj-001',
                codeSystem: 'X12-PLB',
                reasonCode: 'ZZ',
                amount: adjustment,
                sourceAmount: adjustment,
                sourceSignConvention: 'NET_EFFECT_POSITIVE',
              },
            });
          }
          return r;
        });
  return { row, review };
}
async function ledger(tx: Db, org: string): Promise<string> {
  const where = { organizationId: org };
  const counts = [
    await tx.cashSourceEvidence.count({ where }),
    await tx.cashSourceReview.count({ where }),
    await tx.remittanceBatchEvidence.count({ where }),
    await tx.remittanceBatchReview.count({ where }),
    await tx.cashBatchMatch.count({ where }),
    await tx.cashBatchRelease.count({ where }),
  ];
  return counts.join(':');
}
async function createMatch(
  tx: Db,
  f: Fixture,
  c: Cash,
  b: Batch,
  amount = '100.00',
  overrides: Partial<Prisma.CashBatchMatchUncheckedCreateInput> = {},
  barrier?: () => Promise<void>,
): Promise<CashBatchMatch> {
  const ledgerVersion = await ledger(tx, f.org.id);
  if (barrier) await barrier();
  return tx.cashBatchMatch.create({
    data: {
      organizationId: f.org.id,
      cashTransactionId: c.transaction.id,
      cashEvidenceId: c.row.id,
      cashReviewId: c.review?.id ?? randomUUID(),
      batchEvidenceId: b.row.id,
      batchReviewId: b.review?.id ?? randomUUID(),
      amount,
      reviewedByUserId: f.user.id,
      reviewedByRole: f.user.role,
      idempotencyKey: randomUUID(),
      requestHash: 'f'.repeat(64),
      reviewToken: 'c'.repeat(64),
      ledgerVersion,
      cashEvidenceHash: c.row.contentHash,
      batchEvidenceHash: b.row.contentHash,
      ...overrides,
    },
  });
}
async function match(
  f: Fixture,
  c: Cash,
  b: Batch,
  amount = '100.00',
  overrides: Partial<Prisma.CashBatchMatchUncheckedCreateInput> = {},
): Promise<CashBatchMatch> {
  return prisma.$transaction((tx) => createMatch(tx, f, c, b, amount, overrides));
}
async function createRelease(
  tx: Db,
  f: Fixture,
  m: CashBatchMatch,
  overrides: Partial<Prisma.CashBatchReleaseUncheckedCreateInput> = {},
  barrier?: () => Promise<void>,
): Promise<CashBatchRelease> {
  const ledgerVersion = await ledger(tx, f.org.id);
  if (barrier) await barrier();
  return tx.cashBatchRelease.create({
    data: {
      organizationId: f.org.id,
      matchId: m.id,
      reviewedByUserId: f.user.id,
      reviewedByRole: f.user.role,
      reason: 'WRONG_MATCH',
      idempotencyKey: randomUUID(),
      requestHash: 'f'.repeat(64),
      reviewToken: 'c'.repeat(64),
      ledgerVersion,
      matchRequestHash: m.requestHash,
      ...overrides,
    },
  });
}
async function release(
  f: Fixture,
  m: CashBatchMatch,
  overrides: Partial<Prisma.CashBatchReleaseUncheckedCreateInput> = {},
): Promise<CashBatchRelease> {
  return prisma.$transaction((tx) => createRelease(tx, f, m, overrides));
}
async function component(f: Fixture, c: Cash): Promise<ComponentNode[]> {
  return prisma.$queryRaw`SELECT * FROM dentabill_cash_match_component(${f.org.id},${c.transaction.id}::uuid)`;
}
function barrier(): () => Promise<void> {
  let ready = 0;
  let releaseGate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  return async () => {
    ready += 1;
    if (ready === 2) releaseGate?.();
    await gate;
  };
}

describe('immutable cash and batch reconciliation', () => {
  it('reserves the150 batch net from180 claim reports minus30 adjustments without altering source/claim records', async () => {
    const f = await fixture();
    const c = await cash(f, { amount: '150.00', sourceAmount: '150.00' });
    const b = await batch(f, { claimAmounts: ['100.00', '80.00'], adjustment: '-30.00' });
    const claims = await prisma.claim.findMany({ where: { organizationId: f.org.id } });
    const remittanceRows = await prisma.claimRemittanceReview.findMany({
      where: { organizationId: f.org.id },
    });
    const m = await match(f, c, b, '150.00');
    expect(m.amount.toFixed(2)).toBe('150.00');
    expect(m.ledgerVersion).toBe('1:1:1:1:0:0');
    expect(await prisma.claim.findMany({ where: { organizationId: f.org.id } })).toEqual(claims);
    expect(
      await prisma.claimRemittanceReview.findMany({ where: { organizationId: f.org.id } }),
    ).toEqual(remittanceRows);
    expect(await prisma.cashSourceEvidence.findUnique({ where: { id: c.row.id } })).toEqual(c.row);
    expect(await prisma.remittanceBatchEvidence.findUnique({ where: { id: b.row.id } })).toEqual(
      b.row,
    );
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).updatedAt,
    ).toEqual(f.org.updatedAt);
  });
  it('supports partial many-to-many matches with exact independent cash and batch capacity', async () => {
    const f = await fixture();
    const c1 = await cash(f);
    const c2 = await cash(f);
    const b1 = await batch(f, { adjustment: '120.00' });
    const b2 = await batch(f, { adjustment: '80.00' });
    await match(f, c1, b1, '60.00');
    await match(f, c1, b2, '40.00');
    await match(f, c2, b1, '60.00');
    await match(f, c2, b2, '40.00');
    await expect(match(f, c1, b1, '0.01')).rejects.toThrow('CASH_BATCH_CAPACITY_EXCEEDED');
    expect(await prisma.cashBatchMatch.count({ where: { organizationId: f.org.id } })).toBe(4);
  });
  it.each(['cash', 'batch'])('independently enforces the %s side capacity', async (side) => {
    const f = await fixture();
    const c = await cash(f, {
      amount: side === 'cash' ? '100.00' : '200.00',
      sourceAmount: side === 'cash' ? '100.00' : '200.00',
    });
    const b = await batch(f, { adjustment: side === 'batch' ? '100.00' : '200.00' });
    await match(f, c, b, '80.00');
    await expect(match(f, c, b, '20.01')).rejects.toThrow('CASH_BATCH_CAPACITY_EXCEEDED');
    await match(f, c, b, '20.00');
  });
  it('matches negative cash to a signed reversal batch without altering the original payment', async () => {
    const f = await fixture();
    const c = await cash(f, { amount: '-20.00', sourceAmount: '-20.00' });
    const b = await batch(f, { claimAmounts: ['-20.00'], adjustment: '0.00' });
    await match(f, c, b, '-12.50');
    await match(f, c, b, '-7.50');
    await expect(match(f, c, b, '-0.01')).rejects.toThrow('CASH_BATCH_CAPACITY_EXCEEDED');
    expect(
      await prisma.claimRemittanceReview.count({
        where: { organizationId: f.org.id, decision: 'ACCEPT' },
      }),
    ).toBe(2);
  });
  it.each([
    { cash: '100.00', batch: '100.00', amount: '0.00' },
    { cash: '100.00', batch: '100.00', amount: '-1.00' },
    { cash: '-100.00', batch: '100.00', amount: '-1.00' },
    { cash: '100.00', batch: '-100.00', amount: '1.00' },
    { cash: '0.00', batch: '100.00', amount: '1.00' },
    { cash: '100.00', batch: '0.00', amount: '1.00' },
  ])('rejects zero or inconsistent signed evidence %j', async (values) => {
    const f = await fixture();
    const c = await cash(f, { amount: values.cash, sourceAmount: values.cash });
    const b = await batch(f, { adjustment: values.batch });
    await expect(match(f, c, b, values.amount)).rejects.toThrow('CASH_BATCH_SIGN_INVALID');
  });
  it.each(['PENDING', 'UNKNOWN', 'REMOVED'] as const)(
    'does not match accepted %s cash',
    async (status) => {
      const f = await fixture();
      const c = await cash(f, {
        status,
        ...(status === 'REMOVED' ? { amount: null, sourceAmount: null } : {}),
      });
      const b = await batch(f);
      await expect(match(f, c, b)).rejects.toThrow('CASH_BATCH_CASH_NOT_CURRENT');
    },
  );
  it.each(['REJECT', null] as const)(
    'does not match cash without accepted review: %s',
    async (decision) => {
      const f = await fixture();
      const c = await cash(f, {}, undefined, decision);
      const b = await batch(f);
      await expect(match(f, c, b)).rejects.toThrow('CASH_BATCH_CASH_NOT_CURRENT');
    },
  );
  it.each(['REJECT', null] as const)(
    'does not match a batch without accepted review: %s',
    async (decision) => {
      const f = await fixture();
      const c = await cash(f);
      const b = await batch(f, { decision, detail: 'PARTIAL' });
      await expect(match(f, c, b)).rejects.toThrow('CASH_BATCH_BATCH_NOT_ACCEPTED');
    },
  );
  it.each(['ACCEPT', 'REJECT', null] as const)(
    'blocks older accepted cash when a newer observation is %s',
    async (decision) => {
      const f = await fixture();
      const c = await cash(f);
      const b = await batch(f);
      await cash(f, {}, c, decision);
      await expect(match(f, c, b)).rejects.toThrow('CASH_BATCH_CASH_NOT_CURRENT');
    },
  );
  it('keeps stale reservations on both sides until an explicit release restores capacity', async () => {
    const f = await fixture();
    const c = await cash(f);
    const b = await batch(f);
    const m = await match(f, c, b, '80.00');
    const newer = await cash(f, { amount: '120.00', sourceAmount: '120.00' }, c);
    const otherCash = await cash(f);
    const otherBatch = await batch(f);
    await expect(match(f, newer, otherBatch, '20.00')).rejects.toThrow(
      'CASH_BATCH_COMPONENT_RESERVED',
    );
    await expect(match(f, otherCash, b, '20.01')).rejects.toThrow('CASH_BATCH_CAPACITY_EXCEEDED');
    await release(f, m, { reason: 'SOURCE_CHANGED' });
    await match(f, newer, b, '100.00');
    await match(f, newer, otherBatch, '20.00');
    expect(await prisma.cashBatchMatch.findUnique({ where: { id: m.id } })).toEqual(m);
  });
  it.each([
    { cashEvidenceHash: 'b'.repeat(64) },
    { batchEvidenceHash: 'b'.repeat(64) },
    { cashTransactionId: randomUUID() },
    { cashEvidenceId: randomUUID() },
    { cashReviewId: randomUUID() },
    { batchEvidenceId: randomUUID() },
    { batchReviewId: randomUUID() },
    { reviewedByRole: 'ADMIN' },
    { ledgerVersion: '0:0:0:0:0:0' },
    { requestHash: 'invalid' },
    { reviewToken: 'invalid' },
  ])('rejects invalid direct match admission %j', async (overrides) => {
    const f = await fixture();
    const c = await cash(f);
    const b = await batch(f);
    await expect(
      match(f, c, b, '10.00', overrides as Partial<Prisma.CashBatchMatchUncheckedCreateInput>),
    ).rejects.toThrow();
  });
  it('binds exact review/evidence pairs even within one organization', async () => {
    const f = await fixture();
    const c = await cash(f);
    const c2 = await cash(f);
    const b = await batch(f);
    const b2 = await batch(f);
    await expect(
      match(f, c, b, '10.00', { cashReviewId: c2.review?.id ?? randomUUID() }),
    ).rejects.toThrow();
    await expect(
      match(f, c, b, '10.00', { batchReviewId: b2.review?.id ?? randomUUID() }),
    ).rejects.toThrow();
  });
  it('enforces scoped actor/cash/batch references for match and release', async () => {
    const f = await fixture();
    const other = await fixture();
    const c = await cash(f);
    const b = await batch(f);
    const oc = await cash(other);
    const ob = await batch(other);
    await expect(match(f, oc, b, '10.00')).rejects.toThrow();
    await expect(match(f, c, ob, '10.00')).rejects.toThrow();
    await expect(match(f, c, b, '10.00', { reviewedByUserId: other.user.id })).rejects.toThrow();
    const m = await match(f, c, b, '10.00');
    await expect(release(other, m)).rejects.toThrow();
    await expect(release(f, m, { reviewedByUserId: other.user.id })).rejects.toThrow();
  });
  it.each([
    { reason: 'invented' },
    { reviewedByRole: 'ADMIN' },
    { matchRequestHash: 'a'.repeat(64) },
    { ledgerVersion: '0:0:0:0:0:0' },
    { reviewToken: 'invalid' },
    { requestHash: 'invalid' },
    { matchId: randomUUID() },
  ])('rejects invalid release %j', async (overrides) => {
    const f = await fixture();
    const m = await match(f, await cash(f), await batch(f));
    await expect(
      release(f, m, overrides as Partial<Prisma.CashBatchReleaseUncheckedCreateInput>),
    ).rejects.toThrow();
  });
  it('preserves stored reviewer roles while requiring the current role on new commands', async () => {
    const f = await fixture();
    const m = await match(f, await cash(f), await batch(f));
    await prisma.user.update({
      where: { id: f.user.id, organizationId: f.org.id },
      data: { role: 'ADMIN' },
    });
    await expect(release(f, m)).rejects.toThrow('CASH_BATCH_ACTOR_INVALID');
    const r = await release(f, m, { reviewedByRole: 'ADMIN' });
    expect(r.reviewedByRole).toBe('ADMIN');
    expect(
      (await prisma.cashBatchMatch.findUniqueOrThrow({ where: { id: m.id } })).reviewedByRole,
    ).toBe('BILLING_STAFF');
  });
  it('enforces one release and unique per-organization request keys without deleting history', async () => {
    const f = await fixture();
    const c = await cash(f);
    const b = await batch(f);
    const m = await match(f, c, b, '50.00');
    await expect(match(f, c, b, '10.00', { idempotencyKey: m.idempotencyKey })).rejects.toThrow();
    const r = await release(f, m);
    await expect(release(f, m)).rejects.toThrow();
    const m2 = await match(f, c, b, '100.00');
    await expect(release(f, m2, { idempotencyKey: r.idempotencyKey })).rejects.toThrow();
    await release(f, m2, { reason: 'OTHER_REVIEWED_ERROR' });
    expect(await prisma.cashBatchMatch.count({ where: { organizationId: f.org.id } })).toBe(2);
    expect(await prisma.cashBatchRelease.count({ where: { organizationId: f.org.id } })).toBe(2);
  });
  it('makes both new models immutable and blocks source/actor deletion', async () => {
    const f = await fixture();
    const c = await cash(f);
    const b = await batch(f);
    const m = await match(f, c, b);
    await release(f, m);
    for (const table of ['CashBatchMatch', 'CashBatchRelease']) {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "${table}" SET id = id WHERE "organizationId" = $1`,
          f.org.id,
        ),
      ).rejects.toThrow('CASH_BATCH_IMMUTABLE');
      await expect(
        prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = $1`, f.org.id),
      ).rejects.toThrow('CASH_BATCH_IMMUTABLE');
    }
    await expect(
      prisma.user.delete({ where: { organizationId: f.org.id, id: f.user.id } }),
    ).rejects.toThrow();
    await expect(prisma.organization.delete({ where: { id: f.org.id } })).rejects.toThrow();
  });
  it('includes missing parents, siblings and cycles while retaining historical edges after null revisions', async () => {
    const f = await fixture();
    const a = await cash(f, {
      sourceTransactionId: 'A',
      status: 'PENDING',
      pendingSourceTransactionId: 'missing',
    });
    const b = await cash(f, {
      sourceTransactionId: 'B',
      status: 'PENDING',
      pendingSourceTransactionId: 'missing',
    });
    expect((await component(f, a)).map((n) => n.source_id).sort()).toEqual(['A', 'B', 'missing']);
    expect(
      (await component(f, b)).find((n) => n.source_id === 'missing')?.transaction_id,
    ).toBeNull();
    const root = await cash(f, {
      sourceTransactionId: 'missing',
      status: 'PENDING',
      pendingSourceTransactionId: 'A',
    });
    await cash(f, { pendingSourceTransactionId: null }, a);
    const rows = await component(f, b);
    expect(rows).toHaveLength(3);
    expect(rows.every((n) => n.transaction_id !== null && !n.overflow)).toBe(true);
    expect(rows.some((n) => n.transaction_id === root.transaction.id)).toBe(true);
  });
  it('ignores rejected/unreviewed source links and keeps accounts, namespaces and organizations separate', async () => {
    const f = await fixture();
    const a = await cash(f, { sourceTransactionId: 'A', status: 'PENDING' });
    await cash(
      f,
      { sourceTransactionId: 'unreviewed', status: 'PENDING', pendingSourceTransactionId: 'A' },
      undefined,
      null,
    );
    await cash(
      f,
      { sourceTransactionId: 'rejected', status: 'PENDING', pendingSourceTransactionId: 'A' },
      undefined,
      'REJECT',
    );
    await cash(f, {
      sourceTransactionId: 'foreign-account',
      sourceAccountId: 'other',
      status: 'PENDING',
      pendingSourceTransactionId: 'A',
    });
    await cash(f, {
      sourceTransactionId: 'foreign-ns',
      sourceNamespace: 'other',
      status: 'PENDING',
      pendingSourceTransactionId: 'A',
    });
    await cash(await fixture(), {
      sourceTransactionId: 'foreign-org',
      status: 'PENDING',
      pendingSourceTransactionId: 'A',
    });
    expect(await component(f, a)).toEqual([
      { transaction_id: a.transaction.id, source_id: 'A', overflow: false },
    ]);
  });
  it.each(['chain', 'siblings', 'cycle'])(
    'blocks replacement reuse through a historical %s until release',
    async (shape) => {
      const f = await fixture();
      const p = await cash(f, {
        sourceTransactionId: 'P',
        pendingSourceTransactionId:
          shape === 'siblings' ? 'missing' : shape === 'cycle' ? 'Q' : null,
      });
      const b = await batch(f);
      const m = await match(f, p, b);
      await cash(
        f,
        { status: 'REMOVED', amount: null, sourceAmount: null, pendingSourceTransactionId: null },
        p,
      );
      const q = await cash(f, {
        sourceTransactionId: 'Q',
        pendingSourceTransactionId: shape === 'siblings' ? 'missing' : 'P',
      });
      const secondBatch = await batch(f);
      await expect(match(f, q, secondBatch)).rejects.toThrow('CASH_BATCH_COMPONENT_RESERVED');
      await release(f, m, { reason: 'SOURCE_CHANGED' });
      await match(f, q, secondBatch);
    },
  );
  it('keeps both reservations when a later source merge connects previously separate matched components', async () => {
    const f = await fixture();
    const a = await cash(f, { sourceTransactionId: 'A' });
    const b = await cash(f, { sourceTransactionId: 'B' });
    const ba = await batch(f);
    const bb = await batch(f);
    const ma = await match(f, a, ba);
    const mb = await match(f, b, bb);
    await cash(
      f,
      {
        status: 'REMOVED',
        amount: null,
        sourceAmount: null,
        pendingSourceTransactionId: 'shared-parent',
      },
      a,
    );
    const merged = await cash(f, { pendingSourceTransactionId: 'shared-parent' }, b);
    const freshBatch = await batch(f);
    expect(await prisma.cashBatchRelease.count({ where: { organizationId: f.org.id } })).toBe(0);
    await expect(match(f, merged, freshBatch)).rejects.toThrow('CASH_BATCH_COMPONENT_RESERVED');
    await release(f, ma, { reason: 'SOURCE_CHANGED' });
    await expect(match(f, merged, freshBatch)).rejects.toThrow('CASH_BATCH_COMPONENT_RESERVED');
    await release(f, mb, { reason: 'SOURCE_CHANGED' });
    await match(f, merged, freshBatch);
  });
  it('enforces100-source-node bound including missing IDs and keeps release available for an oversized historical fixture', async () => {
    const f = await fixture();
    const c = await cash(f, {
      sourceTransactionId: 'root',
      pendingSourceTransactionId: 'not-imported',
    });
    const b = await batch(f);
    const m = await match(f, c, b);
    await prisma.$transaction(
      async (tx) => {
        // Construct a legacy oversized graph solely to exercise the defensive read
        // bound. Restore the pre-existing source-admission trigger before commit;
        // new reconciliation guards stay enabled throughout this fixture setup.
        await tx.$executeRawUnsafe(
          'ALTER TABLE "CashSourceReview" DISABLE TRIGGER "CashSourceReview_admission"',
        );
        for (let index = 0; index < 99; index += 1)
          await cash(
            f,
            {
              sourceTransactionId: `node-${String(index)}`,
              status: 'PENDING',
              pendingSourceTransactionId: 'not-imported',
            },
            undefined,
            'ACCEPT',
            tx,
          );
        await tx.$executeRawUnsafe(
          'ALTER TABLE "CashSourceReview" ENABLE TRIGGER "CashSourceReview_admission"',
        );
      },
      { timeout: 30_000 },
    );
    expect(await component(f, c)).toEqual([
      { transaction_id: null, source_id: null, overflow: true },
    ]);
    await expect(match(f, c, await batch(f), '1.00')).rejects.toThrow('CASH_BATCH_COMPONENT_LIMIT');
    await release(f, m, { reason: 'SOURCE_CHANGED' });
  }, 60_000);
  it.each([
    Prisma.TransactionIsolationLevel.ReadCommitted,
    Prisma.TransactionIsolationLevel.RepeatableRead,
  ])('serializes concurrent capacity reservations under %s', async (isolationLevel) => {
    const f = await fixture();
    const c = await cash(f);
    const b = await batch(f);
    const gate = barrier();
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        prisma.$transaction((tx) => createMatch(tx, f, c, b, '70.00', {}, gate), {
          isolationLevel,
          timeout: 10_000,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(match(f, c, b, '70.00')).rejects.toThrow('CASH_BATCH_CAPACITY_EXCEEDED');
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).updatedAt,
    ).toEqual(f.org.updatedAt);
  });
  it.each([
    Prisma.TransactionIsolationLevel.ReadCommitted,
    Prisma.TransactionIsolationLevel.RepeatableRead,
  ])('serializes competing releases under %s', async (isolationLevel) => {
    const f = await fixture();
    const m = await match(f, await cash(f), await batch(f));
    const gate = barrier();
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        prisma.$transaction((tx) => createRelease(tx, f, m, {}, gate), {
          isolationLevel,
          timeout: 10_000,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.cashBatchRelease.count({ where: { organizationId: f.org.id } })).toBe(1);
  });
  it.each([
    Prisma.TransactionIsolationLevel.ReadCommitted,
    Prisma.TransactionIsolationLevel.RepeatableRead,
  ])(
    'rejects an older match preview after a concurrent source observation under %s',
    async (isolationLevel) => {
      const f = await fixture();
      const c = await cash(f);
      const b = await batch(f);
      let announceRead: (() => void) | undefined;
      let permitInsert: (() => void) | undefined;
      const read = new Promise<void>((resolve) => {
        announceRead = resolve;
      });
      const changed = new Promise<void>((resolve) => {
        permitInsert = resolve;
      });
      const pending = prisma.$transaction(
        (tx) =>
          createMatch(tx, f, c, b, '100.00', {}, async () => {
            announceRead?.();
            await changed;
          }),
        { isolationLevel, timeout: 10_000 },
      );
      // Attach the rejection assertion before allowing the concurrent change.
      const rejected = expect(pending).rejects.toThrow();
      await read;
      try {
        await cash(f, { status: 'REMOVED', amount: null, sourceAmount: null }, c);
      } finally {
        permitInsert?.();
      }
      await rejected;
      expect(await prisma.cashBatchMatch.count({ where: { organizationId: f.org.id } })).toBe(0);
      expect(
        (await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).updatedAt,
      ).toEqual(f.org.updatedAt);
    },
  );
  it('scopes both delegates for reads and refuses unscoped writes', async () => {
    const f = await fixture();
    const other = await fixture();
    for (const parent of [f, other])
      await release(parent, await match(parent, await cash(parent), await batch(parent)));
    const db = getOrgScopedDb(f.org.id);
    expect(await db.cashBatchMatch.count()).toBe(1);
    expect(await db.cashBatchRelease.count()).toBe(1);
    expect(
      await db.cashBatchMatch.findFirst({ where: { organizationId: other.org.id } }),
    ).toMatchObject({ organizationId: f.org.id });
    expect((await db.cashBatchMatch.aggregate({ _count: true }))._count).toBe(1);
    expect(await db.cashBatchRelease.groupBy({ by: ['organizationId'], _count: true })).toEqual([
      { organizationId: f.org.id, _count: 1 },
    ]);
    await expect(prisma.cashBatchMatch.deleteMany()).rejects.toThrow(MissingOrgScopeError);
    await expect(prisma.cashBatchRelease.deleteMany()).rejects.toThrow(MissingOrgScopeError);
  });
});

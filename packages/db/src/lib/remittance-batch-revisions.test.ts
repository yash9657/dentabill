import { randomUUID } from 'node:crypto';

import {
  Prisma,
  type CashBatchMatch,
  type CashBatchRelease,
  type CashSourceEvidence,
  type CashSourceReview,
  type CashSourceTransaction,
  type Organization,
  type User,
  type Claim,
  type ClaimRemittanceEvidence,
  type ClaimRemittanceReview,
  type RemittanceBatchEvidence,
  type RemittanceBatchReview,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { prisma } from '../client.js';

import { MissingOrgScopeError } from './errors.js';
import { getOrgScopedDb } from './with-org.js';

type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
interface Member extends Prisma.InputJsonObject {
  sourceNamespace: string;
  sourceRecordId: string;
  reportedAmount: string;
}
interface Adjustment extends Prisma.InputJsonObject {
  sourceAdjustmentId: string;
  codeSystem: string;
  reasonCode: string;
  sourceReference: string | null;
  providerIdentifier: string | null;
  fiscalPeriodEnd: string | null;
  amount: string;
  sourceAmount: string;
  sourceSignConvention: string;
}
interface Payload extends Prisma.InputJsonObject {
  sourceNamespace: string;
  sourceBatchId: string;
  sourceRecordId: string;
  sourceDocumentId: string;
  sourceVersion: string | null;
  detailCompleteness: string;
  reportedClaimAmount: string | null;
  reportedAdjustmentAmount: string | null;
  reportedNetAmount: string | null;
  claimRemittances: Member[];
  providerAdjustments: Adjustment[];
}
interface Fixture {
  org: Organization;
  user: User;
  claim: Claim;
}
interface Remittance {
  row: ClaimRemittanceEvidence;
  review: ClaimRemittanceReview | null;
}
interface Evidence {
  row: RemittanceBatchEvidence;
  payload: Payload;
}
function adjustment(overrides: Partial<Adjustment> = {}): Adjustment {
  return {
    sourceAdjustmentId: 'adj-001',
    codeSystem: 'X12-PLB',
    reasonCode: 'ZZ-unknown',
    sourceReference: '000-ref',
    providerIdentifier: '000-provider',
    fiscalPeriodEnd: '2026-12-31',
    amount: '-5.00',
    sourceAmount: '5.00',
    sourceSignConvention: 'REDUCTION_POSITIVE',
    ...overrides,
  };
}
function payload(overrides: Partial<Payload> = {}): Payload {
  return {
    schemaVersion: 1,
    evidenceBasis: 'PAYER_REMITTANCE_BATCH',
    sourceNamespace: 'synthetic',
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
    detailCompleteness: 'COMPLETE',
    reportedClaimAmount: '0.00',
    reportedAdjustmentAmount: '0.00',
    reportedNetAmount: '0.00',
    claimRemittances: [],
    providerAdjustments: [],
    ...overrides,
  };
}
async function fixture(): Promise<Fixture> {
  const org = await prisma.organization.create({
    data: { name: 'Synthetic batch evidence', clerkOrgId: randomUUID() },
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
      claimNumber: 'same-display',
      patientDOBHash: 'synthetic',
      claimAmount: '100.00',
      payerCode: 'UNKNOWN',
      serviceDate: new Date('2026-01-01'),
    },
  });
  return { org, user, claim };
}
async function remittance(
  f: Fixture,
  decision: 'ACCEPT' | 'REJECT' | null = 'ACCEPT',
  reversed?: Remittance,
): Promise<Remittance> {
  const reportedAmount = reversed ? '-20.00' : '100.00';
  const p = {
    schemaVersion: 1,
    sourceNamespace: 'synthetic',
    sourceRecordId: randomUUID(),
    sourceDocumentId: 'document-1',
    sourceVersion: null,
    kind: reversed ? 'REVERSAL' : 'PAYMENT',
    reversesSourceRecordId: reversed?.row.sourceRecordId ?? null,
    currency: 'USD',
    reportedAmount,
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
      reportedAmount,
      currency: 'USD',
      payload: p,
      contentHash: 'a'.repeat(64),
    },
  });
  const review =
    decision === null
      ? null
      : await prisma.claimRemittanceReview.create({
          data: {
            organizationId: f.org.id,
            claimId: f.claim.id,
            evidenceId: row.id,
            decision,
            reviewedByUserId: f.user.id,
            idempotencyKey: randomUUID(),
            requestHash: 'b'.repeat(64),
            reviewToken: 'c'.repeat(64),
            evidenceHash: row.contentHash,
            claimUpdatedAt: f.claim.updatedAt,
            ledgerVersion: `${String(await prisma.claimRemittanceEvidence.count({ where: { organizationId: f.org.id, claimId: f.claim.id } }))}:${String(await prisma.claimRemittanceReview.count({ where: { organizationId: f.org.id, claimId: f.claim.id } }))}`,
            reversedEvidenceId: decision === 'ACCEPT' ? (reversed?.row.id ?? null) : null,
            reportedAmount: decision === 'ACCEPT' ? reportedAmount : '0.00',
            allocationCount: 0,
            adjustmentCount: 0,
          },
        });
  return { row, review };
}
function member(r: Remittance): Member {
  return {
    sourceNamespace: r.row.sourceNamespace,
    sourceRecordId: r.row.sourceRecordId,
    reportedAmount: r.row.reportedAmount.toFixed(2),
  };
}
async function evidence(
  f: Fixture,
  p = payload(),
  overrides: Partial<Prisma.RemittanceBatchEvidenceUncheckedCreateInput> = {},
): Promise<Evidence> {
  const row = await prisma.remittanceBatchEvidence.create({
    data: {
      organizationId: f.org.id,
      sourceNamespace: p.sourceNamespace,
      sourceBatchId: p.sourceBatchId,
      sourceRecordId: p.sourceRecordId,
      sourceDocumentId: p.sourceDocumentId,
      sourceVersion: p.sourceVersion,
      detailCompleteness: p.detailCompleteness,
      reportedClaimAmount: p.reportedClaimAmount,
      reportedAdjustmentAmount: p.reportedAdjustmentAmount,
      reportedNetAmount: p.reportedNetAmount,
      payload: p,
      contentHash: 'd'.repeat(64),
      ...overrides,
    },
  });
  return { row, payload: p };
}
async function createReview(
  tx: Db,
  f: Fixture,
  e: Evidence,
  overrides: Partial<Prisma.RemittanceBatchReviewUncheckedCreateInput> = {},
  childOverrides: Partial<Prisma.RemittanceBatchClaimUncheckedCreateInput> = {},
  adjustmentOverrides: Partial<Prisma.RemittanceBatchAdjustmentUncheckedCreateInput> = {},
  barrier?: () => Promise<void>,
): Promise<RemittanceBatchReview> {
  const evidenceCount = await tx.remittanceBatchEvidence.count({
    where: { organizationId: f.org.id },
  });
  const reviewCount = await tx.remittanceBatchReview.count({ where: { organizationId: f.org.id } });
  if (barrier) await barrier();
  const reject = overrides.decision === 'REJECT';
  const r = await tx.remittanceBatchReview.create({
    data: {
      organizationId: f.org.id,
      evidenceId: e.row.id,
      decision: 'ACCEPT',
      reviewedByUserId: f.user.id,
      reviewedByRole: f.user.role,
      idempotencyKey: randomUUID(),
      requestHash: 'b'.repeat(64),
      reviewToken: 'c'.repeat(64),
      evidenceHash: e.row.contentHash,
      ledgerVersion: `${String(evidenceCount)}:${String(reviewCount)}`,
      claimReportedAmount: reject ? null : (e.payload.reportedClaimAmount ?? '0.00'),
      providerAdjustmentAmount: reject ? null : (e.payload.reportedAdjustmentAmount ?? '0.00'),
      netAmount: reject ? null : (e.payload.reportedNetAmount ?? '0.00'),
      claimCount: reject ? 0 : e.payload.claimRemittances.length,
      adjustmentCount: reject ? 0 : e.payload.providerAdjustments.length,
      ...overrides,
    },
  });
  if (reject) return r;
  for (const [sourceIndex, m] of e.payload.claimRemittances.entries()) {
    const ce = await tx.claimRemittanceEvidence.findFirstOrThrow({
      where: {
        organizationId: f.org.id,
        sourceNamespace: m.sourceNamespace,
        sourceRecordId: m.sourceRecordId,
      },
      include: { review: true },
    });
    await tx.remittanceBatchClaim.create({
      data: {
        organizationId: f.org.id,
        reviewId: r.id,
        batchEvidenceId: e.row.id,
        sourceIndex,
        claimId: ce.claimId,
        remittanceEvidenceId: ce.id,
        remittanceReviewId: ce.review?.id ?? randomUUID(),
        amount: m.reportedAmount,
        ...childOverrides,
      },
    });
  }
  for (const [sourceIndex, a] of e.payload.providerAdjustments.entries()) {
    await tx.remittanceBatchAdjustment.create({
      data: {
        reviewId: r.id,
        organizationId: f.org.id,
        sourceIndex,
        sourceAdjustmentId: a.sourceAdjustmentId,
        codeSystem: a.codeSystem,
        reasonCode: a.reasonCode,
        sourceReference: a.sourceReference,
        providerIdentifier: a.providerIdentifier,
        fiscalPeriodEnd: a.fiscalPeriodEnd ? new Date(a.fiscalPeriodEnd) : null,
        amount: a.amount,
        sourceAmount: a.sourceAmount,
        sourceSignConvention: a.sourceSignConvention,
        ...adjustmentOverrides,
      },
    });
  }
  return r;
}
async function review(
  f: Fixture,
  e: Evidence,
  overrides: Partial<Prisma.RemittanceBatchReviewUncheckedCreateInput> = {},
  childOverrides: Partial<Prisma.RemittanceBatchClaimUncheckedCreateInput> = {},
  adjustmentOverrides: Partial<Prisma.RemittanceBatchAdjustmentUncheckedCreateInput> = {},
): Promise<RemittanceBatchReview> {
  return prisma.$transaction((tx) =>
    createReview(tx, f, e, overrides, childOverrides, adjustmentOverrides),
  );
}

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

function revised(e: Evidence, sequence: number, changes: Partial<Payload> = {}): Payload {
  return payload({
    ...e.payload,
    schemaVersion: 2,
    sourceSequence: sequence,
    sourceRecordId: randomUUID(),
    ...changes,
  });
}
async function revision(f: Fixture, e: Evidence) {
  return prisma.remittanceBatchRevision.findFirstOrThrow({
    where: { evidenceId: e.row.id, organizationId: f.org.id },
    include: { batch: true },
  });
}
function netPayload(amount = '100.00'): Payload {
  return payload({
    reportedAdjustmentAmount: amount,
    reportedNetAmount: amount,
    providerAdjustments: [
      adjustment({ amount, sourceAmount: amount, sourceSignConvention: 'NET_EFFECT_POSITIVE' }),
    ],
  });
}
async function accepted(f: Fixture, e: Evidence): Promise<Batch> {
  return { row: e.row, review: await review(f, e) };
}

describe('stable remittance batch revisions', () => {
  it('automatically binds unchanged v1 evidence and preserves original facts and timestamps', async () => {
    const f = await fixture();
    const m = await remittance(f);
    const p = payload({
      reportedClaimAmount: '100.00',
      reportedNetAmount: '100.00',
      claimRemittances: [member(m)],
    });
    const e = await evidence(f, p);
    const r = await review(f, e);
    const rev = await revision(f, e);
    expect(rev).toMatchObject({
      schemaVersion: 1,
      sourceSequence: null,
      batch: {
        sourceBatchId: p.sourceBatchId,
        sourceNamespace: p.sourceNamespace,
        createdAt: e.row.createdAt,
      },
    });
    const child = await prisma.remittanceBatchClaim.findFirstOrThrow({
      where: { reviewId: r.id, organizationId: f.org.id },
    });
    expect(
      await prisma.remittanceBatchMemberOwnership.findFirst({
        where: { organizationId: f.org.id },
      }),
    ).toMatchObject({
      batchId: rev.batchId,
      firstMemberId: child.id,
      remittanceEvidenceId: m.row.id,
    });
    expect(await prisma.remittanceBatchEvidence.findUnique({ where: { id: e.row.id } })).toEqual(
      e.row,
    );
    expect(await prisma.remittanceBatchReview.findUnique({ where: { id: r.id } })).toEqual(r);
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).updatedAt,
    ).toEqual(f.org.updatedAt);
  });
  it('reuses members only within one stable batch and retains ownership after omission', async () => {
    const f = await fixture();
    const m = await remittance(f);
    const e = await evidence(
      f,
      payload({
        reportedClaimAmount: '100.00',
        reportedNetAmount: '100.00',
        claimRemittances: [member(m)],
      }),
    );
    await review(f, e);
    const owner = await prisma.remittanceBatchMemberOwnership.findFirstOrThrow({
      where: { organizationId: f.org.id },
    });
    const e2 = await evidence(f, revised(e, 1));
    await review(f, e2);
    const omitted = await evidence(
      f,
      revised(e, 2, {
        reportedClaimAmount: '0.00',
        reportedNetAmount: '0.00',
        claimRemittances: [],
      }),
    );
    await review(f, omitted);
    const other = await evidence(
      f,
      payload({ ...e.payload, sourceBatchId: randomUUID(), sourceRecordId: randomUUID() }),
    );
    await expect(review(f, other)).rejects.toThrow('REMITTANCE_BATCH_MEMBER_OWNED');
    const restored = await evidence(f, revised(e, 3));
    await review(f, restored);
    expect(
      await prisma.remittanceBatchMemberOwnership.findFirst({
        where: { organizationId: f.org.id },
      }),
    ).toEqual(owner);
    expect(await prisma.remittanceBatchMemberOwnership.count()).toBe(1);
    expect(await prisma.remittanceBatchClaim.count()).toBe(3);
  });
  it('orders explicit sequences above the NULL baseline and retains late lower sequences as stale', async () => {
    const f = await fixture();
    const e = await evidence(f);
    const newest = await evidence(f, revised(e, 5));
    const late = await evidence(f, revised(e, 2));
    const rev = await revision(f, e);
    const [row] = await prisma.$queryRaw<
      { id: string }[]
    >`SELECT dentabill_batch_latest_evidence(${f.org.id},${rev.batchId}::uuid) AS id`;
    expect(row?.id).toBe(newest.row.id);
    await expect(review(f, e)).rejects.toThrow('REMITTANCE_BATCH_NOT_CURRENT');
    await expect(review(f, late)).rejects.toThrow('REMITTANCE_BATCH_NOT_CURRENT');
    await review(f, late, { decision: 'REJECT' });
    await review(f, newest);
    expect(await prisma.remittanceBatchRevision.count()).toBe(3);
  });
  it('does not make an older accepted revision current when the newest is rejected', async () => {
    const f = await fixture();
    const e = await evidence(f, netPayload());
    const b = await accepted(f, e);
    const c = await cash(f);
    const newest = await evidence(f, revised(e, 1));
    await review(f, newest, { decision: 'REJECT' });
    await expect(match(f, c, b)).rejects.toThrow('CASH_BATCH_BATCH_NOT_CURRENT');
    expect(await prisma.cashBatchMatch.count()).toBe(0);
  });
  it.each([0, -1, 1.5, 2147483648, null, '1'])(
    'rejects invalid sourceSequence %s without leaving identities',
    async (sourceSequence) => {
      const f = await fixture();
      await expect(evidence(f, payload({ schemaVersion: 2, sourceSequence }))).rejects.toThrow();
      expect(await prisma.remittanceBatch.count()).toBe(0);
      expect(await prisma.remittanceBatchRevision.count()).toBe(0);
    },
  );
  it('accepts the maximum sequence, numeric integer JSON and exact nullable baseline ordering', async () => {
    const f = await fixture();
    const e = await evidence(f, payload({ schemaVersion: 2, sourceSequence: 2147483647 }));
    expect(await revision(f, e)).toMatchObject({ schemaVersion: 2, sourceSequence: 2147483647 });
    await review(f, e);
  });
  it('rejects duplicate sequences, changed source events, and later v1 baseline attempts', async () => {
    const f = await fixture();
    const e = await evidence(f);
    await evidence(f, revised(e, 1));
    await expect(evidence(f, revised(e, 1))).rejects.toThrow();
    await expect(
      evidence(f, revised(e, 2, { sourceRecordId: e.payload.sourceRecordId })),
    ).rejects.toThrow();
    await expect(
      evidence(f, payload({ ...e.payload, sourceRecordId: randomUUID() })),
    ).rejects.toThrow('REMITTANCE_BATCH_BASELINE_CONFLICT');
    const v2 = await evidence(f, payload({ schemaVersion: 2, sourceSequence: 1 }));
    await expect(evidence(f, payload({ sourceBatchId: v2.payload.sourceBatchId }))).rejects.toThrow(
      'REMITTANCE_BATCH_BASELINE_CONFLICT',
    );
    expect(await prisma.remittanceBatch.count()).toBe(2);
  });
  it('preserves signed reversal ownership and unchanged source payment amounts across revisions', async () => {
    const f = await fixture();
    const payment = await remittance(f);
    const reversal = await remittance(f, 'ACCEPT', payment);
    const e = await evidence(
      f,
      payload({
        reportedClaimAmount: '-20.00',
        reportedNetAmount: '-20.00',
        claimRemittances: [member(reversal)],
      }),
    );
    await review(f, e);
    const e2 = await evidence(f, revised(e, 1));
    await review(f, e2);
    const wrong = await evidence(
      f,
      revised(e, 2, {
        reportedClaimAmount: '-19.00',
        reportedNetAmount: '-19.00',
        claimRemittances: [{ ...member(reversal), reportedAmount: '-19.00' }],
      }),
    );
    await expect(review(f, wrong)).rejects.toThrow('REMITTANCE_BATCH_MEMBER_MISMATCH');
    expect(
      (
        await prisma.claimRemittanceEvidence.findUniqueOrThrow({ where: { id: reversal.row.id } })
      ).reportedAmount.toFixed(2),
    ).toBe('-20.00');
  });
  it('rolls back automatic ownership when deferred source mirroring fails', async () => {
    const f = await fixture();
    const m = await remittance(f);
    const e = await evidence(
      f,
      payload({
        reportedClaimAmount: '100.00',
        reportedNetAmount: '100.00',
        claimRemittances: [member(m)],
      }),
    );
    await expect(review(f, e, {}, { amount: '99.00' })).rejects.toThrow(
      'REMITTANCE_BATCH_MEMBER_MISMATCH',
    );
    expect(await prisma.remittanceBatchMemberOwnership.count()).toBe(0);
    expect(await prisma.remittanceBatchReview.count()).toBe(0);
    await review(f, e);
    expect(await prisma.remittanceBatchMemberOwnership.count()).toBe(1);
  });
  it('rolls back identity and revision with import/audit transaction failure', async () => {
    const f = await fixture();
    const p = payload();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.remittanceBatchEvidence.create({
          data: {
            organizationId: f.org.id,
            sourceNamespace: p.sourceNamespace,
            sourceBatchId: p.sourceBatchId,
            sourceRecordId: p.sourceRecordId,
            sourceDocumentId: p.sourceDocumentId,
            detailCompleteness: 'COMPLETE',
            reportedClaimAmount: '0',
            reportedAdjustmentAmount: '0',
            reportedNetAmount: '0',
            payload: p,
            contentHash: 'a'.repeat(64),
          },
        });
        throw new Error('AUDIT_ROLLBACK');
      }),
    ).rejects.toThrow('AUDIT_ROLLBACK');
    expect(await prisma.remittanceBatch.count()).toBe(0);
    expect(await prisma.remittanceBatchRevision.count()).toBe(0);
  });
  it('keeps stale cash reservations until explicit release and blocks new revision matching', async () => {
    const f = await fixture();
    const e = await evidence(f, netPayload());
    const b = await accepted(f, e);
    const c = await cash(f);
    const m = await match(f, c, b, '60.00');
    const e2 = await evidence(
      f,
      revised(e, 1, {
        reportedAdjustmentAmount: '40.00',
        reportedNetAmount: '40.00',
        providerAdjustments: [
          adjustment({
            amount: '40.00',
            sourceAmount: '40.00',
            sourceSignConvention: 'NET_EFFECT_POSITIVE',
          }),
        ],
      }),
    );
    const b2 = await accepted(f, e2);
    const freshCash = await cash(f);
    await expect(match(f, freshCash, b2, '10.00')).rejects.toThrow('CASH_BATCH_BATCH_RESERVED');
    await expect(match(f, c, b, '10.00')).rejects.toThrow('CASH_BATCH_BATCH_NOT_CURRENT');
    const rv = await revision(f, e2);
    const [reserved] = await prisma.$queryRaw<
      { amount: Prisma.Decimal }[]
    >`SELECT sum(abs(m.amount)) AS amount FROM "CashBatchMatch" m JOIN "RemittanceBatchRevision" r ON r."evidenceId"=m."batchEvidenceId" AND r."organizationId"=m."organizationId" WHERE r."batchId"=${rv.batchId}::uuid AND m."organizationId"=${f.org.id}`;
    expect(reserved?.amount.toFixed(2)).toBe('60.00');
    await release(f, m);
    await match(f, freshCash, b2, '40.00');
    await expect(match(f, c, b2, '0.01')).rejects.toThrow('CASH_BATCH_CAPACITY_EXCEEDED');
    expect(await prisma.cashBatchMatch.findUnique({ where: { id: m.id } })).toEqual(m);
  });
  it('does not net opposite-sign revision reservations and allows release before debit rematching', async () => {
    const f = await fixture();
    const e = await evidence(f, netPayload());
    const b = await accepted(f, e);
    const c = await cash(f);
    const m = await match(f, c, b);
    const corrected = await evidence(
      f,
      revised(e, 2, {
        reportedAdjustmentAmount: '-100.00',
        reportedNetAmount: '-100.00',
        providerAdjustments: [
          adjustment({
            amount: '-100.00',
            sourceAmount: '-100.00',
            sourceSignConvention: 'NET_EFFECT_POSITIVE',
          }),
        ],
      }),
    );
    const b2 = await accepted(f, corrected);
    const debit = await cash(f, { amount: '-100.00', sourceAmount: '-100.00' });
    await expect(match(f, debit, b2, '-100.00')).rejects.toThrow('CASH_BATCH_BATCH_RESERVED');
    await release(f, m);
    await match(f, debit, b2, '-100.00');
  });
  it('keeps imported incomplete/unknown/unbalanced higher revisions stale without releasing prior reservations', async () => {
    const f = await fixture();
    const e = await evidence(f, netPayload());
    const b = await accepted(f, e);
    const c = await cash(f);
    await match(f, c, b, '20.00');
    const pending = await evidence(
      f,
      revised(e, 1, { detailCompleteness: 'PARTIAL', reportedNetAmount: null }),
    );
    await expect(review(f, pending)).rejects.toThrow('REMITTANCE_BATCH_TOTALS_INVALID');
    await expect(match(f, c, b, '20.00')).rejects.toThrow('CASH_BATCH_BATCH_NOT_CURRENT');
    expect(await prisma.cashBatchRelease.count()).toBe(0);
  });
  it.each([
    'RemittanceBatch',
    'RemittanceBatchRevision',
    'RemittanceBatchMemberOwnership',
  ] as const)('makes %s immutable and scoped', async (table) => {
    const f = await fixture();
    const m = await remittance(f);
    const e = await evidence(
      f,
      payload({
        reportedClaimAmount: '100.00',
        reportedNetAmount: '100.00',
        claimRemittances: [member(m)],
      }),
    );
    await review(f, e);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "${table}" SET "organizationId"="organizationId"`),
    ).rejects.toThrow('REMITTANCE_BATCH_IMMUTABLE');
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "${table}"`)).rejects.toThrow(
      'REMITTANCE_BATCH_IMMUTABLE',
    );
    const other = await fixture();
    const scoped = getOrgScopedDb(other.org.id);
    expect(await scoped.remittanceBatch.findMany()).toEqual([]);
    expect(await scoped.remittanceBatchRevision.findMany()).toEqual([]);
    expect(await scoped.remittanceBatchMemberOwnership.findMany()).toEqual([]);
  });
  it('rejects forged blank identities and cross-source revision/ownership bindings', async () => {
    const f = await fixture();
    const other = await fixture();
    const e = await evidence(f);
    const rev = await revision(f, e);
    await expect(
      prisma.remittanceBatch.create({
        data: {
          organizationId: f.org.id,
          sourceNamespace: 'synthetic',
          sourceBatchId: randomUUID(),
        },
      }),
    ).rejects.toThrow('REMITTANCE_BATCH_IDENTITY_INVALID');
    await expect(
      prisma.remittanceBatchRevision.create({
        data: {
          evidenceId: e.row.id,
          organizationId: other.org.id,
          batchId: rev.batchId,
          schemaVersion: 1,
          sourceSequence: null,
        },
      }),
    ).rejects.toThrow('REMITTANCE_BATCH_REVISION_BINDING_INVALID');
    await expect(
      prisma.remittanceBatchRevision.create({
        data: {
          evidenceId: randomUUID(),
          organizationId: f.org.id,
          batchId: rev.batchId,
          schemaVersion: 2,
          sourceSequence: 9,
        },
      }),
    ).rejects.toThrow('REMITTANCE_BATCH_REVISION_BINDING_INVALID');
    await expect(
      prisma.remittanceBatchMemberOwnership.create({
        data: {
          organizationId: f.org.id,
          batchId: rev.batchId,
          remittanceEvidenceId: randomUUID(),
          firstMemberId: randomUUID(),
        },
      }),
    ).rejects.toThrow('REMITTANCE_BATCH_OWNER_BINDING_INVALID');
    await expect(
      prisma.remittanceBatch.update({ where: { id: rev.batchId }, data: { sourceBatchId: 'new' } }),
    ).rejects.toBeInstanceOf(MissingOrgScopeError);
  });
  it('admits one same-sequence writer without duplicate stable identities', async () => {
    const f = await fixture();
    const p = payload({ schemaVersion: 2, sourceSequence: 1 });
    const results = await Promise.allSettled([
      evidence(f, p),
      evidence(f, { ...p, sourceRecordId: randomUUID() }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.remittanceBatch.count()).toBe(1);
    expect(await prisma.remittanceBatchRevision.count()).toBe(1);
  });
  it('fences repeatable-read review snapshots when a newer revision commits', async () => {
    const f = await fixture();
    const e = await evidence(f);
    let ready!: () => void;
    let next!: () => void;
    const observed = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      next = resolve;
    });
    const result = prisma
      .$transaction(
        async (tx) => {
          await tx.organization.findUniqueOrThrow({ where: { id: f.org.id } });
          ready();
          await gate;
          return createReview(tx, f, e);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      )
      .then(
        () => false,
        () => true,
      );
    await observed;
    await evidence(f, revised(e, 1));
    next();
    expect(await result).toBe(true);
    expect(await prisma.remittanceBatchReview.count()).toBe(0);
  });
  it('preserves numeric JSON integer parity when direct SQL stores 2.0 and 1.0', async () => {
    const f = await fixture();
    const p = payload({ schemaVersion: 2, sourceSequence: 1 });
    const id = randomUUID();
    await prisma.$executeRaw`INSERT INTO "RemittanceBatchEvidence" (id,"organizationId","sourceNamespace","sourceBatchId","sourceRecordId","sourceDocumentId","detailCompleteness","reportedClaimAmount","reportedAdjustmentAmount","reportedNetAmount",payload,"contentHash")
      VALUES (${id}::uuid,${f.org.id},${p.sourceNamespace},${p.sourceBatchId},${p.sourceRecordId},${p.sourceDocumentId},'COMPLETE',0,0,0,
       jsonb_set(jsonb_set(${JSON.stringify(p)}::jsonb,'{schemaVersion}','2.0'::jsonb),'{sourceSequence}','1.0'::jsonb),${'a'.repeat(64)})`;
    expect(
      await prisma.remittanceBatchRevision.findFirst({
        where: { evidenceId: id, organizationId: f.org.id },
      }),
    ).toMatchObject({ schemaVersion: 2, sourceSequence: 1 });
  });
  it('allows only one stable batch to acquire an event under concurrent acceptance and rejects the loser on retry', async () => {
    const f = await fixture();
    const m = await remittance(f);
    const p = payload({
      reportedClaimAmount: '100.00',
      reportedNetAmount: '100.00',
      claimRemittances: [member(m)],
    });
    const a = await evidence(f, p);
    const b = await evidence(
      f,
      payload({ ...p, sourceBatchId: randomUUID(), sourceRecordId: randomUUID() }),
    );
    const outcomes = await Promise.allSettled([review(f, a), review(f, b)]);
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const loser = outcomes[0].status === 'fulfilled' ? b : a;
    await expect(review(f, loser)).rejects.toThrow('REMITTANCE_BATCH_MEMBER_OWNED');
    expect(await prisma.remittanceBatchMemberOwnership.count()).toBe(1);
    expect(await prisma.remittanceBatchClaim.count()).toBe(1);
  });
  it('fences repeatable-read cash matches when a newer batch revision commits', async () => {
    const f = await fixture();
    const e = await evidence(f, netPayload());
    const b = await accepted(f, e);
    const c = await cash(f);
    let ready!: () => void;
    let next!: () => void;
    const observed = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      next = resolve;
    });
    const result = prisma
      .$transaction(
        async (tx) => {
          await tx.organization.findUniqueOrThrow({ where: { id: f.org.id } });
          ready();
          await gate;
          return createMatch(tx, f, c, b);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      )
      .then(
        () => false,
        () => true,
      );
    await observed;
    await evidence(f, revised(e, 1));
    next();
    expect(await result).toBe(true);
    expect(await prisma.cashBatchMatch.count()).toBe(0);
  });
});

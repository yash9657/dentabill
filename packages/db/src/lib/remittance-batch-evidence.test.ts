import { randomUUID } from 'node:crypto';

import {
  Prisma,
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

describe('remittance batch source evidence', () => {
  it('retains payment/reversal members and raw provider adjustments without modifying claim or remittance state', async () => {
    const f = await fixture();
    const payment = await remittance(f);
    const reversal = await remittance(f, 'ACCEPT', payment);
    const before = await prisma.claim.findUniqueOrThrow({ where: { id: f.claim.id } });
    const e = await evidence(
      f,
      payload({
        reportedClaimAmount: '80.00',
        reportedAdjustmentAmount: '-5.00',
        reportedNetAmount: '75.00',
        claimRemittances: [member(payment), member(reversal)],
        providerAdjustments: [adjustment()],
      }),
    );
    const r = await review(f, e);
    expect(r.netAmount?.toFixed(2)).toBe('75.00');
    expect(
      await prisma.remittanceBatchClaim.count({
        where: { organizationId: f.org.id, reviewId: r.id },
      }),
    ).toBe(2);
    expect(
      await prisma.remittanceBatchAdjustment.findFirst({ where: { organizationId: f.org.id } }),
    ).toMatchObject({
      reasonCode: 'ZZ-unknown',
      sourceReference: '000-ref',
      sourceSignConvention: 'REDUCTION_POSITIVE',
    });
    expect(await prisma.claim.findUniqueOrThrow({ where: { id: f.claim.id } })).toEqual(before);
    expect(
      await prisma.claimRemittanceReview.findUnique({ where: { id: payment.review?.id } }),
    ).toEqual(payment.review);
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).updatedAt,
    ).toEqual(f.org.updatedAt);
  });
  it('keeps zero, positive and negative provider-only net evidence distinct', async () => {
    const f = await fixture();
    for (const amount of ['0.00', '5.00', '-5.00']) {
      const e = await evidence(
        f,
        payload({
          reportedAdjustmentAmount: amount,
          reportedNetAmount: amount,
          providerAdjustments: [
            adjustment({
              amount,
              sourceAmount: amount,
              sourceSignConvention: 'NET_EFFECT_POSITIVE',
            }),
          ],
        }),
      );
      expect((await review(f, e)).netAmount?.toFixed(2)).toBe(amount);
    }
  });
  it.each([
    { detailCompleteness: 'PARTIAL' },
    { detailCompleteness: 'ABSENT' },
    { reportedNetAmount: null },
    { reportedNetAmount: '1.00' },
    { reportedClaimAmount: '2.00' },
    { reportedAdjustmentAmount: '3.00' },
  ])('imports but does not accept incomplete or unbalanced source %j', async (overrides) => {
    const f = await fixture();
    const e = await evidence(f, payload(overrides));
    await expect(review(f, e)).rejects.toThrow();
    const rejected = await review(f, e, { decision: 'REJECT' });
    expect(rejected).toMatchObject({
      claimReportedAmount: null,
      providerAdjustmentAmount: null,
      netAmount: null,
      claimCount: 0,
      adjustmentCount: 0,
    });
  });
  it.each([
    { currency: 'EUR' },
    { payerName: '\u00a0payer' },
    { payerName: 'payer\u0085name' },
    { payerIdentifier: 'a\u200db' },
    { sourceVersion: '😀'.repeat(101) },
    { reportedNetAmount: '-0.00' },
    { reportedNetAmount: '00.00' },
    { reportedNetAmount: 0 },
    { reportedDate: '2026-02-30' },
    { reportedDate: '0000-01-01' },
    { unknown: true },
    {
      claimRemittances: [
        { sourceNamespace: 'bad namespace', sourceRecordId: 'x', reportedAmount: '0.00' },
      ],
    },
    { providerAdjustments: [adjustment({ sourceAmount: '-5.00' })] },
    { providerAdjustments: [adjustment({ reasonCode: '\ufeffXX' })] },
    { providerAdjustments: [adjustment({ fiscalPeriodEnd: '2026-02-29' })] },
    { providerAdjustments: [adjustment(), adjustment()] },
  ])('rejects malformed direct database evidence %j', async (overrides) => {
    const f = await fixture();
    const p = { ...payload(), ...overrides } as Payload;
    await expect(evidence(f, p)).rejects.toThrow();
  });
  it('enforces exact payload shape, unique members and100-element bounds', async () => {
    const f = await fixture();
    const m = { sourceNamespace: 'synthetic', sourceRecordId: 'same', reportedAmount: '0.00' };
    await expect(evidence(f, payload({ claimRemittances: [m, m] }))).rejects.toThrow();
    await expect(
      evidence(f, payload({ detailCompleteness: 'ABSENT', claimRemittances: [m] })),
    ).rejects.toThrow();
    await expect(
      evidence(
        f,
        payload({
          claimRemittances: Array.from({ length: 101 }, (_, i) => ({
            ...m,
            sourceRecordId: String(i),
          })),
        }),
      ),
    ).rejects.toThrow();
    await expect(
      evidence(
        f,
        payload({
          providerAdjustments: Array.from({ length: 101 }, (_, i) =>
            adjustment({ sourceAdjustmentId: String(i) }),
          ),
        }),
      ),
    ).rejects.toThrow();
    const p = { ...payload() };
    delete p.payerName;
    await expect(evidence(f, p)).rejects.toThrow();
    await expect(evidence(f, payload(), { sourceBatchId: 'mismatch' })).rejects.toThrow();
  });
  it('accepts exact Unicode token boundaries and interior whitespace without changing source identity', async () => {
    const f = await fixture();
    const p = payload({ sourceVersion: '😀'.repeat(100), payerName: 'Synthetic\u00a0payer' });
    expect((await evidence(f, p)).row.payload).toEqual(p);
  });
  it('requires independent immutable batch and record identity within each namespace and tenant', async () => {
    const f = await fixture();
    const p = payload();
    await evidence(f, p);
    await expect(evidence(f, { ...p, sourceRecordId: randomUUID() })).rejects.toThrow();
    await expect(evidence(f, { ...p, sourceBatchId: randomUUID() })).rejects.toThrow();
    await evidence(f, { ...p, sourceNamespace: 'other' });
    await evidence(await fixture(), p);
  });
  it.each(['REJECT', null] as const)(
    'does not accept a member whose claim evidence decision is %s',
    async (decision) => {
      const f = await fixture();
      const m = await remittance(f, decision);
      const e = await evidence(
        f,
        payload({
          reportedClaimAmount: '100.00',
          reportedNetAmount: '100.00',
          claimRemittances: [member(m)],
        }),
      );
      await expect(review(f, e)).rejects.toThrow();
    },
  );
  it('rejects partial allocations and permanent reuse even after the payment is reversed', async () => {
    const f = await fixture();
    const m = await remittance(f);
    const partial = await evidence(
      f,
      payload({
        reportedClaimAmount: '50.00',
        reportedNetAmount: '50.00',
        claimRemittances: [{ ...member(m), reportedAmount: '50.00' }],
      }),
    );
    await expect(review(f, partial)).rejects.toThrow();
    const p = payload({
      reportedClaimAmount: '100.00',
      reportedNetAmount: '100.00',
      claimRemittances: [member(m)],
    });
    await review(f, await evidence(f, p));
    await remittance(f, 'ACCEPT', m);
    const duplicate = await evidence(f, {
      ...p,
      sourceBatchId: randomUUID(),
      sourceRecordId: randomUUID(),
    });
    await expect(review(f, duplicate)).rejects.toThrow();
  });
  it.each([
    { ledgerVersion: '0:0' },
    { evidenceHash: 'f'.repeat(64) },
    { reviewedByRole: 'ADMIN' },
    { netAmount: '1.00' },
    { claimCount: 1 },
    { decision: 'REJECT', netAmount: '0.00' },
  ])('rejects invalid direct review %j', async (overrides) => {
    const f = await fixture();
    const e = await evidence(f);
    await expect(
      review(f, e, overrides as Partial<Prisma.RemittanceBatchReviewUncheckedCreateInput>),
    ).rejects.toThrow();
  });
  it('rejects foreign actor, foreign evidence and cross-tenant member links', async () => {
    const f = await fixture();
    const other = await fixture();
    const foreign = await remittance(other);
    const e = await evidence(f);
    await expect(review(f, e, { reviewedByUserId: other.user.id })).rejects.toThrow();
    await expect(review(other, e)).rejects.toThrow();
    const local = await remittance(f);
    const linked = await evidence(
      f,
      payload({
        reportedClaimAmount: '100.00',
        reportedNetAmount: '100.00',
        claimRemittances: [member(local)],
      }),
    );
    await expect(
      review(
        f,
        linked,
        {},
        {
          claimId: other.claim.id,
          remittanceEvidenceId: foreign.row.id,
          remittanceReviewId: foreign.review?.id ?? randomUUID(),
        },
      ),
    ).rejects.toThrow();
  });
  it.each([
    { sourceIndex: 1 },
    { amount: '99.00' },
    { batchEvidenceId: randomUUID() },
    { remittanceReviewId: randomUUID() },
  ])('seals exact claim membership at deferred commit %j', async (override) => {
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
    await expect(review(f, e, {}, override)).rejects.toThrow();
    expect(await prisma.remittanceBatchReview.count({ where: { organizationId: f.org.id } })).toBe(
      0,
    );
  });
  it.each([
    { sourceIndex: 1 },
    { sourceAdjustmentId: 'other' },
    { reasonCode: 'other' },
    { codeSystem: 'other' },
    { sourceReference: null },
    { providerIdentifier: null },
    { fiscalPeriodEnd: null },
    { amount: '5.00', sourceAmount: '-5.00' },
    { sourceAmount: '-5.00', sourceSignConvention: 'NET_EFFECT_POSITIVE' },
  ])('seals every provider adjustment source field %j', async (override) => {
    const f = await fixture();
    const e = await evidence(
      f,
      payload({
        reportedAdjustmentAmount: '-5.00',
        reportedNetAmount: '-5.00',
        providerAdjustments: [adjustment()],
      }),
    );
    await expect(review(f, e, {}, {}, override)).rejects.toThrow();
  });
  it('blocks post-commit children, updates and deletes for all batch models', async () => {
    const f = await fixture();
    const m = await remittance(f);
    const e = await evidence(
      f,
      payload({
        reportedClaimAmount: '100.00',
        reportedAdjustmentAmount: '-5.00',
        reportedNetAmount: '95.00',
        claimRemittances: [member(m)],
        providerAdjustments: [adjustment()],
      }),
    );
    const r = await review(f, e);
    const rejected = await review(f, await evidence(f), { decision: 'REJECT' });
    const a = await prisma.remittanceBatchAdjustment.findFirstOrThrow({
      where: { organizationId: f.org.id },
    });
    await expect(
      prisma.remittanceBatchAdjustment.create({
        data: { ...a, id: randomUUID(), reviewId: rejected.id },
      }),
    ).rejects.toThrow();
    for (const table of [
      'RemittanceBatchEvidence',
      'RemittanceBatchReview',
      'RemittanceBatchClaim',
      'RemittanceBatchAdjustment',
    ]) {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "${table}" SET id = id WHERE "organizationId" = $1`,
          f.org.id,
        ),
      ).rejects.toThrow('REMITTANCE_BATCH_IMMUTABLE');
      await expect(
        prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = $1`, f.org.id),
      ).rejects.toThrow('REMITTANCE_BATCH_IMMUTABLE');
    }
    await expect(prisma.organization.delete({ where: { id: f.org.id } })).rejects.toThrow();
    expect(await prisma.remittanceBatchReview.findUnique({ where: { id: r.id } })).toEqual(r);
  });
  it.each([
    Prisma.TransactionIsolationLevel.ReadCommitted,
    Prisma.TransactionIsolationLevel.RepeatableRead,
  ])(
    'serializes duplicate member reviews under %s and preserves Organization.updatedAt',
    async (isolationLevel) => {
      const f = await fixture();
      const m = await remittance(f);
      const p = {
        reportedClaimAmount: '100.00',
        reportedNetAmount: '100.00',
        claimRemittances: [member(m)],
      };
      const first = await evidence(f, payload(p));
      const second = await evidence(f, payload(p));
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
          prisma.$transaction((tx) => createReview(tx, f, e, {}, {}, {}, barrier), {
            isolationLevel,
            timeout: 10_000,
          }),
        ),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(await prisma.remittanceBatchClaim.count({ where: { organizationId: f.org.id } })).toBe(
        1,
      );
      const remaining = await prisma.remittanceBatchEvidence.findFirstOrThrow({
        where: { organizationId: f.org.id, review: null },
      });
      await expect(review(f, remaining.id === first.row.id ? first : second)).rejects.toThrow();
      expect(
        (await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).updatedAt,
      ).toEqual(f.org.updatedAt);
    },
  );
  it('scopes all four models for reads and refuses unscoped writes', async () => {
    const f = await fixture();
    const other = await fixture();
    for (const parent of [f, other]) {
      const m = await remittance(parent);
      await review(
        parent,
        await evidence(
          parent,
          payload({
            reportedClaimAmount: '100.00',
            reportedAdjustmentAmount: '-5.00',
            reportedNetAmount: '95.00',
            claimRemittances: [member(m)],
            providerAdjustments: [adjustment()],
          }),
        ),
      );
    }
    const db = getOrgScopedDb(f.org.id);
    expect(await db.remittanceBatchEvidence.count()).toBe(1);
    expect(await db.remittanceBatchReview.count()).toBe(1);
    expect(await db.remittanceBatchClaim.count()).toBe(1);
    expect(await db.remittanceBatchAdjustment.count()).toBe(1);
    expect(
      await db.remittanceBatchEvidence.findFirst({ where: { organizationId: other.org.id } }),
    ).toMatchObject({ organizationId: f.org.id });
    expect((await db.remittanceBatchClaim.aggregate({ _count: true }))._count).toBe(1);
    expect(
      await db.remittanceBatchAdjustment.groupBy({ by: ['organizationId'], _count: true }),
    ).toEqual([{ organizationId: f.org.id, _count: 1 }]);
    await expect(prisma.remittanceBatchEvidence.deleteMany()).rejects.toThrow(MissingOrgScopeError);
    await expect(prisma.remittanceBatchReview.deleteMany()).rejects.toThrow(MissingOrgScopeError);
    await expect(prisma.remittanceBatchClaim.deleteMany()).rejects.toThrow(MissingOrgScopeError);
    await expect(prisma.remittanceBatchAdjustment.deleteMany()).rejects.toThrow(
      MissingOrgScopeError,
    );
  });
});

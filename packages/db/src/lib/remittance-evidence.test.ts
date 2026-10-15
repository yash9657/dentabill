import { randomUUID } from 'node:crypto';

import {
  Prisma,
  type Claim,
  type ClaimRemittanceEvidence,
  type ClaimRemittanceReview,
  type User,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { prisma } from '../client.js';

import { MissingOrgScopeError } from './errors.js';
import { getOrgScopedDb } from './with-org.js';

interface AllocationInput extends Prisma.InputJsonObject {
  sourceLineId: string;
  amount: string;
  sourceStatus: string | null;
}
interface AdjustmentInput extends Prisma.InputJsonObject {
  sourceAdjustmentId: string;
  sourceLineId: string | null;
  codeSystem: string;
  groupCode: string | null;
  reasonCode: string;
  amount: string;
  sourceReference: string | null;
}
interface Payload extends Prisma.InputJsonObject {
  schemaVersion: number;
  sourceNamespace: string;
  sourceRecordId: string;
  sourceDocumentId: string;
  sourceVersion: string | null;
  kind: 'PAYMENT' | 'REVERSAL';
  reversesSourceRecordId: string | null;
  currency: string;
  reportedAmount: string;
  payerName: string;
  payerIdentifier: string | null;
  payerIdentifierSystem: string | null;
  payerClaimControlNumber: string | null;
  sourceCoverageId: string | null;
  paymentTrace: string | null;
  paymentTraceType: string | null;
  paymentTraceIssuer: string | null;
  reportedDate: string | null;
  sourceStatus: string | null;
  lineDetailCompleteness: 'COMPLETE' | 'PARTIAL' | 'ABSENT';
  allocations: AllocationInput[];
  adjustments: AdjustmentInput[];
}
interface Fixture {
  claim: Claim;
  user: User;
  lineIds: [string, string];
}
interface Evidence {
  row: ClaimRemittanceEvidence;
  payload: Payload;
}
interface ReviewOptions {
  decision?: 'ACCEPT' | 'REJECT';
  original?: Evidence;
  review?: Partial<Prisma.ClaimRemittanceReviewUncheckedCreateInput>;
  allocations?: Partial<Prisma.ClaimRemittanceAllocationCreateManyInput>;
  adjustments?: Partial<Prisma.ClaimRemittanceAdjustmentCreateManyInput>;
  skipChildren?: boolean;
}
function payload(overrides: Partial<Payload> = {}): Payload {
  return {
    schemaVersion: 1,
    sourceNamespace: 'synthetic-ledger',
    sourceRecordId: randomUUID(),
    sourceDocumentId: 'synthetic-document',
    sourceVersion: null,
    kind: 'PAYMENT',
    reversesSourceRecordId: null,
    currency: 'USD',
    reportedAmount: '100.00',
    payerName: 'Synthetic payer',
    payerIdentifier: '000-payer',
    payerIdentifierSystem: 'synthetic-system',
    payerClaimControlNumber: null,
    sourceCoverageId: null,
    paymentTrace: null,
    paymentTraceType: null,
    paymentTraceIssuer: null,
    reportedDate: '2026-01-02',
    sourceStatus: null,
    lineDetailCompleteness: 'PARTIAL',
    allocations: [{ sourceLineId: 'line-0', amount: '60.00', sourceStatus: null }],
    adjustments: [
      {
        sourceAdjustmentId: 'adjustment-0',
        sourceLineId: 'line-0',
        codeSystem: 'source-code',
        groupCode: 'CO',
        reasonCode: '50',
        amount: '20.00',
        sourceReference: null,
      },
    ],
    ...overrides,
  };
}
async function fixture(): Promise<Fixture> {
  const organization = await prisma.organization.create({
    data: { name: 'Synthetic remittance', clerkOrgId: `synthetic_${randomUUID()}` },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      clerkUserId: `synthetic_${randomUUID()}`,
      email: 'synthetic@example.invalid',
      role: 'BILLING_STAFF',
    },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: organization.id,
      patientDOBHash: 'synthetic-only',
      claimNumber: 'SYNTHETIC',
      claimAmount: '100.00',
      payerCode: 'UNKNOWN',
      cdtCodes: ['D2740'],
      serviceDate: new Date('2026-01-01'),
      sourceSystem: 'OPEN_DENTAL',
      sourceNamespace: 'synthetic',
      sourceClaimId: '0001',
      sourceContentHash: 'a'.repeat(64),
    },
  });
  const lineIds: [string, string] = [randomUUID(), randomUUID()];
  await prisma.$transaction(async (tx) => {
    await tx.claimSourceDetails.create({
      data: {
        claimId: claim.id,
        organizationId: claim.organizationId,
        importedClaimAmount: '100.00',
        lineCount: 2,
        coverageCount: 1,
      },
    });
    await tx.claimSourceLine.createMany({
      data: lineIds.map((id, position) => ({
        id,
        claimId: claim.id,
        organizationId: claim.organizationId,
        sourceLineId: `line-${String(position)}`,
        position,
        procedureCode: 'D2740',
        serviceDate: new Date('2026-01-01'),
        billedAmount: '50.00',
      })),
    });
    await tx.claimSourceCoverage.create({
      data: {
        claimId: claim.id,
        organizationId: claim.organizationId,
        sourceCoverageId: 'coverage-0',
        sequence: 1,
        payerName: 'Synthetic payer',
        isClaimCoverage: true,
      },
    });
  });
  return { claim, user, lineIds };
}
async function evidence(
  parent: Fixture,
  p = payload(),
  overrides: Partial<Prisma.ClaimRemittanceEvidenceUncheckedCreateInput> = {},
): Promise<Evidence> {
  const row = await prisma.claimRemittanceEvidence.create({
    data: {
      organizationId: parent.claim.organizationId,
      claimId: parent.claim.id,
      sourceNamespace: p.sourceNamespace,
      sourceRecordId: p.sourceRecordId,
      sourceDocumentId: p.sourceDocumentId,
      sourceVersion: p.sourceVersion,
      kind: p.kind,
      reversesSourceRecordId: p.reversesSourceRecordId,
      reportedAmount: p.reportedAmount,
      currency: p.currency,
      payload: p,
      contentHash: 'a'.repeat(64),
      ...overrides,
    },
  });
  return { row, payload: p };
}
async function createReview(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  parent: Fixture,
  e: Evidence,
  options: ReviewOptions = {},
  beforeInsert?: () => Promise<void>,
): Promise<ClaimRemittanceReview> {
  const scope = { organizationId: parent.claim.organizationId, claimId: parent.claim.id };
  const current = await tx.claim.findFirstOrThrow({
    where: { id: parent.claim.id, organizationId: parent.claim.organizationId },
  });
  const evidenceCount = await tx.claimRemittanceEvidence.count({ where: scope });
  const reviewCount = await tx.claimRemittanceReview.count({ where: scope });
  if (beforeInsert) await beforeInsert();
  const accepted = options.decision !== 'REJECT';
  const r = await tx.claimRemittanceReview.create({
    data: {
      ...scope,
      evidenceId: e.row.id,
      decision: options.decision ?? 'ACCEPT',
      reviewedByUserId: parent.user.id,
      idempotencyKey: randomUUID(),
      requestHash: 'b'.repeat(64),
      reviewToken: 'c'.repeat(64),
      evidenceHash: e.row.contentHash,
      claimUpdatedAt: current.updatedAt,
      ledgerVersion: `${String(evidenceCount)}:${String(reviewCount)}`,
      reversedEvidenceId: accepted ? (options.original?.row.id ?? null) : null,
      reportedAmount: accepted ? e.row.reportedAmount : '0.00',
      allocationCount: accepted ? e.payload.allocations.length : 0,
      adjustmentCount: accepted ? e.payload.adjustments.length : 0,
      ...options.review,
    },
  });
  if (!accepted || options.skipChildren) return r;
  for (const [sourceIndex, item] of e.payload.allocations.entries()) {
    const line = await tx.claimSourceLine.findFirstOrThrow({
      where: { ...scope, sourceLineId: item.sourceLineId },
    });
    await tx.claimRemittanceAllocation.create({
      data: {
        ...scope,
        reviewId: r.id,
        sourceIndex,
        lineId: line.id,
        amount: item.amount,
        ...options.allocations,
      },
    });
  }
  for (const [sourceIndex, item] of e.payload.adjustments.entries()) {
    const line =
      item.sourceLineId === null
        ? null
        : await tx.claimSourceLine.findFirstOrThrow({
            where: { ...scope, sourceLineId: item.sourceLineId },
          });
    await tx.claimRemittanceAdjustment.create({
      data: {
        ...scope,
        reviewId: r.id,
        sourceIndex,
        sourceAdjustmentId: item.sourceAdjustmentId,
        lineId: line?.id ?? null,
        codeSystem: item.codeSystem,
        groupCode: item.groupCode,
        reasonCode: item.reasonCode,
        amount: item.amount,
        ...options.adjustments,
      },
    });
  }
  return r;
}
async function review(
  parent: Fixture,
  e: Evidence,
  options: ReviewOptions = {},
): Promise<ClaimRemittanceReview> {
  return prisma.$transaction((tx) => createReview(tx, parent, e, options));
}
async function reversal(
  parent: Fixture,
  original: Evidence,
  amount = '-50.00',
  allocation = '-30.00',
  adjustment = '-10.00',
  overrides: Partial<Payload> = {},
): Promise<Evidence> {
  return evidence(
    parent,
    payload({
      kind: 'REVERSAL',
      reversesSourceRecordId: original.row.sourceRecordId,
      reportedAmount: amount,
      allocations: [{ sourceLineId: 'line-0', amount: allocation, sourceStatus: null }],
      adjustments: [{ ...payload().adjustments[0]!, amount: adjustment }],
      ...overrides,
    }),
  );
}
async function reviewCount(parent: Fixture): Promise<number> {
  return prisma.claimRemittanceReview.count({
    where: { organizationId: parent.claim.organizationId, claimId: parent.claim.id },
  });
}

describe('immutable remittance evidence ledger', () => {
  it('retains evidence and exact line/adjustment decomposition without changing financial/workflow fields', async () => {
    const parent = await fixture();
    const e = await evidence(parent);
    const before = await prisma.claim.findFirstOrThrow({
      where: { id: parent.claim.id, organizationId: parent.claim.organizationId },
    });
    const r = await review(parent, e);
    expect(r.reportedAmount.toFixed(2)).toBe('100.00');
    expect(
      await prisma.claimRemittanceAllocation.findMany({
        where: { organizationId: parent.claim.organizationId, reviewId: r.id },
      }),
    ).toMatchObject([
      { sourceIndex: 0, lineId: parent.lineIds[0], amount: new Prisma.Decimal(60) },
    ]);
    expect(
      await prisma.claimRemittanceAdjustment.findMany({
        where: { organizationId: parent.claim.organizationId, reviewId: r.id },
      }),
    ).toMatchObject([{ sourceIndex: 0, sourceAdjustmentId: 'adjustment-0', reasonCode: '50' }]);
    expect(
      await prisma.claim.findFirstOrThrow({
        where: { id: parent.claim.id, organizationId: parent.claim.organizationId },
      }),
    ).toEqual(before);
  });
  it('allows unknown original evidence to arrive before payment and blocks acceptance until accepted original exists', async () => {
    const parent = await fixture();
    const originalPayload = payload({ sourceRecordId: 'original' });
    const unbound = await evidence(
      parent,
      payload({
        kind: 'REVERSAL',
        reversesSourceRecordId: 'original',
        reportedAmount: '-10.00',
        allocations: [],
        adjustments: [],
        lineDetailCompleteness: 'ABSENT',
      }),
    );
    await expect(review(parent, unbound)).rejects.toThrow();
    const original = await evidence(parent, originalPayload);
    await expect(review(parent, unbound, { original })).rejects.toThrow();
    await review(parent, original);
    await review(parent, unbound, { original });
    expect(await reviewCount(parent)).toBe(2);
  });
  it('records rejection with zero amount and no children even when referenced original is missing', async () => {
    const parent = await fixture();
    const e = await evidence(
      parent,
      payload({
        kind: 'REVERSAL',
        reversesSourceRecordId: 'missing',
        reportedAmount: '-100.00',
        allocations: [],
        adjustments: [],
        lineDetailCompleteness: 'ABSENT',
      }),
    );
    const r = await review(parent, e, { decision: 'REJECT' });
    expect(r).toMatchObject({
      decision: 'REJECT',
      reversedEvidenceId: null,
      allocationCount: 0,
      adjustmentCount: 0,
    });
    expect(r.reportedAmount.toFixed(2)).toBe('0.00');
    await expect(review(parent, e)).rejects.toThrow();
  });
  it('accepts two partial reversals exactly exhausting payment, line, residual, and adjustment amounts', async () => {
    const parent = await fixture();
    const original = await evidence(parent);
    await review(parent, original);
    const first = await reversal(parent, original);
    await review(parent, first, { original });
    const second = await reversal(parent, original);
    await review(parent, second, { original });
    expect(
      (
        await prisma.claimRemittanceReview.aggregate({
          where: { organizationId: parent.claim.organizationId },
          _sum: { reportedAmount: true },
        })
      )._sum.reportedAmount?.toFixed(2),
    ).toBe('0.00');
    const third = await reversal(parent, original, '-0.01', '0.00', '0.00');
    await expect(review(parent, third, { original })).rejects.toThrow();
    expect(await reviewCount(parent)).toBe(3);
  });
  it.each([
    ['header', '-100.01', '-60.00', '-20.00'],
    ['line', '-100.00', '-60.01', '-20.00'],
    ['unallocated', '-100.00', '-59.99', '-20.00'],
    ['adjustment', '-100.00', '-60.00', '-20.01'],
    ['same-sign adjustment', '-100.00', '-60.00', '1.00'],
  ])(
    'rejects reversal exceeding %s independently',
    async (_label, amount, allocation, adjustment) => {
      const parent = await fixture();
      const original = await evidence(parent);
      await review(parent, original);
      const e = await reversal(parent, original, amount, allocation, adjustment);
      await expect(review(parent, e, { original })).rejects.toThrow();
      expect(await reviewCount(parent)).toBe(1);
    },
  );
  it('caps negative and zero original adjustments without assuming positive adjustment semantics', async () => {
    const parent = await fixture();
    const original = await evidence(
      parent,
      payload({
        adjustments: [
          { ...payload().adjustments[0]!, amount: '-10.00' },
          {
            sourceAdjustmentId: 'zero',
            sourceLineId: null,
            codeSystem: 'unknown',
            groupCode: null,
            reasonCode: 'opaque',
            amount: '0.00',
            sourceReference: null,
          },
        ],
      }),
    );
    await review(parent, original);
    const good = await reversal(parent, original, '-50.00', '-30.00', '10.00', {
      adjustments: [
        { ...original.payload.adjustments[0]!, amount: '10.00' },
        { ...original.payload.adjustments[1]!, amount: '0.00' },
      ],
    });
    await review(parent, good, { original });
    const over = await reversal(parent, original, '-50.00', '-30.00', '0.01');
    await expect(review(parent, over, { original })).rejects.toThrow();
    const zero = await reversal(parent, original, '-50.00', '-30.00', '0.00', {
      adjustments: [{ ...original.payload.adjustments[1]!, amount: '-0.01' }],
    });
    await expect(review(parent, zero, { original })).rejects.toThrow();
  });
  it.each(['payerName', 'payerIdentifier', 'payerIdentifierSystem', 'sourceCoverageId'] as const)(
    'rejects reversal with different %s',
    async (field) => {
      const parent = await fixture();
      const original = await evidence(parent);
      await review(parent, original);
      const e = await reversal(parent, original, '-50.00', '-30.00', '-10.00', {
        [field]: field === 'sourceCoverageId' ? 'coverage-0' : 'other',
      });
      await expect(review(parent, e, { original })).rejects.toThrow();
    },
  );
  it.each(['sourceAdjustmentId', 'sourceLineId', 'codeSystem', 'groupCode', 'reasonCode'] as const)(
    'rejects reversal with mismatched adjustment %s',
    async (field) => {
      const parent = await fixture();
      const original = await evidence(parent);
      await review(parent, original);
      const e = await reversal(parent, original, '-50.00', '-30.00', '-10.00', {
        adjustments: [
          {
            ...payload().adjustments[0]!,
            amount: '-10.00',
            [field]: field === 'sourceLineId' ? 'line-1' : 'other',
          },
        ],
      });
      await expect(review(parent, e, { original })).rejects.toThrow();
    },
  );
  it('rejects reversal targets in a different namespace or different claim', async () => {
    const parent = await fixture();
    const other = await fixture();
    const original = await evidence(parent);
    await review(parent, original);
    const badNamespace = await reversal(parent, original, '-50.00', '-30.00', '-10.00', {
      sourceNamespace: 'other',
    });
    await expect(review(parent, badNamespace, { original })).rejects.toThrow();
    const crossClaim = await reversal(other, original);
    await expect(review(other, crossClaim, { original })).rejects.toThrow();
  });
  it.each([
    { reportedAmount: '-1.00' },
    { currency: 'EUR' },
    { sourceNamespace: 'Invalid Namespace' },
    { reportedAmount: 'NaN' },
    { contentHash: 'not-a-hash' },
    { sourceVersion: '' },
  ] satisfies Partial<Prisma.ClaimRemittanceEvidenceUncheckedCreateInput>[])(
    'rejects invalid evidence scalar fields %j',
    async (overrides) => {
      const parent = await fixture();
      await expect(evidence(parent, payload(), overrides)).rejects.toThrow();
    },
  );
  it.each([
    { schemaVersion: 2 },
    { extra: 'unrecognized' },
    { allocations: null },
    { reportedDate: '2026-02-30' },
    { reportedDate: '0000-01-01' },
    { reportedAmount: '100.001' },
    { reportedAmount: '-0.00' },
    { payerName: '' },
    { sourceStatus: 'synthetic\ncontrol' },
    { payerIdentifier: 123 },
    { lineDetailCompleteness: 'COMPLETE' },
    { lineDetailCompleteness: 'ABSENT' },
    { allocations: [{ sourceLineId: 'line-0', amount: '-1.00', sourceStatus: null }] },
    {
      allocations: [
        { sourceLineId: 'line-0', amount: '60.00', sourceStatus: null },
        { sourceLineId: 'line-0', amount: '1.00', sourceStatus: null },
      ],
    },
    {
      adjustments: [
        {
          sourceAdjustmentId: 'a',
          sourceLineId: null,
          codeSystem: 'x',
          groupCode: null,
          reasonCode: 'x',
          amount: '0.00',
          sourceReference: null,
          extra: true,
        },
      ],
    },
  ])('rejects noncanonical payload %j without storing it', async (invalid) => {
    const parent = await fixture();
    const p = payload();
    await expect(evidence(parent, p, { payload: { ...p, ...invalid } })).rejects.toThrow();
  });
  it('rejects mismatched evidence copies and duplicate source identity while allowing separate namespaces', async () => {
    const parent = await fixture();
    const p = payload();
    await evidence(parent, p);
    await expect(evidence(parent, p)).rejects.toThrow();
    await expect(evidence(parent, payload(), { sourceRecordId: 'different' })).rejects.toThrow();
    await evidence(parent, { ...p, sourceNamespace: 'other' });
  });
  it.each([
    { review: { evidenceHash: 'd'.repeat(64) } },
    { review: { claimUpdatedAt: new Date('2020-01-01') } },
    { review: { ledgerVersion: '0:0' } },
    { review: { allocationCount: 0 } },
    { review: { reportedAmount: '99.99' } },
    { skipChildren: true },
    { allocations: { sourceIndex: 1 } },
    { allocations: { sourceIndex: 499 } },
    { adjustments: { sourceIndex: 499 } },
    { adjustments: { sourceIndex: 1 } },
    { adjustments: { groupCode: null } },
    { allocations: { amount: '59.99' } },
    { adjustments: { amount: '19.99' } },
    { adjustments: { sourceAdjustmentId: 'different' } },
    { adjustments: { codeSystem: 'different' } },
    { adjustments: { lineId: null } },
    { decision: 'REJECT', review: { reportedAmount: '1.00' } },
  ] satisfies ReviewOptions[])(
    'rejects incomplete, stale, or altered review %j',
    async (options) => {
      const parent = await fixture();
      const e = await evidence(parent);
      await expect(review(parent, e, options)).rejects.toThrow();
      expect(await reviewCount(parent)).toBe(0);
    },
  );
  it('compares nullable adjustment fields exactly, including a null source line or group', async () => {
    const parent = await fixture();
    const e = await evidence(
      parent,
      payload({
        adjustments: [{ ...payload().adjustments[0]!, sourceLineId: null, groupCode: null }],
      }),
    );
    await expect(
      review(parent, e, { adjustments: { lineId: parent.lineIds[0] } }),
    ).rejects.toThrow();
    await expect(review(parent, e, { adjustments: { groupCode: 'CO' } })).rejects.toThrow();
    await review(parent, e);
  });
  it('admits complete and absent line detail, without inventing residual line allocations', async () => {
    const parent = await fixture();
    const absent = await evidence(
      parent,
      payload({
        lineDetailCompleteness: 'ABSENT',
        allocations: [],
        adjustments: [],
        sourceCoverageId: 'coverage-0',
      }),
    );
    const first = await review(parent, absent);
    expect(first.allocationCount).toBe(0);
    const complete = await evidence(
      parent,
      payload({
        lineDetailCompleteness: 'COMPLETE',
        adjustments: [],
        allocations: [
          { sourceLineId: 'line-0', amount: '60.00', sourceStatus: null },
          { sourceLineId: 'line-1', amount: '40.00', sourceStatus: null },
        ],
      }),
    );
    const second = await review(parent, complete);
    expect(second.allocationCount).toBe(2);
  });
  it('keeps unreviewed evidence when claim deletion is attempted and scopes idempotency keys', async () => {
    const parent = await fixture();
    const first = await evidence(parent);
    const second = await evidence(parent);
    await expect(
      prisma.claim.delete({
        where: { id: parent.claim.id, organizationId: parent.claim.organizationId },
      }),
    ).rejects.toThrow();
    const r = await review(parent, first);
    await expect(
      review(parent, second, { review: { idempotencyKey: r.idempotencyKey } }),
    ).rejects.toThrow();
    const other = await fixture();
    await review(other, await evidence(other), { review: { idempotencyKey: r.idempotencyKey } });
  });
  it('defers completeness until commit and rolls back header/children together', async () => {
    const parent = await fixture();
    const e = await evidence(parent);
    let inserted = false;
    await expect(
      prisma.$transaction(async (tx) => {
        await createReview(tx, parent, e, { skipChildren: true });
        inserted = true;
      }),
    ).rejects.toThrow();
    expect(inserted).toBe(true);
    expect(await reviewCount(parent)).toBe(0);
  });
  it('blocks missing coverage approval and permits rejecting the same evidence', async () => {
    const parent = await fixture();
    const e = await evidence(parent, payload({ sourceCoverageId: 'not-imported' }));
    await expect(review(parent, e)).rejects.toThrow();
    await review(parent, e, { decision: 'REJECT' });
  });
  it('enforces scoped evidence, actor, allocation, and adjustment references', async () => {
    const parent = await fixture();
    const other = await fixture();
    const e = await evidence(parent);
    await expect(
      evidence(parent, payload(), { organizationId: other.claim.organizationId }),
    ).rejects.toThrow();
    await expect(
      review(parent, e, { review: { reviewedByUserId: other.user.id } }),
    ).rejects.toThrow();
    await expect(review(other, e)).rejects.toThrow();
    await expect(
      review(parent, e, { allocations: { lineId: other.lineIds[0] } }),
    ).rejects.toThrow();
    await expect(
      review(parent, e, { adjustments: { lineId: other.lineIds[0] } }),
    ).rejects.toThrow();
    expect(await reviewCount(parent)).toBe(0);
  });
  it('does not allow late appends, updates, deletes, or parent deletion after financial evidence exists', async () => {
    const parent = await fixture();
    const e = await evidence(parent);
    const r = await review(parent, e);
    const where = { organizationId: parent.claim.organizationId, claimId: parent.claim.id };
    await expect(
      prisma.claimRemittanceEvidence.updateMany({
        where,
        data: { sourceDocumentId: 'replacement' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.claimRemittanceReview.updateMany({ where, data: { decision: 'REJECT' } }),
    ).rejects.toThrow();
    await expect(
      prisma.claimRemittanceAllocation.updateMany({ where, data: { amount: '1.00' } }),
    ).rejects.toThrow();
    await expect(
      prisma.claimRemittanceAdjustment.updateMany({ where, data: { amount: '1.00' } }),
    ).rejects.toThrow();
    await expect(prisma.claimRemittanceEvidence.deleteMany({ where })).rejects.toThrow();
    await expect(prisma.claimRemittanceReview.deleteMany({ where })).rejects.toThrow();
    await expect(prisma.claimRemittanceAllocation.deleteMany({ where })).rejects.toThrow();
    await expect(prisma.claimRemittanceAdjustment.deleteMany({ where })).rejects.toThrow();
    await expect(
      prisma.claim.delete({
        where: { id: parent.claim.id, organizationId: parent.claim.organizationId },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.organization.delete({ where: { id: parent.claim.organizationId } }),
    ).rejects.toThrow();
    await expect(
      prisma.user.delete({
        where: { id: parent.user.id, organizationId: parent.claim.organizationId },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.claimRemittanceAllocation.create({
        data: {
          ...where,
          reviewId: r.id,
          sourceIndex: 1,
          lineId: parent.lineIds[1],
          amount: '0.00',
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.claimRemittanceAdjustment.create({
        data: {
          ...where,
          reviewId: r.id,
          sourceIndex: 1,
          sourceAdjustmentId: 'late',
          codeSystem: 'x',
          reasonCode: 'x',
          amount: '0.00',
        },
      }),
    ).rejects.toThrow();
    expect(await reviewCount(parent)).toBe(1);
  });
  it.each([
    Prisma.TransactionIsolationLevel.ReadCommitted,
    Prisma.TransactionIsolationLevel.RepeatableRead,
  ])(
    'serializes concurrent over-reversals under %s including stale snapshots',
    async (isolationLevel) => {
      const parent = await fixture();
      const original = await evidence(parent);
      await review(parent, original);
      const first = await reversal(parent, original, '-60.00', '-36.00', '-12.00');
      const second = await reversal(parent, original, '-60.00', '-36.00', '-12.00');
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
          prisma.$transaction((tx) => createReview(tx, parent, e, { original }, barrier), {
            isolationLevel,
            timeout: 10_000,
          }),
        ),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(await reviewCount(parent)).toBe(2);
      const missing = await prisma.claimRemittanceEvidence.findFirstOrThrow({
        where: {
          organizationId: parent.claim.organizationId,
          claimId: parent.claim.id,
          review: null,
          kind: 'REVERSAL',
        },
      });
      const retry = missing.id === first.row.id ? first : second;
      await expect(review(parent, retry, { original })).rejects.toThrow();
      expect(
        (
          await prisma.claim.findFirstOrThrow({
            where: { id: parent.claim.id, organizationId: parent.claim.organizationId },
          })
        ).updatedAt,
      ).toEqual(parent.claim.updatedAt);
    },
  );
  it('scopes all new read helpers and blocks unscoped writes', async () => {
    const first = await fixture();
    const second = await fixture();
    await review(first, await evidence(first));
    await review(second, await evidence(second));
    const db = getOrgScopedDb(first.claim.organizationId);
    expect(await db.claimRemittanceEvidence.count()).toBe(1);
    expect(await db.claimRemittanceReview.count()).toBe(1);
    expect(await db.claimRemittanceAllocation.count()).toBe(1);
    expect(await db.claimRemittanceAdjustment.count()).toBe(1);
    expect(
      await db.claimRemittanceEvidence.findFirst({ where: { claimId: second.claim.id } }),
    ).toBeNull();
    expect(await db.claimRemittanceReview.findMany()).toHaveLength(1);
    expect((await db.claimRemittanceAllocation.aggregate({ _count: true }))._count).toBe(1);
    expect(
      await db.claimRemittanceAdjustment.groupBy({ by: ['organizationId'], _count: true }),
    ).toEqual([{ organizationId: first.claim.organizationId, _count: 1 }]);
    await expect(
      prisma.claimRemittanceEvidence.deleteMany({ where: { claimId: first.claim.id } }),
    ).rejects.toThrow(MissingOrgScopeError);
    await expect(
      prisma.claimRemittanceReview.deleteMany({ where: { claimId: first.claim.id } }),
    ).rejects.toThrow(MissingOrgScopeError);
    await expect(
      prisma.claimRemittanceAllocation.deleteMany({ where: { claimId: first.claim.id } }),
    ).rejects.toThrow(MissingOrgScopeError);
    await expect(
      prisma.claimRemittanceAdjustment.deleteMany({ where: { claimId: first.claim.id } }),
    ).rejects.toThrow(MissingOrgScopeError);
  });
});

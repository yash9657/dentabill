import { randomUUID } from 'node:crypto';

import type {
  Prisma,
  PostingSourceEvidence,
  PostingSourceReceipt,
  PostingSourceReview,
  PostingSourceEntry,
  PostingClaimRelationship,
  Claim,
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
    sourceClaimId: '000-claim',
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
async function importedClaim(
  organizationId: string,
  overrides: Partial<Prisma.ClaimUncheckedCreateInput> = {},
  withLines = true,
): Promise<Claim> {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.claim.create({
      data: {
        organizationId,
        claimNumber: 'display-only',
        patientDOBHash: 'synthetic',
        claimAmount: '200.00',
        payerCode: 'UNKNOWN',
        serviceDate: new Date('2026-01-01'),
        sourceSystem: 'OPEN_DENTAL',
        sourceNamespace: 'synthetic',
        sourceClaimId: '000-claim',
        sourceContentHash: 'd'.repeat(64),
        ...overrides,
      },
    });
    if (withLines) {
      await tx.claimSourceDetails.create({
        data: {
          organizationId,
          claimId: claim.id,
          importedClaimAmount: '200.00',
          lineCount: 2,
          coverageCount: 0,
        },
      });
      for (let position = 0; position < 2; position++)
        await tx.claimSourceLine.create({
          data: {
            organizationId,
            claimId: claim.id,
            sourceLineId: `000-line-${String(position)}`,
            sourceProcedureId: `000-procedure-${String(position)}`,
            position,
            procedureCode: 'D2740',
            serviceDate: new Date('2026-01-01'),
            billedAmount: '100.00',
          },
        });
    }
    return claim;
  });
}
async function fixture(claimOverrides: Partial<Prisma.ClaimUncheckedCreateInput> = {}) {
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
  const claim = await importedClaim(org.id, claimOverrides);
  const lines = await prisma.claimSourceLine.findMany({
    where: { organizationId: org.id, claimId: claim.id },
    orderBy: { position: 'asc' },
  });
  return { org, user, claim, lines };
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
interface Accepted extends Evidence {
  review: PostingSourceReview;
  entries: PostingSourceEntry[];
}
async function accepted(f: Fixture, p = payload()): Promise<Accepted> {
  const e = await evidence(f, p);
  const r = await review(f, e);
  const entries = await prisma.postingSourceEntry.findMany({
    where: { organizationId: f.org.id, reviewId: r.id },
    orderBy: { sourceIndex: 'asc' },
  });
  return { ...e, review: r, entries };
}
async function ledger(tx: Db, org: string): Promise<string> {
  const rows = await tx.$queryRaw<
    { version: string }[]
  >`SELECT dentabill_posting_claim_ledger(${org}) AS version`;
  if (!rows[0]) throw new Error('ledger missing');
  return rows[0].version;
}
async function relationshipData(
  tx: Db,
  f: Fixture,
  e: Accepted,
  overrides: Partial<Prisma.PostingClaimRelationshipUncheckedCreateInput> = {},
): Promise<Prisma.PostingClaimRelationshipUncheckedCreateInput> {
  const item = e.entries[0];
  if (!item) throw new Error('entry missing');
  return {
    id: randomUUID(),
    organizationId: f.org.id,
    receiptId: e.receipt.id,
    evidenceId: e.row.id,
    reviewId: e.review.id,
    entryId: item.id,
    claimId: f.claim.id,
    claimSourceLineId:
      item.sourceLineId === null
        ? null
        : (f.lines.find((line) => line.sourceLineId === item.sourceLineId)?.id ?? null),
    claimVersion: f.claim.updatedAt,
    claimSourceContentHash: f.claim.sourceContentHash ?? 'd'.repeat(64),
    sourceSystem: e.row.sourceSystem,
    sourceNamespace: e.row.sourceNamespace,
    sourceEntryId: item.sourceEntryId,
    sourceClaimId: item.sourceClaimId ?? 'missing',
    evidenceHash: e.row.contentHash,
    reviewedByUserId: f.user.id,
    reviewedByRole: f.user.role,
    idempotencyKey: randomUUID(),
    requestHash: 'e'.repeat(64),
    reviewToken: 'f'.repeat(64),
    ledgerVersion: await ledger(tx, f.org.id),
    createdAt: new Date(),
    ...overrides,
  };
}
async function relationship(
  f: Fixture,
  e: Accepted,
  overrides: Partial<Prisma.PostingClaimRelationshipUncheckedCreateInput> = {},
): Promise<PostingClaimRelationship> {
  return prisma.$transaction(async (tx) =>
    tx.postingClaimRelationship.create({ data: await relationshipData(tx, f, e, overrides) }),
  );
}
async function rawRelationship(
  tx: Db,
  data: Prisma.PostingClaimRelationshipUncheckedCreateInput,
): Promise<PostingClaimRelationship> {
  const rows = await tx.$queryRaw<
    PostingClaimRelationship[]
  >`INSERT INTO "PostingClaimRelationship" SELECT * FROM jsonb_populate_record(NULL::"PostingClaimRelationship", ${JSON.stringify(data)}::jsonb) RETURNING *`;
  if (!rows[0]) throw new Error('relationship missing');
  return rows[0];
}
async function releaseData(
  tx: Db,
  f: Fixture,
  relationship: PostingClaimRelationship,
  overrides: Partial<Prisma.PostingClaimReleaseUncheckedCreateInput> = {},
): Promise<Prisma.PostingClaimReleaseUncheckedCreateInput> {
  return {
    id: randomUUID(),
    organizationId: f.org.id,
    relationshipId: relationship.id,
    reviewedByUserId: f.user.id,
    reviewedByRole: f.user.role,
    reason: 'WRONG_LINK',
    idempotencyKey: randomUUID(),
    requestHash: 'b'.repeat(64),
    reviewToken: 'c'.repeat(64),
    ledgerVersion: await ledger(tx, f.org.id),
    relationshipRequestHash: relationship.requestHash,
    createdAt: new Date(),
    ...overrides,
  };
}
async function release(
  f: Fixture,
  relationship: PostingClaimRelationship,
  overrides: Partial<Prisma.PostingClaimReleaseUncheckedCreateInput> = {},
) {
  return prisma.$transaction(async (tx) =>
    tx.postingClaimRelease.create({ data: await releaseData(tx, f, relationship, overrides) }),
  );
}
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('immutable posting source claim relationships', () => {
  it('binds exact claim-only source facts with an unresolved procedure reference and no financial/workflow changes', async () => {
    const f = await fixture();
    const e = await accepted(f);
    const beforeOrg = await prisma.organization.findFirstOrThrow({ where: { id: f.org.id } });
    const beforeClaim = await prisma.claim.findFirstOrThrow({
      where: { organizationId: f.org.id, id: f.claim.id },
    });
    const linked = await prisma.$transaction(async (tx) =>
      rawRelationship(tx, await relationshipData(tx, f, e)),
    );
    expect(linked.claimSourceLineId).toBeNull();
    expect(linked.sourceClaimId).toBe('000-claim');
    expect(
      await prisma.claim.findFirstOrThrow({ where: { organizationId: f.org.id, id: f.claim.id } }),
    ).toEqual(beforeClaim);
    expect(await prisma.organization.findFirstOrThrow({ where: { id: f.org.id } })).toEqual(
      beforeOrg,
    );
    expect(
      await prisma.postingSourceEntry.findFirstOrThrow({
        where: { organizationId: f.org.id, id: linked.entryId },
      }),
    ).toEqual(e.entries[0]);
    expect(await prisma.claimRemittanceAllocation.count()).toBe(0);
    expect(await prisma.cashBatchMatch.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
    await release(f, linked);
    expect(
      await prisma.claim.findFirstOrThrow({ where: { organizationId: f.org.id, id: f.claim.id } }),
    ).toEqual(beforeClaim);
  });
  it.each(['OPEN_DENTAL', 'DENTRIX', 'EAGLESOFT'])(
    'accepts exact supported system %s and line/procedure identities',
    async (sourceSystem) => {
      const f = await fixture({ sourceSystem });
      const e = await accepted(
        f,
        payload({
          sourceSystem,
          entries: [entry({ sourceLineId: '000-line-0', sourceProcedureId: '000-procedure-0' })],
        }),
      );
      const linked = await relationship(f, e);
      expect(linked.claimSourceLineId).toBe(f.lines[0]?.id);
    },
  );
  it.each([
    {
      status: 'UNKNOWN',
      detailCompleteness: 'PARTIAL',
      amount: null,
      sourceAmount: null,
      item: { entryKind: 'UNKNOWN', amount: null, sourceAmount: null },
    },
    {
      status: 'PARTIAL',
      detailCompleteness: 'PARTIAL',
      amount: '300.00',
      sourceAmount: '300.00',
      item: {
        entryKind: 'TRANSFER',
        amount: '-80.00',
        sourceAmount: '80.00',
        sourceSignConvention: 'DEBIT_POSITIVE',
        sourceIsTransfer: true,
      },
    },
    {
      status: 'POSTED',
      detailCompleteness: 'COMPLETE',
      amount: '100.00',
      sourceAmount: '100.00',
      item: { entryKind: 'ADJUSTMENT', amount: '0.00', sourceAmount: '0.00' },
    },
  ] as const)(
    'retains reviewable unknown/negative/zero/mismatched source facts %j',
    async (value) => {
      const f = await fixture();
      const { item, ...header } = value;
      const e = await accepted(f, payload({ ...header, entries: [entry(item)] }));
      const linked = await relationship(f, e);
      expect(linked.entryId).toBe(e.entries[0]?.id);
      expect(
        (
          await prisma.postingSourceEvidence.findFirstOrThrow({
            where: { organizationId: f.org.id, id: e.row.id },
          })
        ).payload,
      ).toEqual(e.payload);
    },
  );
  it('permits several distinct source entries to associate with the same claim and line without allocating amounts', async () => {
    const f = await fixture();
    const e = await accepted(
      f,
      payload({
        entries: [
          entry({ sourceLineId: '000-line-0', sourceProcedureId: null }),
          entry({ sourceLineId: '000-line-0', sourceProcedureId: null }),
        ],
      }),
    );
    await relationship(f, e);
    const second = e.entries[1];
    if (!second) throw new Error('missing entry');
    await relationship(f, e, { entryId: second.id, sourceEntryId: second.sourceEntryId });
    expect(await prisma.postingClaimRelationship.count()).toBe(2);
  });
  it.each([
    { sourceLineId: '000-line-0', sourceProcedureId: '000-procedure-0', line: null },
    { sourceLineId: '000-line-0', sourceProcedureId: '000-procedure-0', line: 'other' },
    { sourceLineId: '000-line-0', sourceProcedureId: 'different', line: 'first' },
    { sourceLineId: 'missing-line', sourceProcedureId: null, line: 'first' },
    { sourceLineId: null, sourceProcedureId: '000-procedure-0', line: 'first' },
  ])('rejects absent/wrong/guessed local source lines %j', async ({ line, ...item }) => {
    const f = await fixture();
    const e = await accepted(f, payload({ entries: [entry(item)] }));
    const claimSourceLineId =
      line === null ? null : (f.lines[line === 'first' ? 0 : 1]?.id ?? null);
    await expect(relationship(f, e, { claimSourceLineId })).rejects.toThrow(
      'POSTING_CLAIM_LINE_MISMATCH',
    );
  });
  it('allows a line association when source procedure reference is absent', async () => {
    const f = await fixture();
    const e = await accepted(
      f,
      payload({ entries: [entry({ sourceLineId: '000-line-0', sourceProcedureId: null })] }),
    );
    expect((await relationship(f, e)).claimSourceLineId).toBe(f.lines[0]?.id);
  });
  it('does not match claim display numbers, absent source claims, or unsupported source systems', async () => {
    const f = await fixture();
    for (const p of [
      payload({ entries: [entry({ sourceClaimId: null })] }),
      payload({ entries: [entry({ sourceClaimId: 'display-only' })] }),
      payload({ sourceSystem: 'CUSTOM' }),
    ]) {
      const e = await accepted(f, p);
      await expect(relationship(f, e)).rejects.toThrow();
    }
  });
  it.each([
    { sourceNamespace: 'another' },
    { sourceSystem: 'DENTRIX' },
    { sourceClaimId: 'different' },
  ])('requires exact imported claim identity %j', async (claimOverrides) => {
    const f = await fixture(claimOverrides);
    const e = await accepted(f);
    await expect(relationship(f, e)).rejects.toThrow('POSTING_CLAIM_SOURCE_MISMATCH');
  });
  it('never promotes a manual claim into an imported source match', async () => {
    const f = await fixture();
    const e = await accepted(f);
    const manual = await importedClaim(
      f.org.id,
      { sourceSystem: null, sourceNamespace: null, sourceClaimId: null, sourceContentHash: null },
      false,
    );
    await expect(
      relationship(f, e, { claimId: manual.id, claimVersion: manual.updatedAt }),
    ).rejects.toThrow('POSTING_CLAIM_CLAIM_CHANGED');
  });
  it.each(['receiptId', 'evidenceId', 'reviewId', 'entryId'] as const)(
    'rejects a fabricated exact source %s binding',
    async (field) => {
      const f = await fixture();
      const e = await accepted(f);
      await expect(relationship(f, e, { [field]: randomUUID() })).rejects.toThrow(
        'POSTING_CLAIM_BINDING_INVALID',
      );
    },
  );
  it.each([
    { sourceEntryId: 'fabricated' },
    { sourceClaimId: 'fabricated' },
    { evidenceHash: '0'.repeat(64) },
    { sourceSystem: 'DENTRIX' },
    { sourceNamespace: 'other' },
  ])('rejects forged source mirrors %j', async (value) => {
    const f = await fixture();
    const e = await accepted(f);
    await expect(
      prisma.$transaction(async (tx) =>
        rawRelationship(tx, await relationshipData(tx, f, e, value)),
      ),
    ).rejects.toThrow('POSTING_CLAIM_BINDING_INVALID');
  });
  it.each([{ claimVersion: new Date('2000-01-01') }, { claimSourceContentHash: '0'.repeat(64) }])(
    'rejects stale local claim version/hash %j',
    async (value) => {
      const f = await fixture();
      const e = await accepted(f);
      await expect(relationship(f, e, value)).rejects.toThrow('POSTING_CLAIM_CLAIM_CHANGED');
    },
  );
  it('requires an exact stored actor role and tenant', async () => {
    const f = await fixture();
    const other = await fixture();
    const e = await accepted(f);
    await expect(relationship(f, e, { reviewedByRole: 'OWNER' })).rejects.toThrow(
      'POSTING_CLAIM_ACTOR_INVALID',
    );
    await expect(relationship(f, e, { reviewedByUserId: other.user.id })).rejects.toThrow(
      'POSTING_CLAIM_ACTOR_INVALID',
    );
    await prisma.user.update({
      where: { id: f.user.id, organizationId: f.org.id },
      data: { role: 'ADMIN' },
    });
    await expect(relationship(f, e)).rejects.toThrow('POSTING_CLAIM_ACTOR_INVALID');
    await relationship(f, e, { reviewedByRole: 'ADMIN' });
  });
  it.each([
    { requestHash: 'bad' },
    { reviewToken: 'Z'.repeat(64) },
    { ledgerVersion: '0:0:0:0' },
    { createdAt: 'infinity' },
  ])('rejects invalid immutable review envelope %j', async (value) => {
    const f = await fixture();
    const e = await accepted(f);
    await expect(
      prisma.$transaction(async (tx) =>
        rawRelationship(tx, await relationshipData(tx, f, e, value)),
      ),
    ).rejects.toThrow();
  });
  it.each(['unreviewed', 'rejected', 'removed', 'omitted'] as const)(
    'keeps an older accepted entry stale after a newer %s observation',
    async (kind) => {
      const f = await fixture();
      const e = await accepted(f);
      const next = await evidence(
        f,
        revision(
          e,
          kind === 'removed'
            ? {
                status: 'REMOVED',
                amount: null,
                sourceAmount: null,
                detailCompleteness: 'ABSENT',
                entries: [],
              }
            : kind === 'omitted'
              ? { entries: [] }
              : {},
        ),
      );
      if (kind !== 'unreviewed')
        await review(f, next, kind === 'rejected' ? { decision: 'REJECT' } : {});
      await expect(relationship(f, e)).rejects.toThrow('POSTING_CLAIM_NOT_CURRENT');
    },
  );
  it('allows the highest observed accepted revision even if a lower revision arrives later', async () => {
    const f = await fixture();
    const e = await accepted(f, payload({ sourceSequence: 5 }));
    await evidence(f, revision(e, { sourceSequence: 2 }));
    await relationship(f, e);
  });
  it('keeps source entry reservation across corrections and local claim edits until an explicit release', async () => {
    const f = await fixture();
    const e = await accepted(f);
    const link = await relationship(f, e);
    const revised = await accepted(
      f,
      revision(e, {
        entries: [
          entry({
            ...e.payload.entries[0],
            amount: '-5.00',
            sourceAmount: '-5.00',
            entryKind: 'ADJUSTMENT',
          }),
        ],
      }),
    );
    await expect(relationship(f, revised)).rejects.toThrow('POSTING_CLAIM_ENTRY_RESERVED');
    f.claim = await prisma.claim.update({
      where: { id: f.claim.id, organizationId: f.org.id },
      data: { status: 'RESOLVED' },
    });
    await expect(relationship(f, revised)).rejects.toThrow('POSTING_CLAIM_ENTRY_RESERVED');
    await release(f, link, { reason: 'SOURCE_CHANGED' });
    const next = await relationship(f, revised);
    expect(next.evidenceId).toBe(revised.row.id);
    expect(await prisma.postingClaimRelationship.count()).toBe(2);
  });
  it.each(['REMOVED', 'OMITTED'] as const)(
    'retains reservation after %s source membership frees a different receipt to observe the same entry',
    async (kind) => {
      const f = await fixture();
      const e = await accepted(f);
      const link = await relationship(f, e);
      await accepted(
        f,
        revision(
          e,
          kind === 'REMOVED'
            ? {
                status: 'REMOVED',
                amount: null,
                sourceAmount: null,
                detailCompleteness: 'ABSENT',
                entries: [],
              }
            : { entries: [] },
        ),
      );
      const newReceipt = await accepted(f, payload({ entries: e.payload.entries }));
      await expect(relationship(f, newReceipt)).rejects.toThrow('POSTING_CLAIM_ENTRY_RESERVED');
      await release(f, link);
      await relationship(f, newReceipt);
    },
  );
  it('keeps reservations when a later rejected revision or absent partial snapshot leaves old entry facts historical', async () => {
    const f = await fixture();
    const e = await accepted(f);
    const link = await relationship(f, e);
    const next = await evidence(f, revision(e, { entries: [] }));
    await review(f, next, { decision: 'REJECT' });
    expect(await prisma.postingClaimRelease.count()).toBe(0);
    await release(f, link);
    expect(await prisma.postingClaimRelationship.count()).toBe(1);
  });
  it('scopes source entry reservations independently by organization, system and namespace', async () => {
    const f = await fixture();
    const e = await accepted(f);
    await relationship(f, e);
    const other = await fixture();
    await relationship(other, await accepted(other, payload({ entries: e.payload.entries })));
    for (const changed of [{ sourceSystem: 'DENTRIX' }, { sourceNamespace: 'different' }]) {
      const claim = await importedClaim(f.org.id, changed);
      const scoped = { ...f, claim };
      await relationship(
        scoped,
        await accepted(scoped, payload({ ...changed, entries: e.payload.entries })),
      );
    }
    expect(await prisma.postingClaimRelationship.count()).toBe(4);
  });
  it('rejects cross-tenant claim and source-entry bindings without relying on API or audit', async () => {
    const f = await fixture();
    const other = await fixture();
    const e = await accepted(f);
    const otherE = await accepted(other);
    await expect(
      relationship(f, e, { claimId: other.claim.id, claimVersion: other.claim.updatedAt }),
    ).rejects.toThrow('POSTING_CLAIM_BINDING_INVALID');
    await expect(relationship(f, otherE)).rejects.toThrow('POSTING_CLAIM_BINDING_INVALID');
    const withLine = await accepted(
      f,
      payload({ entries: [entry({ sourceLineId: '000-line-0', sourceProcedureId: null })] }),
    );
    await expect(
      relationship(f, withLine, { claimSourceLineId: other.lines[0]?.id ?? null }),
    ).rejects.toThrow('POSTING_CLAIM_LINE_MISMATCH');
    expect(await prisma.postingClaimRelationship.count()).toBe(0);
  });
  it('rolls relationship/release and their reservation back with a failed surrounding audit transaction', async () => {
    const f = await fixture();
    const e = await accepted(f);
    await expect(
      prisma.$transaction(async (tx) => {
        await rawRelationship(tx, await relationshipData(tx, f, e));
        throw new Error('AUDIT_FAILED');
      }),
    ).rejects.toThrow('AUDIT_FAILED');
    expect(await prisma.postingClaimRelationship.count()).toBe(0);
    const link = await relationship(f, e);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.postingClaimRelease.create({ data: await releaseData(tx, f, link) });
        throw new Error('AUDIT_FAILED');
      }),
    ).rejects.toThrow('AUDIT_FAILED');
    await expect(relationship(f, e)).rejects.toThrow('POSTING_CLAIM_ENTRY_RESERVED');
    await release(f, link);
    await relationship(f, e);
  });
  it('keeps exact idempotency keys unique and preserves original rows across retries', async () => {
    const f = await fixture();
    const e = await accepted(f);
    const first = await relationship(f, e);
    await expect(
      relationship(f, e, { idempotencyKey: first.idempotencyKey, requestHash: first.requestHash }),
    ).rejects.toThrow();
    await release(f, first);
    const e2 = await accepted(f);
    await expect(
      relationship(f, e2, { idempotencyKey: first.idempotencyKey, requestHash: 'a'.repeat(64) }),
    ).rejects.toThrow();
    expect(
      await prisma.postingClaimRelationship.findFirst({
        where: { id: first.id, organizationId: f.org.id },
      }),
    ).toEqual(first);
  });
  it.each(['WRONG_LINK', 'SOURCE_CHANGED', 'OTHER_REVIEWED_ERROR'])(
    'allows full %s release without a current source or unchanged claim',
    async (reason) => {
      const f = await fixture();
      const e = await accepted(f);
      const link = await relationship(f, e);
      await evidence(
        f,
        revision(e, {
          status: 'REMOVED',
          amount: null,
          sourceAmount: null,
          detailCompleteness: 'ABSENT',
          entries: [],
        }),
      );
      await prisma.claim.update({
        where: { id: f.claim.id, organizationId: f.org.id },
        data: { status: 'RESOLVED' },
      });
      const released = await release(f, link, { reason });
      expect(released.relationshipRequestHash).toBe(link.requestHash);
      await expect(release(f, link)).rejects.toThrow();
    },
  );
  it.each([
    { reason: 'PARTIAL' },
    { relationshipRequestHash: '0'.repeat(64) },
    { reviewedByRole: 'OWNER' as const },
    { ledgerVersion: '0:0:0:0' },
    { requestHash: 'bad' },
    { reviewToken: 'bad' },
  ])('blocks invalid release %j', async (overrides) => {
    const f = await fixture();
    const e = await accepted(f);
    const link = await relationship(f, e);
    await expect(release(f, link, overrides)).rejects.toThrow();
    expect(await prisma.postingClaimRelease.count()).toBe(0);
    await expect(relationship(f, e)).rejects.toThrow('POSTING_CLAIM_ENTRY_RESERVED');
  });
  it('blocks cross-tenant release actors and target substitutions', async () => {
    const f = await fixture();
    const other = await fixture();
    const e = await accepted(f);
    const link = await relationship(f, e);
    await expect(release(f, link, { reviewedByUserId: other.user.id })).rejects.toThrow(
      'POSTING_CLAIM_ACTOR_INVALID',
    );
    await expect(release(other, link)).rejects.toThrow('POSTING_CLAIM_BINDING_INVALID');
    await expect(release(f, link, { relationshipId: randomUUID() })).rejects.toThrow(
      'POSTING_CLAIM_BINDING_INVALID',
    );
  });
  it('preserves immutable relationship/release rows and restrictive claim and actor references', async () => {
    const f = await fixture();
    const e = await accepted(f);
    const link = await relationship(f, e);
    const released = await release(f, link);
    await expect(
      prisma.$executeRaw`UPDATE "PostingClaimRelationship" SET "requestHash" = ${'0'.repeat(64)} WHERE id = ${link.id}::uuid`,
    ).rejects.toThrow('POSTING_CLAIM_IMMUTABLE');
    await expect(
      prisma.$executeRaw`DELETE FROM "PostingClaimRelationship" WHERE id = ${link.id}::uuid`,
    ).rejects.toThrow('POSTING_CLAIM_IMMUTABLE');
    await expect(
      prisma.$executeRaw`UPDATE "PostingClaimRelease" SET reason = 'SOURCE_CHANGED' WHERE id = ${released.id}::uuid`,
    ).rejects.toThrow('POSTING_CLAIM_IMMUTABLE');
    await expect(
      prisma.$executeRaw`DELETE FROM "PostingClaimRelease" WHERE id = ${released.id}::uuid`,
    ).rejects.toThrow('POSTING_CLAIM_IMMUTABLE');
    await expect(
      prisma.$executeRaw`DELETE FROM "Claim" WHERE id = ${f.claim.id}`,
    ).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM "User" WHERE id = ${f.user.id}`).rejects.toThrow();
  });
  it('applies org read guards and rejects unscoped writes for both new models', async () => {
    const f = await fixture();
    const other = await fixture();
    const e = await accepted(f);
    const link = await relationship(f, e);
    await release(f, link);
    expect(await getOrgScopedDb(f.org.id).postingClaimRelationship.count()).toBe(1);
    expect(await getOrgScopedDb(other.org.id).postingClaimRelationship.findMany()).toEqual([]);
    expect(await getOrgScopedDb(other.org.id).postingClaimRelease.count()).toBe(0);
    expect(await getOrgScopedDb(f.org.id).postingClaimRelease.count()).toBe(1);
    await expect(
      prisma.postingClaimRelationship.deleteMany({ where: { id: link.id } }),
    ).rejects.toBeInstanceOf(MissingOrgScopeError);
    await expect(
      prisma.postingClaimRelease.deleteMany({ where: { relationshipId: link.id } }),
    ).rejects.toBeInstanceOf(MissingOrgScopeError);
  });
  it.each(['ReadCommitted', 'RepeatableRead'] as const)(
    'serializes concurrent source identity reservations at %s',
    async (isolationLevel) => {
      const f = await fixture();
      const e = await accepted(f);
      const ready = gate();
      const proceed = gate();
      const stale = prisma.$transaction(
        async (tx) => {
          const data = await relationshipData(tx, f, e);
          ready.open();
          await proceed.promise;
          return rawRelationship(tx, data);
        },
        { isolationLevel, timeout: 10000 },
      );
      const settled = stale.then(
        () => null,
        (error: unknown) => error,
      );
      await ready.promise;
      const first = await relationship(f, e);
      proceed.open();
      expect(await settled).not.toBeNull();
      expect(await prisma.postingClaimRelationship.count()).toBe(1);
      expect(
        (
          await prisma.postingClaimRelationship.findFirstOrThrow({
            where: { organizationId: f.org.id },
          })
        ).id,
      ).toBe(first.id);
    },
  );
  it.each(['ReadCommitted', 'RepeatableRead'] as const)(
    'fences source revisions that race a %s relationship',
    async (isolationLevel) => {
      const f = await fixture();
      const e = await accepted(f);
      const ready = gate();
      const proceed = gate();
      const stale = prisma.$transaction(
        async (tx) => {
          const data = await relationshipData(tx, f, e);
          ready.open();
          await proceed.promise;
          return rawRelationship(tx, data);
        },
        { isolationLevel, timeout: 10000 },
      );
      const settled = stale.then(
        () => null,
        (error: unknown) => error,
      );
      await ready.promise;
      await evidence(f, revision(e));
      proceed.open();
      expect(await settled).not.toBeNull();
      expect(await prisma.postingClaimRelationship.count()).toBe(0);
    },
  );
  it.each(['ReadCommitted', 'RepeatableRead'] as const)(
    'fences a concurrent local claim update at %s without overwriting workflow',
    async (isolationLevel) => {
      const f = await fixture();
      const e = await accepted(f);
      const ready = gate();
      const proceed = gate();
      const stale = prisma.$transaction(
        async (tx) => {
          const data = await relationshipData(tx, f, e);
          await tx.claim.findFirst({ where: { id: f.claim.id, organizationId: f.org.id } });
          ready.open();
          await proceed.promise;
          return rawRelationship(tx, data);
        },
        { isolationLevel, timeout: 10000 },
      );
      const settled = stale.then(
        () => null,
        (error: unknown) => error,
      );
      await ready.promise;
      await prisma.claim.update({
        where: { id: f.claim.id, organizationId: f.org.id },
        data: { status: 'DENIED', updatedAt: new Date(Date.now() + 1000) },
      });
      proceed.open();
      expect(await settled).not.toBeNull();
      expect(await prisma.postingClaimRelationship.count()).toBe(0);
      expect(
        (
          await prisma.claim.findFirstOrThrow({
            where: { id: f.claim.id, organizationId: f.org.id },
          })
        ).status,
      ).toBe('DENIED');
    },
  );
  it.each(['ReadCommitted', 'RepeatableRead'] as const)(
    'serializes concurrent full releases at %s',
    async (isolationLevel) => {
      const f = await fixture();
      const e = await accepted(f);
      const link = await relationship(f, e);
      const ready = gate();
      const proceed = gate();
      const stale = prisma.$transaction(
        async (tx) => {
          const data = await releaseData(tx, f, link);
          ready.open();
          await proceed.promise;
          return tx.postingClaimRelease.create({ data });
        },
        { isolationLevel, timeout: 10000 },
      );
      const settled = stale.then(
        () => null,
        (error: unknown) => error,
      );
      await ready.promise;
      await release(f, link);
      proceed.open();
      expect(await settled).not.toBeNull();
      expect(await prisma.postingClaimRelease.count()).toBe(1);
      await relationship(f, e);
    },
  );
});

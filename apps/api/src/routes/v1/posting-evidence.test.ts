import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { prisma, type UserRole } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { initEnv } from '../../lib/env.js';
import {
  PostingEvidenceSchema,
  PostingHistorySchema,
  PostingInputSchema,
  PostingListSchema,
  PostingPreviewSchema,
  type PostingInput,
  type PostingReviewInput,
} from '../../lib/posting-evidence/contract.js';

type FixtureName =
  | '01-header150-entries180.json'
  | '02-partial-entry80.json'
  | '03-absent-unknown.json'
  | '04-removed.json'
  | '05-negative-transfer.json'
  | '06-unknown-entry.json';
function fixture(name: FixtureName): PostingInput {
  // The finite filename union contains only checked-in fabricated inputs.
  const value: unknown = JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    readFileSync(
      new URL(`../../../test/fixtures/posting-evidence/${name}`, import.meta.url),
      'utf8',
    ),
  );
  return PostingInputSchema.parse(value);
}
function input(overrides: Partial<PostingInput> = {}): PostingInput {
  const base = fixture('01-header150-entries180.json');
  const sourceReceiptId = overrides.sourceReceiptId ?? base.sourceReceiptId;
  const sourceSequence = overrides.sourceSequence ?? base.sourceSequence;
  return {
    ...base,
    ...overrides,
    sourceRecordId: overrides.sourceRecordId ?? `${sourceReceiptId}-seq-${String(sourceSequence)}`,
  };
}
function entry(
  sourceEntryId: string,
  overrides: Partial<PostingInput['entries'][number]> = {},
): PostingInput['entries'][number] {
  return { ...fixture('01-header150-entries180.json').entries[0]!, sourceEntryId, ...overrides };
}
function removed(overrides: Partial<PostingInput> = {}): PostingInput {
  return input({
    status: 'REMOVED',
    amount: null,
    sourceAmount: null,
    detailCompleteness: 'ABSENT',
    entries: [],
    ...overrides,
  });
}
function largeInput(receipt: string, sourceSequence = 1, targetBytes = 210_000): PostingInput {
  const payload = input({
    sourceReceiptId: receipt,
    sourceSequence,
    entries: Array.from({ length: 100 }, (_, index) =>
      entry(`${receipt}:${String(index)}:`.padEnd(200, 'a'), {
        sourceClaimId: 'a'.repeat(200),
        sourceLineId: 'a'.repeat(200),
        sourceProcedureId: 'a'.repeat(200),
        sourceVersion: 'a'.repeat(200),
        sourceStatus: 'a'.repeat(80),
        amount: '1.00',
        sourceAmount: '1.00',
      }),
    ),
  });
  let remaining = Math.floor((targetBytes - Buffer.byteLength(JSON.stringify(payload))) / 2);
  for (const item of payload.entries) {
    for (const key of [
      'sourceEntryId',
      'sourceClaimId',
      'sourceLineId',
      'sourceProcedureId',
      'sourceVersion',
      'sourceStatus',
    ] as const) {
      const value = item[key]!;
      const prefix = key === 'sourceEntryId' ? 32 : 0;
      const count = Math.min(remaining, value.length - prefix);
      remaining -= count;
      item[key] = value.slice(0, prefix) + '界'.repeat(count) + value.slice(prefix + count);
    }
  }
  expect(remaining).toBe(0);
  return PostingInputSchema.parse(payload);
}
async function seed(role: UserRole = 'BILLING_STAFF', existingOrganizationId?: string) {
  const organizationId =
    existingOrganizationId ??
    (
      await prisma.organization.create({
        data: { name: 'Synthetic posting evidence practice', clerkOrgId: `org_${randomUUID()}` },
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
const BASE = '/v1/posting-evidence';
const PRIVATE_MARKER = 'SYNTHETIC-PRIVATE-POSTING-CONTENT';
const financialState = {
  provenance: 'MANUAL_UPLOAD',
  sourceVerification: 'UNVERIFIED',
  claimLinkage: 'UNLINKED',
  bankVerification: 'UNVERIFIED',
  settlement: 'UNVERIFIED',
} as const;

describe('posting evidence API (synthetic, real Postgres)', () => {
  let app: FastifyInstance;
  const logs: string[] = [];
  let requestOrdinal = 0;
  function inject(options: InjectOptions) {
    requestOrdinal += 1;
    return app.inject({ ...options, remoteAddress: `2001:db8::${requestOrdinal.toString(16)}` });
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.startsWith('/dentabill_')
    )
      throw new Error('Posting tests require an isolated local DentaBill database.');
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    initEnv();
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
  async function removeAuditFailure() {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS reject_posting_test_audit ON "AuditLog"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_posting_test_audit()');
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
  function upload(s: Seed, payload: unknown) {
    return inject({
      method: 'POST',
      url: BASE,
      headers: s.headers,
      payload: payload as NonNullable<InjectOptions['payload']>,
    });
  }
  async function imported(s: Seed, payload = input()) {
    const result = await upload(s, payload);
    expect(result.statusCode, result.body).toBe(201);
    return PostingEvidenceSchema.parse(result.json());
  }
  async function preview(s: Seed, id: string) {
    const result = await inject({
      method: 'GET',
      url: `${BASE}/${id}/preview`,
      headers: s.headers,
    });
    expect(result.statusCode, result.body).toBe(200);
    return PostingPreviewSchema.parse(result.json());
  }
  async function reviewBody(
    s: Seed,
    id: string,
    decision: PostingReviewInput['decision'] = 'ACCEPT',
  ): Promise<PostingReviewInput> {
    return {
      decision,
      reviewToken: (await preview(s, id)).reviewToken,
      idempotencyKey: randomUUID(),
    };
  }
  function review(s: Seed, id: string, payload: PostingReviewInput) {
    return inject({ method: 'POST', url: `${BASE}/${id}/review`, headers: s.headers, payload });
  }
  async function reviewed(
    s: Seed,
    id: string,
    decision: PostingReviewInput['decision'] = 'ACCEPT',
  ) {
    const result = await review(s, id, await reviewBody(s, id, decision));
    expect(result.statusCode, result.body).toBe(200);
    return PostingEvidenceSchema.parse(result.json());
  }
  async function acceptInput(s: Seed, payload: PostingInput) {
    return reviewed(s, (await imported(s, payload)).id);
  }
  async function list(s: Seed, suffix = '') {
    const result = await inject({ method: 'GET', url: `${BASE}${suffix}`, headers: s.headers });
    expect(result.statusCode, result.body).toBe(200);
    expect(Buffer.byteLength(result.body)).toBeLessThanOrEqual(2 * 1024 * 1024);
    return PostingListSchema.parse(result.json());
  }
  async function history(s: Seed, id: string, suffix = '') {
    const result = await inject({
      method: 'GET',
      url: `${BASE}/receipts/${id}${suffix}`,
      headers: s.headers,
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(Buffer.byteLength(result.body)).toBeLessThanOrEqual(2 * 1024 * 1024);
    return PostingHistorySchema.parse(result.json());
  }
  async function failAudit(action: 'posting.import' | 'posting.review' | 'posting.read') {
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_posting_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION '${PRIVATE_MARKER}'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_posting_test_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_posting_test_audit()',
    );
  }
  async function financialCounts() {
    return {
      claims: await prisma.claim.count(),
      remittances: await prisma.claimRemittanceEvidence.count(),
      allocations: await prisma.claimRemittanceAllocation.count(),
      cash: await prisma.cashSourceEvidence.count(),
      batches: await prisma.remittanceBatchEvidence.count(),
      matches: await prisma.cashBatchMatch.count(),
      releases: await prisma.cashBatchRelease.count(),
      usage: await prisma.billingUsageRecord.count(),
    };
  }

  it('requires authentication on all five handlers', async () => {
    const id = randomUUID();
    for (const options of [
      { method: 'GET', url: BASE },
      { method: 'POST', url: BASE, payload: input() },
      { method: 'GET', url: `${BASE}/receipts/${id}` },
      { method: 'GET', url: `${BASE}/${id}/preview` },
      {
        method: 'POST',
        url: `${BASE}/${id}/review`,
        payload: { decision: 'ACCEPT', reviewToken: 'a'.repeat(64), idempotencyKey: randomUUID() },
      },
    ] as const)
      expect((await inject(options)).statusCode).toBe(401);
  });

  it.each(['OWNER', 'ADMIN', 'BILLING_STAFF'] as const)(
    'allows stored %s reviewers and records their actual actor role',
    async (role) => {
      const s = await seed(role);
      const row = await acceptInput(s, input());
      expect(row.review).toMatchObject({
        decision: 'ACCEPT',
        reviewedByUserId: s.user.id,
        reviewedByRole: role,
      });
      expect((await list(s)).items[0]?.freshness).toBe('CURRENT');
      expect((await history(s, row.receiptId)).items).toHaveLength(1);
    },
  );

  it('preserves header150 and entries180 independently without changing local claims or financial ledgers', async () => {
    const s = await seed();
    const claim = await prisma.claim.create({
      data: {
        organizationId: s.organizationId,
        patientDOBHash: 'synthetic',
        patientDOBLast4: '1990',
        claimNumber: 'synthetic-posting-claim',
        cdtCodes: ['D0120'],
        claimAmount: '180.00',
        serviceDate: new Date('2026-10-01T00:00:00Z'),
        payerCode: 'UNKNOWN',
      },
    });
    const before = await financialCounts();
    const payload = input({
      entries: [
        entry('entry-A', { sourceClaimId: claim.id }),
        entry('entry-B', { amount: '80.00', sourceAmount: '80.00' }),
      ],
    });
    const row = await imported(s, payload);
    expect(row).toMatchObject({
      ...financialState,
      payload,
      totals: {
        knownListedEntryAmount: '180.00',
        unknownEntryCount: 0,
        completeEntryAmount: '180.00',
        headerDifference: '-30.00',
      },
    });
    expect((await preview(s, row.id)).blockers).toEqual([]);
    const accepted = await reviewed(s, row.id);
    expect(accepted).toMatchObject(financialState);
    expect(accepted.payload).toEqual(payload);
    expect(await financialCounts()).toEqual(before);
    expect(await prisma.claim.findUnique({ where: { id: claim.id } })).toEqual(claim);
    const mirrors = await prisma.postingSourceEntry.findMany({
      where: { organizationId: s.organizationId, evidenceId: row.id },
      orderBy: { sourceIndex: 'asc' },
    });
    expect(mirrors).toHaveLength(2);
    expect(mirrors[0]).toMatchObject({
      sourceClaimId: claim.id,
      sourceEntryId: 'entry-A',
      sourceVersion: payload.entries[0]!.sourceVersion,
      sourceIsTransfer: false,
    });
    expect(mirrors.map((item) => item.amount?.toFixed(2))).toEqual(['100.00', '80.00']);
  });

  it.each(['02-partial-entry80.json', '03-absent-unknown.json', '06-unknown-entry.json'] as const)(
    'accepts incomplete or unknown facts from %s without inventing complete totals',
    async (name) => {
      const s = await seed();
      const p = fixture(name);
      const row = await acceptInput(s, p);
      expect(row.payload).toEqual(p);
      expect(row.totals.completeEntryAmount).toBeNull();
      expect(row.totals.headerDifference).toBeNull();
      expect(row.totals.unknownEntryCount).toBe(name === '06-unknown-entry.json' ? 1 : 0);
      expect(row).toMatchObject(financialState);
    },
  );

  it('preserves signed transfers and source flags/versions without treating a debit as a new positive receipt', async () => {
    const s = await seed();
    const p = fixture('05-negative-transfer.json');
    const row = await acceptInput(s, p);
    expect(row.totals).toMatchObject({
      knownListedEntryAmount: '-25.00',
      completeEntryAmount: '-25.00',
      headerDifference: '0.00',
    });
    const mirror = await prisma.postingSourceEntry.findFirst({
      where: { organizationId: s.organizationId, evidenceId: row.id },
    });
    expect(mirror).toMatchObject({
      entryKind: 'TRANSFER',
      sourceIsTransfer: true,
      sourceVersion: 'child-v9',
      sourceSignConvention: 'DEBIT_POSITIVE',
    });
    expect(mirror?.amount?.toFixed(2)).toBe('-25.00');
    expect(mirror?.sourceAmount?.toFixed(2)).toBe('25.00');
    expect(row.payload.sourceIsPartial).toBe(false);
  });

  it.each(['0.00', '-0.01', '99999999.99'] as const)(
    'accepts canonical header amount %s independently of listed entries',
    async (amount) => {
      const s = await seed();
      const row = await acceptInput(s, input({ amount, sourceAmount: amount, entries: [] }));
      expect(row.payload.amount).toBe(amount);
      expect(row.totals).toMatchObject({ completeEntryAmount: '0.00', headerDifference: amount });
    },
  );

  it('retains large signed entry totals with exact cents beyond an individual Decimal amount', async () => {
    const s = await seed();
    const row = await acceptInput(
      s,
      input({
        amount: null,
        sourceAmount: null,
        entries: Array.from({ length: 100 }, (_, i) =>
          entry(`large-${String(i)}`, { amount: '-99999999.99', sourceAmount: '-99999999.99' }),
        ),
      }),
    );
    expect(row.totals).toEqual({
      knownListedEntryAmount: '-9999999999.00',
      unknownEntryCount: 0,
      completeEntryAmount: '-9999999999.00',
      headerDifference: null,
    });
  });

  it('orders snapshots by source sequence, accepts only the latest and permits rejection of old observations', async () => {
    const s = await seed();
    const newest = await imported(s, input({ sourceSequence: 5 }));
    const old = await imported(s, input({ sourceSequence: 2 }));
    expect((await preview(s, old.id)).blockers).toContain('NEWER_SOURCE_EVIDENCE');
    expect((await review(s, old.id, await reviewBody(s, old.id))).statusCode).toBe(409);
    expect((await reviewed(s, old.id, 'REJECT')).review?.decision).toBe('REJECT');
    await reviewed(s, newest.id);
    const state = (await list(s)).items[0]!;
    expect(state).toMatchObject({
      latestSourceSequence: 5,
      freshness: 'CURRENT',
      currentAcceptedEvidence: { id: newest.id },
    });
    expect(
      (await history(s, newest.receiptId)).items.map((item) => item.payload.sourceSequence),
    ).toEqual([5, 2]);
  });

  it('marks accepted evidence stale after a newer rejected observation and keeps immutable prior facts', async () => {
    const s = await seed();
    const old = await acceptInput(s, input());
    const newer = await imported(
      s,
      input({ sourceSequence: 2, amount: '20.00', sourceAmount: '20.00' }),
    );
    expect((await list(s)).items[0]).toMatchObject({
      freshness: 'STALE',
      latestEvidence: { id: newer.id },
      currentAcceptedEvidence: { id: old.id },
    });
    await reviewed(s, newer.id, 'REJECT');
    const state = (await list(s)).items[0]!;
    expect(state).toMatchObject({
      freshness: 'STALE',
      currentAcceptedEvidence: { id: old.id, payload: { amount: '150.00' } },
      latestEvidence: { id: newer.id, review: { decision: 'REJECT' } },
    });
    expect((await preview(s, old.id)).blockers).toEqual(
      expect.arrayContaining(['ALREADY_REVIEWED', 'NEWER_SOURCE_EVIDENCE']),
    );
  });

  it('retains source entry ownership through accepted PARTIAL and ABSENT snapshots until a COMPLETE reset', async () => {
    const s = await seed();
    const one = await acceptInput(s, input({ entries: [entry('retained-A')] }));
    const two = await acceptInput(
      s,
      input({ sourceSequence: 2, detailCompleteness: 'PARTIAL', entries: [entry('retained-B')] }),
    );
    expect(two.review?.previousAcceptedEvidenceId).toBe(one.id);
    const other = await imported(
      s,
      input({ sourceReceiptId: 'receipt-B', entries: [entry('retained-A')] }),
    );
    expect((await preview(s, other.id)).blockers).toContain('SOURCE_ENTRY_OVERLAP');
    const three = await acceptInput(
      s,
      input({ sourceSequence: 3, detailCompleteness: 'ABSENT', entries: [] }),
    );
    expect(three.review?.previousAcceptedEvidenceId).toBe(two.id);
    expect((await preview(s, other.id)).blockers).toContain('SOURCE_ENTRY_OVERLAP');
    const four = await acceptInput(
      s,
      input({
        sourceSequence: 4,
        entries: [
          entry('retained-B', { sourceVersion: 'B-v2', amount: '-5.00', sourceAmount: '-5.00' }),
        ],
      }),
    );
    expect(four.review?.previousAcceptedEvidenceId).toBe(three.id);
    expect((await preview(s, other.id)).blockers).toEqual([]);
    await reviewed(s, other.id);
    expect(
      await prisma.postingSourceEntry.count({
        where: {
          organizationId: s.organizationId,
          receiptId: one.receiptId,
          sourceEntryId: 'retained-A',
        },
      }),
    ).toBe(1);
    const retainedB = await imported(
      s,
      input({ sourceReceiptId: 'receipt-C', entries: [entry('retained-B')] }),
    );
    expect((await preview(s, retainedB.id)).blockers).toContain('SOURCE_ENTRY_OVERLAP');
  });

  it('never resurrects IDs from before the latest COMPLETE reset when a later snapshot is partial', async () => {
    const s = await seed();
    await acceptInput(s, input({ entries: [entry('released-A')] }));
    await acceptInput(s, input({ sourceSequence: 2, entries: [entry('current-B')] }));
    await acceptInput(s, input({ sourceReceiptId: 'receipt-B', entries: [entry('released-A')] }));
    await acceptInput(
      s,
      input({ sourceSequence: 3, detailCompleteness: 'PARTIAL', entries: [entry('new-C')] }),
    );
    await acceptInput(s, input({ sourceSequence: 4, detailCompleteness: 'ABSENT', entries: [] }));
    const conflict = await imported(
      s,
      input({ sourceReceiptId: 'receipt-C', entries: [entry('current-B')] }),
    );
    expect((await preview(s, conflict.id)).blockers).toContain('SOURCE_ENTRY_OVERLAP');
  });

  it.each(['COMPLETE', 'PARTIAL', 'ABSENT'] as const)(
    'accepted REMOVED/%s releases entry identities without deleting prior mirrors or creating a refund',
    async (detailCompleteness) => {
      const s = await seed();
      const old = await acceptInput(s, input({ entries: [entry('removed-entry')] }));
      const before = await financialCounts();
      const deletion = await acceptInput(s, removed({ sourceSequence: 2, detailCompleteness }));
      expect(deletion.totals.completeEntryAmount).toBeNull();
      expect(deletion.totals.headerDifference).toBeNull();
      expect(deletion.review?.previousAcceptedEvidenceId).toBe(old.id);
      await acceptInput(
        s,
        input({ sourceReceiptId: 'replacement-receipt', entries: [entry('removed-entry')] }),
      );
      expect(await financialCounts()).toEqual(before);
      expect(
        await prisma.postingSourceEntry.count({
          where: { organizationId: s.organizationId, evidenceId: old.id },
        }),
      ).toBe(1);
    },
  );

  it.each(['unreviewed', 'rejected'] as const)(
    'a %s COMPLETE or REMOVED observation cannot release previously accepted identities',
    async (reviewState) => {
      const s = await seed();
      await acceptInput(s, input({ entries: [entry('historical-entry')] }));
      const candidate = await imported(
        s,
        input({ sourceReceiptId: 'other-receipt', entries: [entry('historical-entry')] }),
      );
      for (const p of [input({ sourceSequence: 2, entries: [] }), removed({ sourceSequence: 3 })]) {
        const reset = await imported(s, p);
        if (reviewState === 'rejected') await reviewed(s, reset.id, 'REJECT');
        expect((await preview(s, candidate.id)).blockers).toContain('SOURCE_ENTRY_OVERLAP');
        expect((await review(s, candidate.id, await reviewBody(s, candidate.id))).statusCode).toBe(
          409,
        );
      }
      expect((await reviewed(s, candidate.id, 'REJECT')).review?.decision).toBe('REJECT');
      expect(
        await prisma.postingSourceEntry.count({ where: { organizationId: s.organizationId } }),
      ).toBe(1);
    },
  );

  it.each(['organization', 'system', 'namespace'] as const)(
    'scopes duplicate entry identities by %s',
    async (dimension) => {
      const s = await seed();
      await acceptInput(s, input());
      const other = dimension === 'organization' ? await seed() : s;
      const row = await acceptInput(
        other,
        input({
          sourceReceiptId: 'independent-receipt',
          ...(dimension === 'system' ? { sourceSystem: 'OTHER_SYNTHETIC_PMS' } : {}),
          ...(dimension === 'namespace' ? { sourceNamespace: 'other-posting' } : {}),
        }),
      );
      expect(row.review?.decision).toBe('ACCEPT');
    },
  );

  it('does not infer entry identity from shared source claim/line IDs, deposit ID, trace or document', async () => {
    const s = await seed();
    await acceptInput(s, input({ entries: [entry('first-entry')] }));
    const row = await acceptInput(
      s,
      input({ sourceReceiptId: 'distinct-receipt', entries: [entry('second-entry')] }),
    );
    expect(row.review?.decision).toBe('ACCEPT');
  });

  it('keeps one immutable product per organization/system/namespace and rejects changed event or sequence contents', async () => {
    const s = await seed();
    const p = input();
    const row = await imported(s, p);
    for (const changed of [
      { ...p, sourceProduct: 'Different product' },
      { ...p, amount: '151.00', sourceAmount: '151.00' },
      { ...p, sourceReceiptId: 'different-receipt' },
      { ...p, sourceRecordId: 'new-record-same-sequence' },
      input({ sourceReceiptId: 'new-receipt', sourceProduct: 'Different product' }),
    ])
      expect((await upload(s, changed)).statusCode).toBe(409);
    const replay = await upload(s, p);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(row);
    expect(await prisma.postingSourceReceipt.count()).toBe(1);
    expect(await prisma.postingSourceEvidence.count()).toBe(1);
  });

  it('deduplicates simultaneous exact imports and reviews without duplicate children', async () => {
    const s = await seed();
    const results = await Promise.all([upload(s, input()), upload(s, input())]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 201]);
    expect(results[0].json()).toEqual(results[1].json());
    const id = PostingEvidenceSchema.parse(results[0].json()).id;
    const body = await reviewBody(s, id);
    const decisions = await Promise.all([review(s, id, body), review(s, id, body)]);
    expect(decisions.map((result) => result.statusCode)).toEqual([200, 200]);
    expect(decisions[0].json()).toEqual(decisions[1].json());
    expect(await prisma.postingSourceReview.count()).toBe(1);
    expect(await prisma.postingSourceEntry.count()).toBe(2);
  });

  it('allows only one accepted owner in simultaneous overlapping receipt reviews', async () => {
    const s = await seed();
    const a = await imported(s, input());
    const b = await imported(s, input({ sourceReceiptId: 'other-receipt' }));
    const [bodyA, bodyB] = await Promise.all([reviewBody(s, a.id), reviewBody(s, b.id)]);
    const results = await Promise.all([review(s, a.id, bodyA), review(s, b.id, bodyB)]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    const losingId = results[0].statusCode === 409 ? a.id : b.id;
    expect((await preview(s, losingId)).blockers).toContain('SOURCE_ENTRY_OVERLAP');
    expect(await prisma.postingSourceReview.count({ where: { decision: 'ACCEPT' } })).toBe(1);
    expect(await prisma.postingSourceEntry.count()).toBe(2);
  });

  it('serializes a review racing a newer source observation without reporting an obsolete snapshot current', async () => {
    const s = await seed();
    const old = await imported(s, input());
    const body = await reviewBody(s, old.id);
    const [decision, newer] = await Promise.all([
      review(s, old.id, body),
      upload(s, input({ sourceSequence: 2 })),
    ]);
    expect(newer.statusCode).toBe(201);
    expect([200, 409]).toContain(decision.statusCode);
    const state = (await list(s)).items[0]!;
    expect(state.latestSourceSequence).toBe(2);
    expect(state.freshness).toBe(decision.statusCode === 200 ? 'STALE' : 'UNREVIEWED');
  });

  it('invalidates old preview tokens for both source imports and decisions in the tenant ledger', async () => {
    const s = await seed();
    const a = await imported(s, input());
    const tokenBeforeImport = await reviewBody(s, a.id);
    const b = await imported(s, input({ sourceReceiptId: 'separate-receipt', entries: [] }));
    expect((await review(s, a.id, tokenBeforeImport)).statusCode).toBe(409);
    const tokenBeforeReview = await reviewBody(s, a.id);
    await reviewed(s, b.id, 'REJECT');
    expect((await review(s, a.id, tokenBeforeReview)).statusCode).toBe(409);
    await reviewed(s, a.id);
  });

  it('replays the exact reviewed evidence after later source changes and binds retry keys to actor, decision and evidence', async () => {
    const s = await seed();
    const other = await seed('ADMIN', s.organizationId);
    const a = await imported(s, input());
    const body = await reviewBody(s, a.id);
    const saved = await review(s, a.id, body);
    expect(saved.statusCode).toBe(200);
    const b = await acceptInput(s, removed({ sourceSequence: 2 }));
    const replay = await review(s, a.id, body);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(saved.json());
    expect((await upload(s, input())).json()).toEqual(saved.json());
    for (const result of [
      await review(other, a.id, body),
      await review(s, a.id, { ...body, decision: 'REJECT' }),
      await review(s, a.id, { ...body, reviewToken: '0'.repeat(64) }),
      await review(s, b.id, body),
      await review(s, a.id, { ...body, idempotencyKey: randomUUID() }),
    ])
      expect(result.statusCode).toBe(409);
  });

  it('isolates direct evidence/receipt references and lists across tenants', async () => {
    const a = await seed();
    const b = await seed();
    const row = await imported(a);
    const body = await reviewBody(a, row.id);
    expect((await list(b)).items).toEqual([]);
    for (const response of [
      await inject({ method: 'GET', url: `${BASE}/${row.id}/preview`, headers: b.headers }),
      await inject({ method: 'GET', url: `${BASE}/receipts/${row.receiptId}`, headers: b.headers }),
      await review(b, row.id, body),
    ])
      expect(response.statusCode).toBe(404);
    const own = await imported(b);
    expect(own.contentHash).not.toBe(row.contentHash);
    await reviewed(a, row.id);
    await reviewed(b, own.id);
    expect((await list(a)).items.map((item) => item.id)).toEqual([row.receiptId]);
    expect((await list(b)).items.map((item) => item.id)).toEqual([own.receiptId]);
  });

  it('rejects an unregistered actor and a forged tenant/role even through the test bypass', async () => {
    const a = await seed();
    const b = await seed();
    for (const headers of [
      {
        'x-test-user-id': 'nonexistent-user',
        'x-test-org-id': a.organizationId,
        'x-test-role': 'OWNER',
      },
      { 'x-test-user-id': a.user.id, 'x-test-org-id': b.organizationId, 'x-test-role': 'OWNER' },
    ]) {
      expect(
        (await inject({ method: 'POST', url: BASE, headers, payload: input() })).statusCode,
      ).toBe(403);
      expect((await inject({ method: 'GET', url: BASE, headers })).statusCode).toBe(403);
    }
    expect(await prisma.postingSourceEvidence.count()).toBe(0);
  });

  it.each(['posting.import', 'posting.review'] as const)(
    'rolls back all posting rows and mirrors when %s audit fails',
    async (action) => {
      const s = await seed();
      const payload = input({ paymentTrace: PRIVATE_MARKER });
      const row = action === 'posting.review' ? await imported(s, payload) : null;
      const body = row ? await reviewBody(s, row.id) : null;
      await failAudit(action);
      const result = row && body ? await review(s, row.id, body) : await upload(s, payload);
      expect(result.statusCode).toBe(500);
      expect(result.body).not.toContain(PRIVATE_MARKER);
      expect(logs.join('')).not.toContain(PRIVATE_MARKER);
      expect(await prisma.postingSourceEvidence.count()).toBe(row ? 1 : 0);
      expect(await prisma.postingSourceReceipt.count()).toBe(row ? 1 : 0);
      expect(await prisma.postingSourceReview.count()).toBe(0);
      expect(await prisma.postingSourceEntry.count()).toBe(0);
      await removeAuditFailure();
      if (row && body) expect((await review(s, row.id, body)).statusCode).toBe(200);
      else expect((await upload(s, payload)).statusCode).toBe(201);
    },
  );

  it('withholds list/history/preview and exact import/review replays when read audit fails', async () => {
    const s = await seed();
    const p = input({ paymentTrace: PRIVATE_MARKER });
    const row = await imported(s, p);
    const body = await reviewBody(s, row.id);
    expect((await review(s, row.id, body)).statusCode).toBe(200);
    await failAudit('posting.read');
    const results = await Promise.all([
      inject({ method: 'GET', url: BASE, headers: s.headers }),
      inject({ method: 'GET', url: `${BASE}/receipts/${row.receiptId}`, headers: s.headers }),
      inject({ method: 'GET', url: `${BASE}/${row.id}/preview`, headers: s.headers }),
      upload(s, p),
      review(s, row.id, body),
    ]);
    for (const result of results) {
      expect(result.statusCode).toBe(500);
      expect(result.body).not.toContain(PRIVATE_MARKER);
    }
    expect(logs.join('')).not.toContain(PRIVATE_MARKER);
    expect(await prisma.postingSourceReview.count()).toBe(1);
  });

  it('audits minimum source access metadata without copying source references or contents', async () => {
    const s = await seed();
    const p = input({
      paymentTrace: PRIVATE_MARKER,
      sourceDepositId: PRIVATE_MARKER,
      entries: [entry('synthetic-entry', { sourceClaimId: PRIVATE_MARKER })],
    });
    const row = await imported(s, p);
    await preview(s, row.id);
    const body = await reviewBody(s, row.id);
    await review(s, row.id, body);
    await review(s, row.id, body);
    await upload(s, p);
    await list(s);
    await history(s, row.receiptId);
    const audits = await prisma.auditLog.findMany({
      where: { organizationId: s.organizationId },
      select: { action: true, resourceType: true, resourceId: true, metadata: true },
    });
    expect(JSON.stringify(audits)).not.toContain(PRIVATE_MARKER);
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'posting.import',
          resourceType: 'PostingSourceEvidence',
          resourceId: row.id,
        }),
        expect.objectContaining({
          action: 'posting.review',
          resourceType: 'PostingSourceEvidence',
          resourceId: row.id,
        }),
        expect.objectContaining({
          action: 'posting.read',
          resourceType: 'Organization',
          resourceId: s.organizationId,
          metadata: { accessKind: 'LIST', resultCount: 1 },
        }),
        expect.objectContaining({
          action: 'posting.read',
          resourceType: 'PostingSourceReceipt',
          resourceId: row.receiptId,
          metadata: { accessKind: 'HISTORY', resultCount: 1 },
        }),
        expect.objectContaining({
          action: 'posting.read',
          resourceType: 'PostingSourceEvidence',
          resourceId: row.id,
          metadata: { accessKind: 'IMPORT_REPLAY', resultCount: 1 },
        }),
        expect.objectContaining({
          action: 'posting.read',
          resourceType: 'PostingSourceEvidence',
          resourceId: row.id,
          metadata: { accessKind: 'REVIEW_REPLAY', resultCount: 1 },
        }),
      ]),
    );
  });

  it('accepts exact UTF-16 token bounds, nullable source fields and raw unmapped statuses', async () => {
    const s = await seed();
    const p = input({
      sourceSystem: '𐐀'.repeat(16),
      sourceProduct: '𐐀'.repeat(40),
      sourceReceiptId: '𐐀'.repeat(100),
      sourceRecordId: '𐐀'.repeat(100),
      sourceVersion: '𐐀'.repeat(100),
      sourceDocumentId: '𐐀'.repeat(100),
      sourceStatus: '𐐀'.repeat(40),
      paymentTrace: '𐐀'.repeat(100),
      sourceDepositId: '𐐀'.repeat(100),
      entries: [
        entry('𐐀'.repeat(100), {
          sourceClaimId: '𐐀'.repeat(100),
          sourceLineId: '𐐀'.repeat(100),
          sourceProcedureId: '𐐀'.repeat(100),
          sourceVersion: '𐐀'.repeat(100),
          sourceStatus: '𐐀'.repeat(40),
          sourceIsTransfer: null,
        }),
      ],
    });
    const row = await acceptInput(s, p);
    expect(row.payload).toEqual(p);
    expect((await history(s, row.receiptId)).items[0]?.payload).toEqual(p);
    expect((await list(s)).items[0]?.latestEvidence.payload).toEqual(p);
  });

  it('normalizes absent optional fields to null for exact replay without conflating unknown amounts with zero', async () => {
    const s = await seed();
    const p = input({
      sourceVersion: null,
      sourceStatus: null,
      sourceIsPartial: null,
      sourceEntryDate: null,
      sourceIssuedDate: null,
      paymentTrace: null,
      sourceDepositId: null,
      amount: null,
      sourceAmount: null,
      entries: [
        entry('nullable', {
          sourceClaimId: null,
          sourceLineId: null,
          sourceProcedureId: null,
          sourceVersion: null,
          sourceStatus: null,
          sourceIsTransfer: null,
          amount: null,
          sourceAmount: null,
        }),
      ],
    });
    const raw: Record<string, unknown> = {
      ...Object.fromEntries(
        Object.entries(p).filter(
          ([key, value]) => value !== null || key === 'amount' || key === 'sourceAmount',
        ),
      ),
      entries: p.entries.map((item) =>
        Object.fromEntries(
          Object.entries(item).filter(
            ([key, value]) => value !== null || key === 'amount' || key === 'sourceAmount',
          ),
        ),
      ),
    };
    const first = await upload(s, raw);
    expect(first.statusCode).toBe(201);
    expect(PostingEvidenceSchema.parse(first.json()).payload).toEqual(p);
    const replay = await upload(s, p);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
  });

  it('rejects invalid money, signs, dates, duplicate entries and caller-provided authority with safe errors', async () => {
    const s = await seed();
    const base = input();
    const cases: unknown[] = [
      { ...base, amount: '-0.00', sourceAmount: '-0.00' },
      { ...base, amount: '01.00', sourceAmount: '01.00' },
      { ...base, amount: '100000000.00', sourceAmount: '100000000.00' },
      { ...base, amount: null, sourceAmount: '1.00' },
      { ...base, sourceSignConvention: 'DEBIT_POSITIVE' },
      { ...base, currency: 'EUR' },
      { ...base, sourceEntryDate: '2026-02-30' },
      { ...base, observedAt: '2026-02-30T12:00:00Z' },
      { ...base, sourceSequence: 0 },
      { ...base, sourceSequence: 2_147_483_648 },
      { ...base, entries: [entry('duplicate'), entry('duplicate')] },
      { ...base, detailCompleteness: 'ABSENT' },
      { ...base, status: 'REMOVED' },
      { ...base, entries: [entry('bad-sign', { sourceAmount: '-100.00' })] },
      { ...base, entries: Array.from({ length: 101 }, (_, i) => entry(String(i))) },
      { ...base, organizationId: s.organizationId },
      { ...base, sourceVerification: 'VERIFIED' },
      { ...base, entries: [{ ...entry('bad-link'), claimId: randomUUID() }] },
      { ...base, sourceProduct: PRIVATE_MARKER + '\u200b' },
      { ...base, sourceReceiptId: '𐐀'.repeat(101) },
      { ...base, sourceSystem: 'x'.repeat(33) },
      { ...base, sourceStatus: ' leading' },
      { ...base, sourceDepositId: '' },
      { ...base, entries: [entry('control\u0001')] },
      { ...base, entries: [entry('surrogate\ud800')] },
    ];
    for (const payload of cases) {
      const result = await upload(s, payload);
      expect(result.statusCode, result.body).toBe(400);
      expect(result.body).not.toContain(PRIVATE_MARKER);
    }
    expect(await prisma.postingSourceEvidence.count()).toBe(0);
    expect(logs.join('')).not.toContain(PRIVATE_MARKER);
  });

  it('rejects malformed JSON and oversized raw bodies without leaking parser input', async () => {
    const s = await seed();
    for (const [payload, status] of [
      [`{"private":"${PRIVATE_MARKER}"`, 400],
      [JSON.stringify(input()) + ' '.repeat(256 * 1024), 413],
    ] as const) {
      const result = await inject({
        method: 'POST',
        url: BASE,
        headers: { ...s.headers, 'content-type': 'application/json' },
        payload,
      });
      expect(result.statusCode).toBe(status);
      expect(result.body).not.toContain(PRIVATE_MARKER);
    }
    expect(logs.join('')).not.toContain(PRIVATE_MARKER);
  });

  it('rejects compact JSON below256KiB when its stored JSONB representation exceeds256KiB', async () => {
    const s = await seed();
    const maximum = 256 * 1024;
    const p = largeInput('storage-boundary', 1, maximum - 64);
    const serialized = JSON.stringify(p);
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(maximum);
    const sizes = await prisma.$queryRaw<
      { bytes: number }[]
    >`SELECT octet_length(${serialized}::jsonb::text) AS bytes`;
    expect(sizes[0]!.bytes).toBeGreaterThan(maximum);
    const result = await upload(s, p);
    expect(result.statusCode).toBe(400);
    expect(await prisma.postingSourceReceipt.count()).toBe(0);
    expect(await prisma.postingSourceEvidence.count()).toBe(0);
  });

  it('paginates receipt and source-sequence history with default10/max20 and scoped cursor kinds', async () => {
    const s = await seed();
    const rows = [];
    for (let i = 0; i < 22; i += 1)
      rows.push(await imported(s, input({ sourceReceiptId: `page-${String(i)}` })));
    expect((await list(s)).items).toHaveLength(10);
    const first = await list(s, '?limit=20');
    expect(first.items).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    const last = await list(s, `?limit=20&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(last.items).toHaveLength(2);
    expect(last.hasMore).toBe(false);
    expect(new Set([...first.items, ...last.items].map((item) => item.id)).size).toBe(22);
    const target = rows[0]!;
    for (let sequence = 2; sequence <= 22; sequence += 1)
      await imported(s, input({ sourceReceiptId: 'page-0', sourceSequence: sequence }));
    expect((await history(s, target.receiptId)).items).toHaveLength(10);
    const firstHistory = await history(s, target.receiptId, '?limit=20');
    const lastHistory = await history(
      s,
      target.receiptId,
      `?limit=20&cursor=${encodeURIComponent(firstHistory.nextCursor!)}`,
    );
    expect(
      [...firstHistory.items, ...lastHistory.items].map((item) => item.payload.sourceSequence),
    ).toEqual(Array.from({ length: 22 }, (_, i) => 22 - i));
    expect(lastHistory.hasMore).toBe(false);
    const otherTenant = await seed();
    for (const request of [
      {
        url: `${BASE}?cursor=${encodeURIComponent(first.nextCursor!)}`,
        headers: otherTenant.headers,
      },
      { url: `${BASE}?cursor=${encodeURIComponent(firstHistory.nextCursor!)}`, headers: s.headers },
      {
        url: `${BASE}/receipts/${target.receiptId}?cursor=${encodeURIComponent(first.nextCursor!)}`,
        headers: s.headers,
      },
      {
        url: `${BASE}/receipts/${rows[1]!.receiptId}?cursor=${encodeURIComponent(firstHistory.nextCursor!)}`,
        headers: s.headers,
      },
    ])
      expect((await inject({ method: 'GET', ...request })).statusCode).toBe(400);
  });

  it('caps large list and history pages at2MiB while cursors retain every source record', async () => {
    const s = await seed();
    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1)
      ids.push((await acceptInput(s, largeInput(`large-${String(i)}`))).receiptId);
    let cursor: string | null = null;
    const seen: string[] = [];
    do {
      const page = await list(
        s,
        `?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(page.items.length).toBeLessThan(7);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(seen)).toEqual(new Set(ids));
    expect(seen).toHaveLength(7);
    for (let sequence = 2; sequence <= 8; sequence += 1)
      await acceptInput(s, largeInput('large-0', sequence));
    const receiptId = ids[0]!;
    const first = await history(s, receiptId, '?limit=20');
    expect(first.hasMore).toBe(true);
    const second = await history(
      s,
      receiptId,
      `?limit=20&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(second.hasMore).toBe(false);
    expect([...first.items, ...second.items].map((item) => item.payload.sourceSequence)).toEqual([
      8, 7, 6, 5, 4, 3, 2, 1,
    ]);
  }, 30_000);

  it.each(['?limit=0', '?limit=21', '?limit=1.5', '?cursor=malformed', '?unexpected=value'])(
    'rejects invalid pagination %s for both list and history',
    async (suffix) => {
      const s = await seed();
      const row = await imported(s);
      for (const url of [`${BASE}${suffix}`, `${BASE}/receipts/${row.receiptId}${suffix}`])
        expect((await inject({ method: 'GET', url, headers: s.headers })).statusCode).toBe(400);
    },
  );

  it('retains immutable evidence and accepts only the closed review command', async () => {
    const s = await seed();
    const row = await imported(s);
    const body = await reviewBody(s, row.id);
    for (const payload of [
      { ...body, decision: 'UPDATE' },
      { ...body, reviewToken: 'wrong' },
      { ...body, idempotencyKey: 'wrong' },
      { ...body, reviewedByRole: 'OWNER' },
      { ...body, amount: '10.00' },
    ])
      expect(
        (
          await inject({
            method: 'POST',
            url: `${BASE}/${row.id}/review`,
            headers: s.headers,
            payload,
          })
        ).statusCode,
      ).toBe(400);
    for (const method of ['PATCH', 'DELETE'] as const)
      expect(
        (
          await inject({
            method,
            url: `${BASE}/${row.id}`,
            headers: s.headers,
            ...(method === 'PATCH' ? { payload: { amount: '10.00' } } : {}),
          })
        ).statusCode,
      ).toBe(404);
    expect((await preview(s, row.id)).evidence).toEqual(row);
    expect(await prisma.postingSourceReview.count()).toBe(0);
  });
});

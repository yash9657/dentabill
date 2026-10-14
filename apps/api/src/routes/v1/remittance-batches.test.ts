import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { prisma, type UserRole } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import {
  BatchEvidenceSchema,
  BatchInputSchema,
  BatchListSchema,
  BatchPreviewSchema,
  type BatchInput,
  type BatchReviewInput,
} from '../../lib/remittance-batches/contract.js';
import {
  EvidenceResponseSchema,
  PreviewResponseSchema,
  type RemittanceInput,
} from '../../lib/remittances/contract.js';

type FixtureName =
  | '01-balanced-180-minus-30.json'
  | '02-partial-unknown.json'
  | '03-zero-net.json'
  | '04-negative-net.json'
  | '05-provider-only-credit.json'
  | '06-signed-reversal.json';
function fixture(name: FixtureName): BatchInput {
  // The finite filename union references checked-in fabricated inputs only.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const raw = readFileSync(
    new URL(`../../../test/fixtures/remittance-batches/${name}`, import.meta.url),
    'utf8',
  );
  const value: unknown = JSON.parse(raw);
  return BatchInputSchema.parse(value);
}
function batch(overrides: Partial<BatchInput> = {}): BatchInput {
  return { ...fixture('01-balanced-180-minus-30.json'), ...overrides };
}
function providerOnly(overrides: Partial<BatchInput> = {}): BatchInput {
  return { ...fixture('05-provider-only-credit.json'), ...overrides };
}
function fresh(overrides: Partial<BatchInput> = {}): BatchInput {
  return providerOnly({ sourceBatchId: randomUUID(), sourceRecordId: randomUUID(), ...overrides });
}
async function seed(role: UserRole = 'BILLING_STAFF', existingOrganizationId?: string) {
  const organizationId =
    existingOrganizationId ??
    (
      await prisma.organization.create({
        data: { name: 'Synthetic batch practice', clerkOrgId: `org_${randomUUID()}` },
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
const BASE = '/v1/remittance-batches';
const PRIVATE_MARKER = 'SYNTHETIC-PRIVATE-BATCH-CONTENT';
const UNVERIFIED = {
  cashReceipt: 'UNVERIFIED',
  posting: 'UNVERIFIED',
  settlement: 'UNVERIFIED',
} as const;

describe('remittance batch evidence API (synthetic, real Postgres)', () => {
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
      throw new Error('Batch evidence tests require an isolated local DentaBill database.');
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
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_batch_test_audit ON "AuditLog"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_batch_test_audit()');
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
  async function imported(s: Seed, payload = batch()) {
    const result = await inject({ method: 'POST', url: BASE, headers: s.headers, payload });
    expect(result.statusCode, result.body).toBe(201);
    return BatchEvidenceSchema.parse(result.json());
  }
  async function preview(s: Seed, id: string) {
    const result = await inject({
      method: 'GET',
      url: `${BASE}/${id}/preview`,
      headers: s.headers,
    });
    expect(result.statusCode, result.body).toBe(200);
    return BatchPreviewSchema.parse(result.json());
  }
  async function reviewBody(
    s: Seed,
    id: string,
    decision: BatchReviewInput['decision'] = 'ACCEPT',
  ): Promise<BatchReviewInput> {
    return {
      decision,
      reviewToken: (await preview(s, id)).reviewToken,
      idempotencyKey: randomUUID(),
    };
  }
  function review(s: Seed, id: string, payload: BatchReviewInput) {
    return inject({ method: 'POST', url: `${BASE}/${id}/review`, headers: s.headers, payload });
  }
  async function accepted(s: Seed, id: string) {
    const result = await review(s, id, await reviewBody(s, id));
    expect(result.statusCode, result.body).toBe(200);
    return BatchEvidenceSchema.parse(result.json());
  }
  async function list(s: Seed, suffix = '') {
    const result = await inject({ method: 'GET', url: `${BASE}${suffix}`, headers: s.headers });
    expect(result.statusCode, result.body).toBe(200);
    expect(Buffer.byteLength(result.body)).toBeLessThanOrEqual(2 * 1024 * 1024);
    return BatchListSchema.parse(result.json());
  }
  async function claim(s: Seed) {
    return prisma.claim.create({
      data: {
        organizationId: s.organizationId,
        claimNumber: `SYNTHETIC-${randomUUID()}`,
        patientDOBHash: 'synthetic-only',
        claimAmount: '200.00',
        payerCode: 'CIGNA_DENTAL',
        serviceDate: new Date('2026-10-01'),
        status: 'COMPLETED',
      },
    });
  }
  async function memberReview(
    s: Seed,
    row: { id: string; claimId: string },
    decision: 'ACCEPT' | 'REJECT' = 'ACCEPT',
  ) {
    const url = `/v1/claims/${row.claimId}/remittances/${row.id}`;
    const p = await inject({ method: 'GET', url: `${url}/preview`, headers: s.headers });
    expect(p.statusCode, p.body).toBe(200);
    const body = PreviewResponseSchema.parse(p.json());
    const result = await inject({
      method: 'POST',
      url: `${url}/review`,
      headers: s.headers,
      payload: { decision, reviewToken: body.reviewToken, idempotencyKey: randomUUID() },
    });
    expect(result.statusCode, result.body).toBe(200);
    return EvidenceResponseSchema.parse(result.json());
  }
  async function member(
    s: Seed,
    sourceRecordId: string,
    reportedAmount = '100.00',
    decision: 'ACCEPT' | 'REJECT' | null = 'ACCEPT',
    options: { claimId?: string; overrides?: Partial<RemittanceInput> } = {},
  ) {
    const claimId = options.claimId ?? (await claim(s)).id;
    const payload: RemittanceInput = {
      schemaVersion: 1,
      sourceNamespace: 'synthetic-remittance',
      sourceRecordId,
      sourceDocumentId: 'synthetic-remittance-document',
      sourceVersion: '1',
      kind: 'PAYMENT',
      reversesSourceRecordId: null,
      currency: 'USD',
      reportedAmount,
      payerName: 'Synthetic Dental Payer',
      payerIdentifier: 'synthetic-payer',
      payerIdentifierSystem: 'SYNTHETIC',
      payerClaimControlNumber: null,
      sourceCoverageId: null,
      paymentTrace: 'synthetic-shared-trace',
      paymentTraceType: 'SYNTHETIC_REFERENCE',
      paymentTraceIssuer: 'synthetic-payer',
      reportedDate: '2026-10-01',
      sourceStatus: 'payer-reported-only',
      lineDetailCompleteness: 'ABSENT',
      allocations: [],
      adjustments: [],
      ...options.overrides,
    };
    const result = await inject({
      method: 'POST',
      url: `/v1/claims/${claimId}/remittances`,
      headers: s.headers,
      payload,
    });
    expect(result.statusCode, result.body).toBe(201);
    const row = EvidenceResponseSchema.parse(result.json());
    return decision ? memberReview(s, row, decision) : row;
  }
  async function members(s: Seed) {
    return [
      await member(s, 'synthetic-claim-report-100', '100.00'),
      await member(s, 'synthetic-claim-report-80', '80.00'),
    ];
  }
  async function retainedFinancialState(s: Seed) {
    const where = { organizationId: s.organizationId };
    return {
      claims: await prisma.claim.findMany({ where, orderBy: { id: 'asc' } }),
      remittances: await prisma.claimRemittanceEvidence.findMany({ where, orderBy: { id: 'asc' } }),
      reviews: await prisma.claimRemittanceReview.findMany({ where, orderBy: { id: 'asc' } }),
      allocations: await prisma.claimRemittanceAllocation.count({ where }),
      adjustments: await prisma.claimRemittanceAdjustment.count({ where }),
      cashTransactions: await prisma.cashSourceTransaction.count({ where }),
      cashEvidence: await prisma.cashSourceEvidence.count({ where }),
      cashReviews: await prisma.cashSourceReview.count({ where }),
      usage: await prisma.billingUsageRecord.count({ where }),
    };
  }
  async function batchCounts(s: Seed) {
    const where = { organizationId: s.organizationId };
    return {
      evidence: await prisma.remittanceBatchEvidence.count({ where }),
      reviews: await prisma.remittanceBatchReview.count({ where }),
      claims: await prisma.remittanceBatchClaim.count({ where }),
      adjustments: await prisma.remittanceBatchAdjustment.count({ where }),
    };
  }
  async function failAudit(action: 'batch.import' | 'batch.review' | 'batch.read'): Promise<void> {
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_batch_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION '${PRIVATE_MARKER}'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_batch_test_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_batch_test_audit()',
    );
  }

  it('requires authentication on list, import, preview and review', async () => {
    const s = await seed();
    const row = await imported(s, providerOnly());
    const body = await reviewBody(s, row.id);
    const responses = await Promise.all([
      inject({ method: 'GET', url: BASE }),
      inject({ method: 'POST', url: BASE, payload: providerOnly() }),
      inject({ method: 'GET', url: `${BASE}/${row.id}/preview` }),
      inject({ method: 'POST', url: `${BASE}/${row.id}/review`, payload: body }),
    ]);
    expect(responses.map((result) => result.statusCode)).toEqual([401, 401, 401, 401]);
    expect(await batchCounts(s)).toEqual({ evidence: 1, reviews: 0, claims: 0, adjustments: 0 });
  });

  it.each(['OWNER', 'ADMIN', 'BILLING_STAFF'] as const)(
    'uses stored %s role and records the actor',
    async (role) => {
      const s = await seed(role);
      const row = await imported(s, providerOnly());
      expect((await accepted(s, row.id)).review).toMatchObject({
        decision: 'ACCEPT',
        reviewedByUserId: s.user.id,
        reviewedByRole: role,
      });
    },
  );

  it('does not trust caller-supplied organization or role for an unregistered actor', async () => {
    const s = await seed();
    const result = await inject({
      method: 'POST',
      url: BASE,
      headers: {
        'x-test-user-id': 'unknown-actor',
        'x-role': 'OWNER',
        'x-organization-id': s.organizationId,
      },
      payload: providerOnly(),
    });
    expect(result.statusCode).toBe(403);
    expect((await batchCounts(s)).evidence).toBe(0);
  });

  it('isolates identical batch identities and member lookup by tenant', async () => {
    const a = await seed();
    const b = await seed();
    await members(a);
    const first = await imported(a);
    const second = await imported(b);
    expect(second.id).not.toBe(first.id);
    expect((await list(a)).items.map((item) => item.id)).toEqual([first.id]);
    expect((await list(b)).items.map((item) => item.id)).toEqual([second.id]);
    expect((await preview(a, first.id)).blockers).toEqual([]);
    const otherPreview = await preview(b, second.id);
    expect(otherPreview.blockers).toContain('MEMBER_MISSING');
    expect(
      otherPreview.members.every((item) => item.evidenceId === null && item.claimId === null),
    ).toBe(true);
    expect(
      (await inject({ method: 'GET', url: `${BASE}/${first.id}/preview`, headers: b.headers }))
        .statusCode,
    ).toBe(404);
    expect((await review(b, first.id, await reviewBody(a, first.id))).statusCode).toBe(404);
    expect((await batchCounts(a)).reviews).toBe(0);
    expect((await batchCounts(b)).reviews).toBe(0);
  });

  it('retains gross100+80 and provider reduction30 as net150 without allocating cash or changing claim evidence', async () => {
    const s = await seed();
    const reports = await members(s);
    const before = await retainedFinancialState(s);
    const row = await imported(s);
    expect(row).toMatchObject({ provenance: 'MANUAL_UPLOAD', ...UNVERIFIED, review: null });
    const p = await preview(s, row.id);
    expect(p).toMatchObject({
      ...UNVERIFIED,
      listedClaimAmount: '180.00',
      listedAdjustmentAmount: '-30.00',
      calculatedNetAmount: '150.00',
      blockers: [],
    });
    expect(p.members.map((item) => item.evidenceId)).toEqual(reports.map((item) => item.id));
    expect(p.members.map((item) => item.reviewId)).toEqual(reports.map((item) => item.review?.id));
    expect(p.members.every((item) => item.status === 'MATCHED')).toBe(true);
    const result = await accepted(s, row.id);
    expect(result).toMatchObject({ provenance: 'MANUAL_UPLOAD', ...UNVERIFIED });
    expect(result.review).toMatchObject({
      claimReportedAmount: '180.00',
      providerAdjustmentAmount: '-30.00',
      netAmount: '150.00',
    });
    expect(result.review?.members.map((item) => [item.sourceIndex, item.amount])).toEqual([
      [0, '100.00'],
      [1, '80.00'],
    ]);
    expect(result.review?.members.map((item) => item.remittanceEvidenceId)).toEqual(
      reports.map((item) => item.id),
    );
    expect(result.payload.providerAdjustments).toEqual(batch().providerAdjustments);
    expect(await retainedFinancialState(s)).toEqual(before);
    expect(await batchCounts(s)).toEqual({ evidence: 1, reviews: 1, claims: 2, adjustments: 1 });
    expect((await list(s)).items[0]).toEqual(result);
  });

  it.each([
    ['03-zero-net.json', '0.00'],
    ['04-negative-net.json', '-25.00'],
  ] as const)('preserves signed source net for %s', async (name, netAmount) => {
    const s = await seed();
    await member(s, 'synthetic-claim-report-100');
    const row = await imported(s, fixture(name));
    expect((await preview(s, row.id)).blockers).toEqual([]);
    const result = await accepted(s, row.id);
    expect(result.review).toMatchObject({ claimReportedAmount: '100.00', netAmount });
    expect(result).toMatchObject(UNVERIFIED);
    expect(result.review?.members[0]?.amount).toBe('100.00');
  });

  it('accepts a provider-only source credit without inventing claim members', async () => {
    const s = await seed();
    const row = await imported(s, providerOnly());
    const result = await accepted(s, row.id);
    expect(result.review).toMatchObject({
      members: [],
      claimReportedAmount: '0.00',
      providerAdjustmentAmount: '15.00',
      netAmount: '15.00',
    });
    expect(result.payload.providerAdjustments[0]).toMatchObject({
      reasonCode: 'UNMAPPED-CREDIT',
      sourceAmount: '15.00',
      amount: '15.00',
      sourceSignConvention: 'NET_EFFECT_POSITIVE',
    });
    expect((await retainedFinancialState(s)).claims).toEqual([]);
    expect(await batchCounts(s)).toEqual({ evidence: 1, reviews: 1, claims: 0, adjustments: 1 });
  });

  it('binds an accepted claim reversal with its signed full amount instead of rewriting the original payment', async () => {
    const s = await seed();
    const original = await member(s, 'synthetic-claim-report-100');
    const reversal = await member(s, 'synthetic-claim-reversal-35', '-35.00', 'ACCEPT', {
      claimId: original.claimId,
      overrides: { kind: 'REVERSAL', reversesSourceRecordId: original.payload.sourceRecordId },
    });
    const before = await retainedFinancialState(s);
    const row = await imported(s, fixture('06-signed-reversal.json'));
    const result = await accepted(s, row.id);
    expect(result.review).toMatchObject({
      claimReportedAmount: '65.00',
      providerAdjustmentAmount: '-5.00',
      netAmount: '60.00',
    });
    expect(result.review?.members.map((item) => [item.remittanceEvidenceId, item.amount])).toEqual([
      [original.id, '100.00'],
      [reversal.id, '-35.00'],
    ]);
    expect(await retainedFinancialState(s)).toEqual(before);
  });

  it('does not infer membership or uniqueness from shared payment trace or source document', async () => {
    const s = await seed();
    await members(s);
    await member(s, 'unlisted-same-trace', '10.00');
    const first = await imported(s);
    const other = await imported(
      s,
      fresh({ paymentTrace: batch().paymentTrace, sourceDocumentId: batch().sourceDocumentId }),
    );
    const result = await accepted(s, first.id);
    expect(result.review?.members).toHaveLength(2);
    expect((await accepted(s, other.id)).review?.members).toEqual([]);
    expect((await batchCounts(s)).claims).toBe(2);
  });

  it.each([
    ['partial detail', { detailCompleteness: 'PARTIAL' }, 'INCOMPLETE_DETAIL'],
    [
      'absent detail',
      {
        detailCompleteness: 'ABSENT',
        claimRemittances: [],
        providerAdjustments: [],
        reportedClaimAmount: null,
        reportedAdjustmentAmount: null,
        reportedNetAmount: null,
      },
      'INCOMPLETE_DETAIL',
    ],
    ['unknown claim total', { reportedClaimAmount: null }, 'UNKNOWN_TOTALS'],
    ['unknown adjustment total', { reportedAdjustmentAmount: null }, 'UNKNOWN_TOTALS'],
    ['unknown net total', { reportedNetAmount: null }, 'UNKNOWN_TOTALS'],
    ['wrong gross total', { reportedClaimAmount: '179.00' }, 'TOTAL_MISMATCH'],
    ['wrong adjustment total', { reportedAdjustmentAmount: '30.00' }, 'TOTAL_MISMATCH'],
    ['wrong net total', { reportedNetAmount: '180.00' }, 'TOTAL_MISMATCH'],
  ] satisfies [string, Partial<BatchInput>, string][])(
    'imports %s for review but only permits rejection',
    async (_name, overrides, blocker) => {
      const s = await seed();
      await members(s);
      const row = await imported(s, batch(overrides));
      const p = await preview(s, row.id);
      expect(p.blockers).toContain(blocker);
      expect(
        (
          await review(s, row.id, {
            decision: 'ACCEPT',
            reviewToken: p.reviewToken,
            idempotencyKey: randomUUID(),
          })
        ).statusCode,
      ).toBe(409);
      const result = await review(s, row.id, await reviewBody(s, row.id, 'REJECT'));
      expect(result.statusCode, result.body).toBe(200);
      expect(BatchEvidenceSchema.parse(result.json()).review?.decision).toBe('REJECT');
      expect(await batchCounts(s)).toEqual({ evidence: 1, reviews: 1, claims: 0, adjustments: 0 });
    },
  );

  it('retains the copyable partial/unknown fixture with null amounts instead of fabricated zeroes', async () => {
    const s = await seed();
    const payload = fixture('02-partial-unknown.json');
    const row = await imported(s, payload);
    expect(row.payload).toEqual(payload);
    expect((await preview(s, row.id)).blockers).toEqual(
      expect.arrayContaining(['INCOMPLETE_DETAIL', 'UNKNOWN_TOTALS', 'MEMBER_MISSING']),
    );
    expect(row.payload.reportedAdjustmentAmount).toBeNull();
    expect(row.payload.reportedNetAmount).toBeNull();
  });

  it.each(['MISSING', 'UNREVIEWED', 'REJECTED', 'AMOUNT_MISMATCH'] as const)(
    'blocks an explicit member with %s state',
    async (state) => {
      const s = await seed();
      if (state !== 'MISSING')
        await member(
          s,
          'synthetic-claim-report-100',
          state === 'AMOUNT_MISMATCH' ? '99.00' : '100.00',
          state === 'UNREVIEWED' ? null : state === 'REJECTED' ? 'REJECT' : 'ACCEPT',
        );
      await member(s, 'synthetic-claim-report-80', '80.00');
      const row = await imported(s);
      const p = await preview(s, row.id);
      expect(p.members[0]?.status).toBe(state);
      expect(p.blockers).toContain(
        state === 'MISSING'
          ? 'MEMBER_MISSING'
          : state === 'AMOUNT_MISMATCH'
            ? 'MEMBER_AMOUNT_MISMATCH'
            : 'MEMBER_NOT_ACCEPTED',
      );
      expect((await review(s, row.id, await reviewBody(s, row.id))).statusCode).toBe(409);
      expect((await review(s, row.id, await reviewBody(s, row.id, 'REJECT'))).statusCode).toBe(200);
      expect((await batchCounts(s)).claims).toBe(0);
    },
  );

  it('uses the exact member namespace and does not match the same record ID in another source', async () => {
    const s = await seed();
    await member(s, 'synthetic-claim-report-100', '100.00', 'ACCEPT', {
      overrides: { sourceNamespace: 'other-source' },
    });
    await member(s, 'synthetic-claim-report-80', '80.00');
    const row = await imported(s);
    expect((await preview(s, row.id)).members[0]).toMatchObject({
      status: 'MISSING',
      evidenceId: null,
    });
  });

  it('invalidates the old batch preview when an explicitly referenced member is reviewed', async () => {
    const s = await seed();
    const pending = await member(s, 'synthetic-claim-report-100', '100.00', null);
    await member(s, 'synthetic-claim-report-80', '80.00');
    const row = await imported(s);
    const stale = await reviewBody(s, row.id);
    await memberReview(s, pending);
    expect((await review(s, row.id, stale)).statusCode).toBe(409);
    const current = await preview(s, row.id);
    expect(current.reviewToken).not.toBe(stale.reviewToken);
    expect(current.blockers).toEqual([]);
    expect((await accepted(s, row.id)).review?.members).toHaveLength(2);
  });

  it('admits concurrent exact imports once and audits replay without cloning records', async () => {
    const s = await seed();
    const payload = providerOnly();
    const results = await Promise.all(
      [1, 2].map(() => inject({ method: 'POST', url: BASE, headers: s.headers, payload })),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(new Set(results.map((r) => BatchEvidenceSchema.parse(r.json()).id)).size).toBe(1);
    expect((await batchCounts(s)).evidence).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: s.organizationId, action: 'batch.import' },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: s.organizationId, action: 'batch.read' },
      }),
    ).toBe(1);
  });

  it.each([
    { sourceRecordId: 'different-source-record' },
    { sourceBatchId: 'different-source-batch' },
    { sourceVersion: '2' },
    { reportedNetAmount: '14.00' },
  ] satisfies Partial<BatchInput>[])(
    'conflicts on changed immutable source identity or content %j',
    async (overrides) => {
      const s = await seed();
      const original = await imported(s, providerOnly());
      const result = await inject({
        method: 'POST',
        url: BASE,
        headers: s.headers,
        payload: providerOnly(overrides),
      });
      expect(result.statusCode).toBe(409);
      expect((await list(s)).items).toEqual([original]);
    },
  );

  it('keeps identical opaque batch IDs independent across namespaces', async () => {
    const s = await seed();
    const first = await imported(s, providerOnly());
    const second = await imported(s, providerOnly({ sourceNamespace: 'other-source' }));
    expect(second.id).not.toBe(first.id);
    expect((await batchCounts(s)).evidence).toBe(2);
  });

  it('rejects stale preview after batch evidence or review changes in the organization', async () => {
    const s = await seed();
    const first = await imported(s, providerOnly());
    const staleAfterImport = await reviewBody(s, first.id);
    const other = await imported(s, fresh());
    expect((await review(s, first.id, staleAfterImport)).statusCode).toBe(409);
    const staleAfterReview = await reviewBody(s, first.id);
    await accepted(s, other.id);
    expect((await review(s, first.id, staleAfterReview)).statusCode).toBe(409);
    await accepted(s, first.id);
  });

  it('replays identical simultaneous reviews and a lost response after later evidence changes', async () => {
    const s = await seed();
    const row = await imported(s, providerOnly());
    const command = await reviewBody(s, row.id);
    const results = await Promise.all([review(s, row.id, command), review(s, row.id, command)]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    const original = BatchEvidenceSchema.parse(results[0].json());
    expect(BatchEvidenceSchema.parse(results[1].json())).toEqual(original);
    await imported(s, fresh());
    const replay = await review(s, row.id, command);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(BatchEvidenceSchema.parse(replay.json())).toEqual(original);
    expect((await batchCounts(s)).reviews).toBe(1);
  });

  it('binds review replay to the exact actor, decision, preview token and evidence', async () => {
    const s = await seed();
    const otherActor = await seed('ADMIN', s.organizationId);
    const first = await imported(s, providerOnly());
    const second = await imported(s, fresh());
    const command = await reviewBody(s, first.id);
    expect((await review(s, first.id, command)).statusCode).toBe(200);
    expect((await review(otherActor, first.id, command)).statusCode).toBe(409);
    expect((await review(s, first.id, { ...command, decision: 'REJECT' })).statusCode).toBe(409);
    expect(
      (await review(s, first.id, { ...command, reviewToken: '0'.repeat(64) })).statusCode,
    ).toBe(409);
    expect((await review(s, second.id, command)).statusCode).toBe(409);
    expect(
      (await review(s, first.id, { ...command, idempotencyKey: randomUUID() })).statusCode,
    ).toBe(409);
    expect((await batchCounts(s)).reviews).toBe(1);
  });

  it('permits only one competing acceptance for the same full claim remittances', async () => {
    const s = await seed();
    await members(s);
    const a = await imported(s);
    const b = await imported(
      s,
      batch({ sourceBatchId: 'other-batch', sourceRecordId: 'other-record' }),
    );
    const aCommand = await reviewBody(s, a.id);
    const bCommand = await reviewBody(s, b.id);
    const results = await Promise.all([review(s, a.id, aCommand), review(s, b.id, bCommand)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const loser = results[0].statusCode === 409 ? a : b;
    const p = await preview(s, loser.id);
    expect(p.blockers).toContain('MEMBER_ALREADY_BATCHED');
    expect(p.members.map((item) => item.status)).toEqual(['ALREADY_BATCHED', 'ALREADY_BATCHED']);
    expect((await review(s, loser.id, await reviewBody(s, loser.id))).statusCode).toBe(409);
    expect((await review(s, loser.id, await reviewBody(s, loser.id, 'REJECT'))).statusCode).toBe(
      200,
    );
    expect(await batchCounts(s)).toEqual({ evidence: 2, reviews: 2, claims: 2, adjustments: 1 });
  });

  it('does not reserve a member when a batch is rejected', async () => {
    const s = await seed();
    await members(s);
    const first = await imported(s);
    expect((await review(s, first.id, await reviewBody(s, first.id, 'REJECT'))).statusCode).toBe(
      200,
    );
    const second = await imported(
      s,
      batch({ sourceBatchId: 'replacement-batch', sourceRecordId: 'replacement-record' }),
    );
    expect((await accepted(s, second.id)).review?.members).toHaveLength(2);
    expect((await batchCounts(s)).claims).toBe(2);
  });

  it.each(['batch.import', 'batch.review'] as const)(
    'rolls back all new records if %s audit fails',
    async (action) => {
      const s = await seed();
      await members(s);
      const row = action === 'batch.review' ? await imported(s) : null;
      const command = row ? await reviewBody(s, row.id) : null;
      const before = await retainedFinancialState(s);
      const counts = await batchCounts(s);
      await failAudit(action);
      const result =
        row && command
          ? await review(s, row.id, command)
          : await inject({ method: 'POST', url: BASE, headers: s.headers, payload: batch() });
      expect(result.statusCode).toBe(500);
      expect(result.body).not.toContain(PRIVATE_MARKER);
      expect(logs.join('')).not.toContain(PRIVATE_MARKER);
      expect(await batchCounts(s)).toEqual(counts);
      expect(await retainedFinancialState(s)).toEqual(before);
    },
  );

  it('withholds list, preview and exact replay responses when scoped read audit fails', async () => {
    const s = await seed();
    const row = await imported(s, providerOnly());
    const command = await reviewBody(s, row.id);
    expect((await review(s, row.id, command)).statusCode).toBe(200);
    const counts = await batchCounts(s);
    await failAudit('batch.read');
    const results = await Promise.all([
      inject({ method: 'GET', url: BASE, headers: s.headers }),
      inject({ method: 'GET', url: `${BASE}/${row.id}/preview`, headers: s.headers }),
      inject({ method: 'POST', url: BASE, headers: s.headers, payload: providerOnly() }),
      review(s, row.id, command),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([500, 500, 500, 500]);
    for (const result of results) {
      expect(result.body).not.toContain(PRIVATE_MARKER);
      expect(result.body).not.toContain(row.payload.sourceBatchId);
    }
    expect(logs.join('')).not.toContain(PRIVATE_MARKER);
    expect(await batchCounts(s)).toEqual(counts);
  });

  it('paginates stable source records at default10/max20 and refuses foreign cursors', async () => {
    const s = await seed();
    const other = await seed();
    const ids: string[] = [];
    for (let index = 0; index < 12; index += 1) ids.push((await imported(s, fresh())).id);
    const first = await list(s);
    expect(first.items).toHaveLength(10);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(s, `?cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.items).toHaveLength(2);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((row) => row.id)).toEqual([...ids].reverse());
    expect((await list(s, '?limit=20')).items).toHaveLength(12);
    expect(
      (
        await inject({
          method: 'GET',
          url: `${BASE}?cursor=${encodeURIComponent(first.nextCursor!)}`,
          headers: other.headers,
        })
      ).statusCode,
    ).toBe(400);
  });

  it.each(['?limit=0', '?limit=21', '?limit=1.5', '?cursor=malformed', '?unknown=private'])(
    'rejects invalid bounded pagination %s',
    async (suffix) => {
      const s = await seed();
      expect(
        (await inject({ method: 'GET', url: `${BASE}${suffix}`, headers: s.headers })).statusCode,
      ).toBe(400);
    },
  );

  it('rejects duplicates, invalid sign conventions, excess detail and malformed input without payload logging', async () => {
    const s = await seed();
    const p = batch();
    const adjustment = p.providerAdjustments[0]!;
    const memberRef = p.claimRemittances[0]!;
    const invalid: unknown[] = [
      { ...p, evidenceBasis: 'BANK_ACCOUNT_TRANSACTION' },
      { ...p, cashReceipt: 'VERIFIED' },
      { ...p, organizationId: s.organizationId },
      { ...p, sourceBatchId: ` ${PRIVATE_MARKER}` },
      { ...p, sourceNamespace: 'source\n' },
      { ...p, sourceRecordId: '𐐀'.repeat(100) + 'a' },
      { ...p, sourceDocumentId: '\ud800' },
      { ...p, payerName: `x\u200b${PRIVATE_MARKER}` },
      { ...p, reportedNetAmount: '-0.00' },
      { ...p, reportedDate: '2026-02-30' },
      { ...p, claimRemittances: [memberRef, memberRef] },
      { ...p, providerAdjustments: [adjustment, adjustment] },
      { ...p, detailCompleteness: 'ABSENT' },
      { ...p, providerAdjustments: [{ ...adjustment, sourceAmount: '-30.00' }] },
      { ...p, providerAdjustments: [{ ...adjustment, sourceSignConvention: 'UNKNOWN' }] },
      { ...p, providerAdjustments: [{ ...adjustment, fiscalPeriodEnd: '2026-02-30' }] },
      {
        ...p,
        claimRemittances: Array.from({ length: 101 }, (_, index) => ({
          ...memberRef,
          sourceRecordId: `member-${String(index)}`,
        })),
      },
      {
        ...p,
        providerAdjustments: Array.from({ length: 101 }, (_, index) => ({
          ...adjustment,
          sourceAdjustmentId: `adjustment-${String(index)}`,
        })),
      },
    ];
    for (const payload of invalid) {
      const result = await inject({
        method: 'POST',
        url: BASE,
        headers: { ...s.headers, 'content-type': 'application/json' },
        payload: JSON.stringify(payload),
      });
      expect(result.statusCode, result.body).toBe(400);
      expect(result.body).not.toContain(PRIVATE_MARKER);
    }
    const malformed = await inject({
      method: 'POST',
      url: BASE,
      headers: { ...s.headers, 'content-type': 'application/json' },
      payload: `{"payerName":"${PRIVATE_MARKER}",`,
    });
    expect(malformed.statusCode).toBe(400);
    const oversized = await inject({
      method: 'POST',
      url: BASE,
      headers: { ...s.headers, 'content-type': 'application/json' },
      payload: `${JSON.stringify(p)}${' '.repeat(256 * 1024)}`,
    });
    expect(oversized.statusCode).toBe(413);
    expect(await batchCounts(s)).toEqual({ evidence: 0, reviews: 0, claims: 0, adjustments: 0 });
    expect(logs.join('')).not.toContain(PRIVATE_MARKER);
  });

  it('accepts maximum100-item source arrays for review without assuming their members exist', async () => {
    const s = await seed();
    const p = batch();
    const row = await imported(
      s,
      batch({
        reportedClaimAmount: null,
        reportedAdjustmentAmount: null,
        reportedNetAmount: null,
        claimRemittances: Array.from({ length: 100 }, (_, index) => ({
          ...p.claimRemittances[0]!,
          sourceRecordId: `member-${String(index)}`,
        })),
        providerAdjustments: Array.from({ length: 100 }, (_, index) => ({
          ...p.providerAdjustments[0]!,
          sourceAdjustmentId: `adjustment-${String(index)}`,
        })),
      }),
    );
    const result = await preview(s, row.id);
    expect(result.members).toHaveLength(100);
    expect(result.blockers).toEqual(expect.arrayContaining(['MEMBER_MISSING', 'UNKNOWN_TOTALS']));
    expect((await review(s, row.id, await reviewBody(s, row.id, 'REJECT'))).statusCode).toBe(200);
  });

  it('rejects a compact payload below256KiB when its canonical JSONB storage exceeds the limit', async () => {
    const s = await seed();
    const maximum = 256 * 1024;
    const p = batch({
      reportedClaimAmount: null,
      reportedAdjustmentAmount: null,
      reportedNetAmount: null,
      claimRemittances: Array.from({ length: 100 }, (_, index) => ({
        sourceNamespace: 'synthetic-remittance',
        sourceRecordId: String(index).padStart(3, '0') + 'a'.repeat(197),
        reportedAmount: '0.00',
      })),
      providerAdjustments: Array.from({ length: 100 }, (_, index) => ({
        sourceAdjustmentId: String(index).padStart(3, '0') + 'a'.repeat(197),
        codeSystem: 'a'.repeat(32),
        reasonCode: 'a'.repeat(32),
        sourceReference: 'a'.repeat(200),
        providerIdentifier: 'a'.repeat(200),
        fiscalPeriodEnd: null,
        amount: '0.00',
        sourceAmount: '0.00',
        sourceSignConvention: 'NET_EFFECT_POSITIVE',
      })),
    });
    let remaining = Math.floor((maximum - 64 - Buffer.byteLength(JSON.stringify(p))) / 2);
    function promote(value: string, identityPrefix = 0): string {
      const count = Math.min(remaining, value.length - identityPrefix);
      remaining -= count;
      return (
        value.slice(0, identityPrefix) + '界'.repeat(count) + value.slice(identityPrefix + count)
      );
    }
    for (const item of p.claimRemittances) item.sourceRecordId = promote(item.sourceRecordId, 3);
    for (const item of p.providerAdjustments) {
      item.sourceAdjustmentId = promote(item.sourceAdjustmentId, 3);
      item.codeSystem = promote(item.codeSystem);
      item.reasonCode = promote(item.reasonCode);
      item.sourceReference = promote(item.sourceReference!);
      item.providerIdentifier = promote(item.providerIdentifier!);
    }
    expect(remaining).toBe(0);
    expect(BatchInputSchema.safeParse(p).success).toBe(true);
    const serialized = JSON.stringify(p);
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(maximum);
    const sizes = await prisma.$queryRaw<{ bytes: number }[]>`
      SELECT octet_length(${serialized}::jsonb::text) AS bytes`;
    expect(sizes[0]?.bytes).toBeGreaterThan(maximum);
    const result = await inject({
      method: 'POST',
      url: BASE,
      headers: { ...s.headers, 'content-type': 'application/json' },
      payload: serialized,
    });
    expect(result.statusCode, result.body).toBe(400);
    expect(await batchCounts(s)).toEqual({ evidence: 0, reviews: 0, claims: 0, adjustments: 0 });
  });

  it('exposes no overwrite/delete/reconciliation action and rejects caller-authored review results', async () => {
    const s = await seed();
    const row = await imported(s, providerOnly());
    const body = await reviewBody(s, row.id);
    for (const method of ['PATCH', 'DELETE'] as const)
      expect(
        (await inject({ method, url: `${BASE}/${row.id}`, headers: s.headers })).statusCode,
      ).toBe(404);
    expect(
      (
        await inject({
          method: 'POST',
          url: `${BASE}/${row.id}/reconcile`,
          headers: s.headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    for (const payload of [
      { ...body, approvedAmount: '150.00' },
      { ...body, reviewedByRole: 'OWNER' },
      { ...body, reviewToken: PRIVATE_MARKER },
      { ...body, idempotencyKey: PRIVATE_MARKER },
    ]) {
      const result = await inject({
        method: 'POST',
        url: `${BASE}/${row.id}/review`,
        headers: s.headers,
        payload,
      });
      expect(result.statusCode).toBe(400);
      expect(result.body).not.toContain(PRIVATE_MARKER);
    }
    expect((await batchCounts(s)).reviews).toBe(0);
    expect(logs.join('')).not.toContain(PRIVATE_MARKER);
  });
});

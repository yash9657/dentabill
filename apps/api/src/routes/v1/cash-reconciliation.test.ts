import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { prisma, type UserRole } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import {
  CashEvidenceSchema,
  CashInputSchema,
  CashPreviewSchema,
  type CashInput,
} from '../../lib/cash-evidence/contract.js';
import {
  CashMatchListSchema,
  CashMatchReceiptSchema,
  MatchPreviewSchema,
  ReleasePreviewSchema,
  ReleaseReceiptSchema,
  type MatchCandidate,
  type MatchDecision,
  type ReleaseDecision,
} from '../../lib/cash-reconciliation/contract.js';
import {
  BatchEvidenceSchema,
  BatchInputSchema,
  BatchPreviewSchema,
  type BatchInput,
} from '../../lib/remittance-batches/contract.js';
import {
  EvidenceResponseSchema,
  PreviewResponseSchema,
  type RemittanceInput,
} from '../../lib/remittances/contract.js';

function cashInput(overrides: Partial<CashInput> = {}): CashInput {
  const value: unknown = JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed checked-in synthetic fixture.
    readFileSync(
      new URL('../../../test/fixtures/cash-evidence/02-posted-90.json', import.meta.url),
      'utf8',
    ),
  );
  return {
    ...CashInputSchema.parse(value),
    sourceTransactionId: randomUUID(),
    sourceRecordId: randomUUID(),
    sourceSequence: 1,
    amount: '100.00',
    sourceAmount: '100.00',
    sourceSignConvention: 'CREDIT_POSITIVE',
    ...overrides,
  };
}
function batchFixture(
  name: '01-balanced-180-minus-30.json' | '04-negative-net.json' | '06-signed-reversal.json',
): BatchInput {
  // This finite fixture union contains fabricated source records only.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const raw = readFileSync(
    new URL(`../../../test/fixtures/remittance-batches/${name}`, import.meta.url),
    'utf8',
  );
  const value: unknown = JSON.parse(raw);
  return BatchInputSchema.parse(value);
}
function batchInput(net = '100.00', overrides: Partial<BatchInput> = {}): BatchInput {
  const base = batchFixture('01-balanced-180-minus-30.json');
  return {
    ...base,
    sourceBatchId: randomUUID(),
    sourceRecordId: randomUUID(),
    reportedClaimAmount: '0.00',
    reportedAdjustmentAmount: net,
    reportedNetAmount: net,
    claimRemittances: [],
    providerAdjustments: [
      {
        ...base.providerAdjustments[0]!,
        amount: net,
        sourceAmount: net,
        sourceSignConvention: 'NET_EFFECT_POSITIVE',
      },
    ],
    ...overrides,
  };
}
async function seed(role: UserRole = 'BILLING_STAFF', existingOrganizationId?: string) {
  const organizationId =
    existingOrganizationId ??
    (
      await prisma.organization.create({
        data: { name: 'Synthetic reconciliation practice', clerkOrgId: `org_${randomUUID()}` },
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
const BASE = '/v1/cash-reconciliations';
const PRIVATE_MARKER = 'SYNTHETIC-PRIVATE-RECONCILIATION';
const UNVERIFIED = {
  provenance: 'MANUAL_REVIEW',
  bankVerification: 'UNVERIFIED',
  posting: 'UNVERIFIED',
  settlement: 'UNVERIFIED',
  claimCashAllocation: 'UNALLOCATED',
} as const;

describe('cash-to-batch reconciliation API (synthetic, real Postgres)', () => {
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
      throw new Error('Reconciliation tests require an isolated local DentaBill database.');
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
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS reject_reconciliation_test_audit ON "AuditLog"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_reconciliation_test_audit()');
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

  async function cashReview(s: Seed, id: string, decision: 'ACCEPT' | 'REJECT' = 'ACCEPT') {
    const p = await inject({
      method: 'GET',
      url: `/v1/cash-evidence/${id}/preview`,
      headers: s.headers,
    });
    expect(p.statusCode, p.body).toBe(200);
    const result = await inject({
      method: 'POST',
      url: `/v1/cash-evidence/${id}/review`,
      headers: s.headers,
      payload: {
        decision,
        reviewToken: CashPreviewSchema.parse(p.json()).reviewToken,
        idempotencyKey: randomUUID(),
      },
    });
    expect(result.statusCode, result.body).toBe(200);
    return CashEvidenceSchema.parse(result.json());
  }
  async function cash(
    s: Seed,
    payload = cashInput(),
    decision: 'ACCEPT' | 'REJECT' | null = 'ACCEPT',
  ) {
    const result = await inject({
      method: 'POST',
      url: '/v1/cash-evidence',
      headers: s.headers,
      payload,
    });
    expect(result.statusCode, result.body).toBe(201);
    const row = CashEvidenceSchema.parse(result.json());
    return decision ? cashReview(s, row.id, decision) : row;
  }
  function revised(p: CashInput, overrides: Partial<CashInput> = {}): CashInput {
    return {
      ...p,
      sourceSequence: p.sourceSequence + 1,
      sourceRecordId: randomUUID(),
      ...overrides,
    };
  }
  async function batchReview(s: Seed, id: string, decision: 'ACCEPT' | 'REJECT' = 'ACCEPT') {
    const p = await inject({
      method: 'GET',
      url: `/v1/remittance-batches/${id}/preview`,
      headers: s.headers,
    });
    expect(p.statusCode, p.body).toBe(200);
    const result = await inject({
      method: 'POST',
      url: `/v1/remittance-batches/${id}/review`,
      headers: s.headers,
      payload: {
        decision,
        reviewToken: BatchPreviewSchema.parse(p.json()).reviewToken,
        idempotencyKey: randomUUID(),
      },
    });
    expect(result.statusCode, result.body).toBe(200);
    return BatchEvidenceSchema.parse(result.json());
  }
  async function batch(
    s: Seed,
    payload = batchInput(),
    decision: 'ACCEPT' | 'REJECT' | null = 'ACCEPT',
  ) {
    const result = await inject({
      method: 'POST',
      url: '/v1/remittance-batches',
      headers: s.headers,
      payload,
    });
    expect(result.statusCode, result.body).toBe(201);
    const row = BatchEvidenceSchema.parse(result.json());
    return decision ? batchReview(s, row.id, decision) : row;
  }
  async function member(
    s: Seed,
    sourceRecordId: string,
    reportedAmount: string,
    options: { claimId?: string; reversesSourceRecordId?: string } = {},
  ) {
    const claimId =
      options.claimId ??
      (
        await prisma.claim.create({
          data: {
            organizationId: s.organizationId,
            claimNumber: `SYNTHETIC-${randomUUID()}`,
            patientDOBHash: 'synthetic-only',
            claimAmount: '200.00',
            payerCode: 'CIGNA_DENTAL',
            serviceDate: new Date('2026-10-01'),
            status: 'COMPLETED',
          },
        })
      ).id;
    const payload: RemittanceInput = {
      schemaVersion: 1,
      sourceNamespace: 'synthetic-remittance',
      sourceRecordId,
      sourceDocumentId: 'synthetic-remittance-document',
      sourceVersion: '1',
      kind: options.reversesSourceRecordId ? 'REVERSAL' : 'PAYMENT',
      reversesSourceRecordId: options.reversesSourceRecordId ?? null,
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
      sourceStatus: null,
      lineDetailCompleteness: 'ABSENT',
      allocations: [],
      adjustments: [],
    };
    const base = `/v1/claims/${claimId}/remittances`;
    const result = await inject({ method: 'POST', url: base, headers: s.headers, payload });
    expect(result.statusCode, result.body).toBe(201);
    const row = EvidenceResponseSchema.parse(result.json());
    const p = await inject({ method: 'GET', url: `${base}/${row.id}/preview`, headers: s.headers });
    expect(p.statusCode, p.body).toBe(200);
    const accepted = await inject({
      method: 'POST',
      url: `${base}/${row.id}/review`,
      headers: s.headers,
      payload: {
        decision: 'ACCEPT',
        reviewToken: PreviewResponseSchema.parse(p.json()).reviewToken,
        idempotencyKey: randomUUID(),
      },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    return EvidenceResponseSchema.parse(accepted.json());
  }
  function candidate(c: { id: string }, b: { id: string }, amount = '100.00'): MatchCandidate {
    return { cashEvidenceId: c.id, batchEvidenceId: b.id, amount };
  }
  async function preview(s: Seed, payload: MatchCandidate) {
    const result = await inject({
      method: 'POST',
      url: `${BASE}/preview`,
      headers: s.headers,
      payload,
    });
    expect(result.statusCode, result.body).toBe(200);
    return MatchPreviewSchema.parse(result.json());
  }
  async function matchBody(s: Seed, payload: MatchCandidate): Promise<MatchDecision> {
    return {
      ...payload,
      reviewToken: (await preview(s, payload)).reviewToken,
      idempotencyKey: randomUUID(),
    };
  }
  function submit(s: Seed, payload: MatchDecision) {
    return inject({ method: 'POST', url: BASE, headers: s.headers, payload });
  }
  async function match(s: Seed, payload: MatchCandidate) {
    const result = await submit(s, await matchBody(s, payload));
    expect(result.statusCode, result.body).toBe(201);
    return CashMatchReceiptSchema.parse(result.json());
  }
  async function releasePreview(
    s: Seed,
    id: string,
    reason: ReleaseDecision['reason'] = 'SOURCE_CHANGED',
  ) {
    const result = await inject({
      method: 'POST',
      url: `${BASE}/${id}/release/preview`,
      headers: s.headers,
      payload: { reason },
    });
    expect(result.statusCode, result.body).toBe(200);
    return ReleasePreviewSchema.parse(result.json());
  }
  async function releaseBody(
    s: Seed,
    id: string,
    reason: ReleaseDecision['reason'] = 'SOURCE_CHANGED',
  ): Promise<ReleaseDecision> {
    return {
      reason,
      reviewToken: (await releasePreview(s, id, reason)).reviewToken,
      idempotencyKey: randomUUID(),
    };
  }
  function submitRelease(s: Seed, id: string, payload: ReleaseDecision) {
    return inject({ method: 'POST', url: `${BASE}/${id}/release`, headers: s.headers, payload });
  }
  async function release(
    s: Seed,
    id: string,
    reason: ReleaseDecision['reason'] = 'SOURCE_CHANGED',
  ) {
    const result = await submitRelease(s, id, await releaseBody(s, id, reason));
    expect(result.statusCode, result.body).toBe(201);
    return ReleaseReceiptSchema.parse(result.json());
  }
  async function list(s: Seed, suffix = '') {
    const result = await inject({ method: 'GET', url: `${BASE}${suffix}`, headers: s.headers });
    expect(result.statusCode, result.body).toBe(200);
    expect(Buffer.byteLength(result.body)).toBeLessThanOrEqual(2 * 1024 * 1024);
    return CashMatchListSchema.parse(result.json());
  }
  async function counts(s: Seed) {
    const where = { organizationId: s.organizationId };
    return {
      matches: await prisma.cashBatchMatch.count({ where }),
      releases: await prisma.cashBatchRelease.count({ where }),
    };
  }
  async function sourceSnapshot(s: Seed) {
    const where = { organizationId: s.organizationId };
    const orderBy = { id: 'asc' as const };
    return {
      claims: await prisma.claim.findMany({ where, orderBy }),
      remittances: await prisma.claimRemittanceEvidence.findMany({ where, orderBy }),
      remittanceReviews: await prisma.claimRemittanceReview.findMany({ where, orderBy }),
      batches: await prisma.remittanceBatchEvidence.findMany({ where, orderBy }),
      batchReviews: await prisma.remittanceBatchReview.findMany({ where, orderBy }),
      batchMembers: await prisma.remittanceBatchClaim.findMany({ where, orderBy }),
      batchAdjustments: await prisma.remittanceBatchAdjustment.findMany({ where, orderBy }),
      cashTransactions: await prisma.cashSourceTransaction.findMany({ where, orderBy }),
      cashEvidence: await prisma.cashSourceEvidence.findMany({ where, orderBy }),
      cashReviews: await prisma.cashSourceReview.findMany({ where, orderBy }),
      claimAllocations: await prisma.claimRemittanceAllocation.count({ where }),
      usage: await prisma.billingUsageRecord.count({ where }),
    };
  }
  async function failAudit(
    action: 'reconciliation.match' | 'reconciliation.release' | 'reconciliation.read',
  ): Promise<void> {
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_reconciliation_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION '${PRIVATE_MARKER}'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_reconciliation_test_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_test_audit()',
    );
  }

  it('requires authentication on every match and release endpoint', async () => {
    const s = await seed();
    const c = await cash(s);
    const b = await batch(s);
    const body = await matchBody(s, candidate(c, b));
    const saved = await match(s, candidate(c, b));
    const releaseCommand = await releaseBody(s, saved.id);
    const results = await Promise.all([
      inject({ method: 'GET', url: BASE }),
      inject({ method: 'POST', url: `${BASE}/preview`, payload: candidate(c, b) }),
      inject({ method: 'POST', url: BASE, payload: body }),
      inject({
        method: 'POST',
        url: `${BASE}/${saved.id}/release/preview`,
        payload: { reason: 'SOURCE_CHANGED' },
      }),
      inject({ method: 'POST', url: `${BASE}/${saved.id}/release`, payload: releaseCommand }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([401, 401, 401, 401, 401]);
    expect(await counts(s)).toEqual({ matches: 1, releases: 0 });
  });

  it.each(['OWNER', 'ADMIN', 'BILLING_STAFF'] as const)(
    'attributes manual match and release to the stored %s role',
    async (role) => {
      const s = await seed(role);
      const c = await cash(s);
      const b = await batch(s);
      const saved = await match(s, candidate(c, b));
      expect(saved).toMatchObject({
        reviewedByUserId: s.user.id,
        reviewedByRole: role,
        ...UNVERIFIED,
      });
      expect(await release(s, saved.id, 'WRONG_MATCH')).toMatchObject({
        matchId: saved.id,
        reviewedByUserId: s.user.id,
        reviewedByRole: role,
        reason: 'WRONG_MATCH',
      });
    },
  );

  it('does not trust caller organization/role headers for an unregistered actor', async () => {
    const s = await seed();
    const c = await cash(s);
    const b = await batch(s);
    const result = await inject({
      method: 'POST',
      url: `${BASE}/preview`,
      payload: candidate(c, b),
      headers: {
        'x-test-user-id': 'unknown-actor',
        'x-role': 'OWNER',
        'x-organization-id': s.organizationId,
      },
    });
    expect(result.statusCode).toBe(403);
    expect(await counts(s)).toEqual({ matches: 0, releases: 0 });
  });

  it('reconciles only net150 from gross100+80 and provider reduction30 without changing source facts or claim allocations', async () => {
    const s = await seed();
    await member(s, 'synthetic-claim-report-100', '100.00');
    await member(s, 'synthetic-claim-report-80', '80.00');
    const b = await batch(s, batchFixture('01-balanced-180-minus-30.json'));
    const c = await cash(s, cashInput({ amount: '150.00', sourceAmount: '150.00' }));
    const before = await sourceSnapshot(s);
    const p = await preview(s, candidate(c, b, '150.00'));
    expect(p).toMatchObject({
      ...UNVERIFIED,
      blockers: [],
      batch: {
        claimReportedAmount: '180.00',
        providerAdjustmentAmount: '-30.00',
        netAmount: '150.00',
      },
      capacity: {
        cashReservedMagnitude: '0.00',
        cashAvailableMagnitude: '150.00',
        batchReservedMagnitude: '0.00',
        batchAvailableMagnitude: '150.00',
      },
    });
    const saved = await match(s, p.candidate);
    expect(saved).toMatchObject({
      ...UNVERIFIED,
      amount: '150.00',
      cashTransactionId: c.transactionId,
      cashEvidenceId: c.id,
      cashReviewId: c.review?.id,
      batchEvidenceId: b.id,
      batchReviewId: b.review?.id,
    });
    const current = (await list(s)).items[0]!;
    expect(current).toMatchObject({
      id: saved.id,
      status: 'CURRENT',
      blockers: [],
      release: null,
      ...UNVERIFIED,
    });
    expect((await preview(s, candidate(c, b, '0.01'))).capacity).toEqual({
      cashReservedMagnitude: '150.00',
      cashAvailableMagnitude: '0.00',
      batchReservedMagnitude: '150.00',
      batchAvailableMagnitude: '0.00',
    });
    expect(await sourceSnapshot(s)).toEqual(before);
  });

  it('supports partial many-to-many matches while keeping account and batch capacity independent', async () => {
    const s = await seed();
    const a = await cash(
      s,
      cashInput({ sourceAccountId: 'account-a', amount: '150.00', sourceAmount: '150.00' }),
    );
    const b = await cash(
      s,
      cashInput({ sourceAccountId: 'account-b', amount: '50.00', sourceAmount: '50.00' }),
    );
    const x = await batch(s, batchInput('100.00'));
    const y = await batch(s, batchInput('100.00'));
    await match(s, candidate(a, x, '60.00'));
    await match(s, candidate(a, y, '90.00'));
    await match(s, candidate(b, x, '40.00'));
    await match(s, candidate(b, y, '10.00'));
    expect((await list(s)).items).toHaveLength(4);
    expect((await list(s)).items.every((row) => row.status === 'CURRENT')).toBe(true);
    expect((await preview(s, candidate(a, x, '0.01'))).capacity).toEqual({
      cashReservedMagnitude: '150.00',
      cashAvailableMagnitude: '0.00',
      batchReservedMagnitude: '100.00',
      batchAvailableMagnitude: '0.00',
    });
    expect((await preview(s, candidate(b, y, '0.01'))).capacity).toEqual({
      cashReservedMagnitude: '50.00',
      cashAvailableMagnitude: '0.00',
      batchReservedMagnitude: '100.00',
      batchAvailableMagnitude: '0.00',
    });
  });

  it('matches a negative net after provider deductions using positive capacity magnitudes and preserved source debit signs', async () => {
    const s = await seed();
    await member(s, 'synthetic-claim-report-100', '100.00');
    const b = await batch(s, batchFixture('04-negative-net.json'));
    const c = await cash(
      s,
      cashInput({
        amount: '-25.00',
        sourceAmount: '25.00',
        sourceSignConvention: 'DEBIT_POSITIVE',
      }),
    );
    const p = await preview(s, candidate(c, b, '-10.00'));
    expect(p.blockers).toEqual([]);
    expect(p.capacity).toMatchObject({
      cashAvailableMagnitude: '25.00',
      batchAvailableMagnitude: '25.00',
    });
    await match(s, p.candidate);
    expect((await preview(s, candidate(c, b, '-15.00'))).capacity).toMatchObject({
      cashReservedMagnitude: '10.00',
      cashAvailableMagnitude: '15.00',
      batchReservedMagnitude: '10.00',
      batchAvailableMagnitude: '15.00',
    });
    await match(s, candidate(c, b, '-15.00'));
    expect((await list(s)).items.map((row) => row.amount).sort()).toEqual(['-10.00', '-15.00']);
    expect((await preview(s, candidate(c, b, '-0.01'))).blockers).toEqual(
      expect.arrayContaining(['CASH_CAPACITY_EXCEEDED', 'BATCH_CAPACITY_EXCEEDED']),
    );
  });

  it('uses the fixed reviewed batch net when signed reversal members are present or later reversed further', async () => {
    const s = await seed();
    const original = await member(s, 'synthetic-claim-report-100', '100.00');
    await member(s, 'synthetic-claim-reversal-35', '-35.00', {
      claimId: original.claimId,
      reversesSourceRecordId: original.payload.sourceRecordId,
    });
    const b = await batch(s, batchFixture('06-signed-reversal.json'));
    const c = await cash(s, cashInput({ amount: '60.00', sourceAmount: '60.00' }));
    const saved = await match(s, candidate(c, b, '60.00'));
    await member(s, 'later-independent-reversal-10', '-10.00', {
      claimId: original.claimId,
      reversesSourceRecordId: original.payload.sourceRecordId,
    });
    const current = (await list(s)).items[0]!;
    expect(current).toMatchObject({
      id: saved.id,
      status: 'CURRENT',
      amount: '60.00',
      batch: {
        claimReportedAmount: '65.00',
        providerAdjustmentAmount: '-5.00',
        netAmount: '60.00',
      },
    });
    expect((await preview(s, candidate(c, b, '0.01'))).capacity.batchReservedMagnitude).toBe(
      '60.00',
    );
  });

  it('permits a provider-only batch without inventing claim cash allocation', async () => {
    const s = await seed();
    const c = await cash(s);
    const b = await batch(s);
    const saved = await match(s, candidate(c, b));
    expect(saved).toMatchObject(UNVERIFIED);
    expect(await prisma.claim.count({ where: { organizationId: s.organizationId } })).toBe(0);
    expect(
      await prisma.remittanceBatchClaim.count({ where: { organizationId: s.organizationId } }),
    ).toBe(0);
  });

  it.each([
    ['cash', '100.00', '200.00', '101.00', 'CASH_CAPACITY_EXCEEDED'],
    ['batch', '200.00', '100.00', '101.00', 'BATCH_CAPACITY_EXCEEDED'],
  ] as const)('rejects %s capacity overflow', async (_name, cashAmount, net, amount, blocker) => {
    const s = await seed();
    const c = await cash(s, cashInput({ amount: cashAmount, sourceAmount: cashAmount }));
    const b = await batch(s, batchInput(net));
    const p = await preview(s, candidate(c, b, amount));
    expect(p.blockers).toContain(blocker);
    expect((await submit(s, await matchBody(s, p.candidate))).statusCode).toBe(409);
    expect(await counts(s)).toEqual({ matches: 0, releases: 0 });
  });

  it.each([
    ['100.00', '100.00', '-1.00'],
    ['-100.00', '-100.00', '1.00'],
    ['100.00', '-100.00', '1.00'],
  ])(
    'never nets opposite directions for cash%s batch%s match%s',
    async (cashAmount, net, amount) => {
      const s = await seed();
      const c = await cash(s, cashInput({ amount: cashAmount, sourceAmount: cashAmount }));
      const b = await batch(s, batchInput(net));
      const p = await preview(s, candidate(c, b, amount));
      expect(p.blockers).toContain('DIRECTION_MISMATCH');
      expect((await submit(s, await matchBody(s, p.candidate))).statusCode).toBe(409);
    },
  );

  it.each(['cash-unreviewed', 'cash-rejected', 'batch-unreviewed', 'batch-rejected'] as const)(
    'requires exact accepted source reviews for %s',
    async (state) => {
      const s = await seed();
      const c = await cash(
        s,
        cashInput(),
        state === 'cash-unreviewed' ? null : state === 'cash-rejected' ? 'REJECT' : 'ACCEPT',
      );
      const b = await batch(
        s,
        batchInput(),
        state === 'batch-unreviewed' ? null : state === 'batch-rejected' ? 'REJECT' : 'ACCEPT',
      );
      const p = await preview(s, candidate(c, b));
      expect(p.blockers).toContain(
        state.startsWith('cash') ? 'CASH_NOT_ACCEPTED' : 'BATCH_NOT_ACCEPTED',
      );
      expect((await submit(s, await matchBody(s, p.candidate))).statusCode).toBe(409);
    },
  );

  it.each(['PENDING', 'REMOVED', 'UNKNOWN'] as const)(
    'does not match accepted%s cash with unknown amounts',
    async (status) => {
      const s = await seed();
      const c = await cash(s, cashInput({ status, amount: null, sourceAmount: null }));
      const b = await batch(s);
      const p = await preview(s, candidate(c, b));
      expect(p.blockers).toContain('CASH_NOT_POSTED');
      expect((await submit(s, await matchBody(s, p.candidate))).statusCode).toBe(409);
    },
  );

  it.each(['cash', 'batch'] as const)(
    'does not manufacture a match for zero %s capacity',
    async (source) => {
      const s = await seed();
      const amount = source === 'cash' ? '0.00' : '100.00';
      const c = await cash(s, cashInput({ amount, sourceAmount: amount }));
      const b = await batch(s, batchInput(source === 'batch' ? '0.00' : '100.00'));
      const p = await preview(s, candidate(c, b, '0.01'));
      expect(p.blockers).toContain(source === 'cash' ? 'CASH_ZERO_AMOUNT' : 'BATCH_ZERO_NET');
      expect((await submit(s, await matchBody(s, p.candidate))).statusCode).toBe(409);
    },
  );

  it('keeps a reservation stale after a newer cash observation is rejected and releases only by explicit command', async () => {
    const s = await seed();
    const c = await cash(s);
    const b = await batch(s);
    const saved = await match(s, candidate(c, b, '60.00'));
    const newer = await cash(
      s,
      revised(c.payload, { amount: '80.00', sourceAmount: '80.00' }),
      null,
    );
    expect((await list(s)).items[0]?.status).toBe('STALE');
    await cashReview(s, newer.id, 'REJECT');
    expect((await list(s)).items[0]).toMatchObject({
      id: saved.id,
      status: 'STALE',
      release: null,
    });
    const freshCash = await cash(s);
    const p = await preview(s, candidate(freshCash, b, '50.00'));
    expect(p.capacity).toMatchObject({
      batchReservedMagnitude: '60.00',
      batchAvailableMagnitude: '40.00',
    });
    expect(p.blockers).toContain('BATCH_CAPACITY_EXCEEDED');
    expect((await preview(s, candidate(c, b, '10.00'))).blockers).toContain('CASH_NOT_CURRENT');
    expect((await releasePreview(s, saved.id)).canRelease).toBe(true);
    await release(s, saved.id);
    expect((await list(s)).items[0]?.status).toBe('RELEASED');
    await match(s, candidate(freshCash, b));
  });

  it.each(['50.00', '-50.00'])(
    'does not reuse old revision reservations when the current cash amount changes to%s',
    async (amount) => {
      const s = await seed();
      const oldCash = await cash(s);
      const oldBatch = await batch(s);
      const saved = await match(s, candidate(oldCash, oldBatch, '80.00'));
      const current = await cash(s, revised(oldCash.payload, { amount, sourceAmount: amount }));
      const nextBatch = await batch(s, batchInput(amount));
      const p = await preview(s, candidate(current, nextBatch, amount));
      expect(p.capacity.cashReservedMagnitude).toBe('80.00');
      expect(p.capacity.cashAvailableMagnitude?.startsWith('-')).not.toBe(true);
      expect(p.blockers).toContain('STALE_CASH_RESERVATION');
      expect((await submit(s, await matchBody(s, p.candidate))).statusCode).toBe(409);
      await release(s, saved.id);
      expect((await preview(s, p.candidate)).capacity.cashReservedMagnitude).toBe('0.00');
      await match(s, p.candidate);
    },
  );

  it('retains removal history without a refund and requires release before moving capacity to a replacement transaction', async () => {
    const s = await seed();
    const p = await cash(s, cashInput({ sourceTransactionId: 'pending-parent' }));
    const b = await batch(s);
    const saved = await match(s, candidate(p, b, '50.00'));
    await cash(s, revised(p.payload, { status: 'REMOVED', amount: null, sourceAmount: null }));
    const qPending = await cash(
      s,
      cashInput({
        sourceTransactionId: 'replacement-child',
        pendingSourceTransactionId: 'pending-parent',
        status: 'PENDING',
        amount: null,
        sourceAmount: null,
      }),
    );
    const q = await cash(
      s,
      revised(qPending.payload, {
        status: 'POSTED',
        amount: '100.00',
        sourceAmount: '100.00',
        pendingSourceTransactionId: null,
      }),
    );
    const otherBatch = await batch(s);
    const blocked = await preview(s, candidate(q, otherBatch, '25.00'));
    expect(blocked.blockers).toContain('CASH_IDENTITY_CONFLICT');
    expect((await submit(s, await matchBody(s, blocked.candidate))).statusCode).toBe(409);
    expect((await list(s)).items[0]).toMatchObject({
      id: saved.id,
      amount: '50.00',
      status: 'STALE',
      release: null,
    });
    await release(s, saved.id);
    await match(s, candidate(q, otherBatch, '100.00'));
    expect((await preview(s, candidate(q, b, '0.01'))).capacity.batchReservedMagnitude).toBe(
      '0.00',
    );
  });

  it('marks both bindings stale when a later accepted graph bridge joins their cash identities', async () => {
    const s = await seed();
    const a = await cash(s, cashInput({ sourceTransactionId: 'graph-a' }));
    const b = await cash(s, cashInput({ sourceTransactionId: 'graph-b' }));
    const aBatch = await batch(s);
    const bBatch = await batch(s);
    const spareBatch = await batch(s);
    const aMatch = await match(s, candidate(a, aBatch, '50.00'));
    const bMatch = await match(s, candidate(b, bBatch, '50.00'));
    const removed = await cash(
      s,
      revised(a.payload, { status: 'REMOVED', amount: null, sourceAmount: null }),
    );
    await cash(
      s,
      revised(removed.payload, { status: 'PENDING', pendingSourceTransactionId: 'graph-b' }),
    );
    const merged = await list(s);
    expect(merged.items.map((row) => row.status)).toEqual(['STALE', 'STALE']);
    const p = await preview(s, candidate(b, spareBatch, '25.00'));
    expect(p.blockers).toContain('CASH_IDENTITY_CONFLICT');
    expect((await submit(s, await matchBody(s, p.candidate))).statusCode).toBe(409);
    await release(s, aMatch.id);
    expect((await list(s)).items.find((row) => row.id === bMatch.id)?.status).toBe('CURRENT');
    await match(s, p.candidate);
  });

  it('never joins same-named pending graph nodes across accounts or namespaces', async () => {
    const s = await seed();
    const a = await cash(
      s,
      cashInput({
        sourceAccountId: 'account-a',
        sourceTransactionId: 'same-source',
        pendingSourceTransactionId: 'same-missing-parent',
      }),
    );
    const b = await cash(
      s,
      cashInput({
        sourceAccountId: 'account-b',
        sourceTransactionId: 'same-source',
        pendingSourceTransactionId: 'same-missing-parent',
      }),
    );
    const c = await cash(
      s,
      cashInput({
        sourceNamespace: 'other-bank',
        sourceAccountId: 'account-a',
        sourceTransactionId: 'same-source',
        pendingSourceTransactionId: 'same-missing-parent',
      }),
    );
    const x = await batch(s, batchInput('300.00'));
    await match(s, candidate(a, x));
    await match(s, candidate(b, x));
    await match(s, candidate(c, x));
    expect((await list(s)).items.map((row) => row.status)).toEqual([
      'CURRENT',
      'CURRENT',
      'CURRENT',
    ]);
  });

  it('binds the proposed signed amount and both exact sources into the preview token', async () => {
    const s = await seed();
    const a = await cash(s);
    const b = await cash(s);
    const x = await batch(s);
    const y = await batch(s);
    const body = await matchBody(s, candidate(a, x, '50.00'));
    expect((await submit(s, { ...body, amount: '60.00' })).statusCode).toBe(409);
    expect((await submit(s, { ...body, cashEvidenceId: b.id })).statusCode).toBe(409);
    expect((await submit(s, { ...body, batchEvidenceId: y.id })).statusCode).toBe(409);
    expect((await submit(s, body)).statusCode).toBe(201);
  });

  it.each([
    'cash-evidence',
    'cash-review',
    'batch-evidence',
    'batch-review',
    'match',
    'release',
  ] as const)('invalidates a preview after the organization %s ledger changes', async (change) => {
    const s = await seed();
    const primaryCash = await cash(s);
    const primaryBatch = await batch(s);
    const sideCash = await cash(s);
    const sideBatch = await batch(s);
    const sideMatch = await match(s, candidate(sideCash, sideBatch, '5.00'));
    const unreviewedCash = await cash(s, cashInput(), null);
    const unreviewedBatch = await batch(s, batchInput(), null);
    const p = await preview(s, candidate(primaryCash, primaryBatch, '10.00'));
    expect(p.ledgerVersion.split(':')).toHaveLength(6);
    expect(p.ledgerVersion.split(':').every((value) => /^\d+$/.test(value))).toBe(true);
    if (change === 'cash-evidence') await cash(s, cashInput(), null);
    else if (change === 'cash-review') await cashReview(s, unreviewedCash.id);
    else if (change === 'batch-evidence') await batch(s, batchInput(), null);
    else if (change === 'batch-review') await batchReview(s, unreviewedBatch.id);
    else if (change === 'match') await match(s, candidate(sideCash, sideBatch, '5.00'));
    else await release(s, sideMatch.id);
    expect(
      (
        await submit(s, {
          ...p.candidate,
          reviewToken: p.reviewToken,
          idempotencyKey: randomUUID(),
        })
      ).statusCode,
    ).toBe(409);
    await match(s, p.candidate);
  });

  it('returns identical immutable match and release receipts after source changes, releases and rematches', async () => {
    const s = await seed();
    const c = await cash(s);
    const b = await batch(s);
    const matchCommand = await matchBody(s, candidate(c, b, '60.00'));
    const saved = await submit(s, matchCommand);
    expect(saved.statusCode).toBe(201);
    const original = CashMatchReceiptSchema.parse(saved.json());
    const releaseCommand = await releaseBody(s, original.id);
    const released = await submitRelease(s, original.id, releaseCommand);
    expect(released.statusCode).toBe(201);
    const originalRelease = ReleaseReceiptSchema.parse(released.json());
    const newer = await cash(s, revised(c.payload, { amount: '80.00', sourceAmount: '80.00' }));
    const next = await match(s, candidate(newer, b, '80.00'));
    const matchReplay = await submit(s, matchCommand);
    expect(matchReplay.statusCode, matchReplay.body).toBe(200);
    expect(CashMatchReceiptSchema.parse(matchReplay.json())).toEqual(original);
    const releaseReplay = await submitRelease(s, original.id, releaseCommand);
    expect(releaseReplay.statusCode, releaseReplay.body).toBe(200);
    expect(ReleaseReceiptSchema.parse(releaseReplay.json())).toEqual(originalRelease);
    expect((await list(s)).items.map((row) => [row.id, row.status])).toEqual([
      [next.id, 'CURRENT'],
      [original.id, 'RELEASED'],
    ]);
    expect((await preview(s, candidate(newer, b, '0.01'))).capacity).toMatchObject({
      cashReservedMagnitude: '80.00',
      batchReservedMagnitude: '80.00',
    });
    expect(await counts(s)).toEqual({ matches: 2, releases: 1 });
  });

  it('binds retry keys to actor, amount and exact match or release command', async () => {
    const s = await seed();
    const other = await seed('ADMIN', s.organizationId);
    const c = await cash(s);
    const b = await batch(s);
    const body = await matchBody(s, candidate(c, b, '20.00'));
    const result = await submit(s, body);
    expect(result.statusCode).toBe(201);
    const saved = CashMatchReceiptSchema.parse(result.json());
    expect((await submit(other, body)).statusCode).toBe(409);
    expect((await submit(s, { ...body, amount: '21.00' })).statusCode).toBe(409);
    expect((await submit(s, { ...body, reviewToken: '0'.repeat(64) })).statusCode).toBe(409);
    const releaseCommand = await releaseBody(s, saved.id, 'WRONG_MATCH');
    expect(
      (await submitRelease(s, saved.id, { ...releaseCommand, reason: 'SOURCE_CHANGED' }))
        .statusCode,
    ).toBe(409);
    expect((await submitRelease(s, saved.id, releaseCommand)).statusCode).toBe(201);
    expect((await submitRelease(other, saved.id, releaseCommand)).statusCode).toBe(409);
    expect(
      (await submitRelease(s, saved.id, { ...releaseCommand, reason: 'OTHER_REVIEWED_ERROR' }))
        .statusCode,
    ).toBe(409);
    expect(
      (await submitRelease(s, saved.id, { ...releaseCommand, idempotencyKey: randomUUID() }))
        .statusCode,
    ).toBe(409);
    expect((await releasePreview(s, saved.id)).canRelease).toBe(false);
  });

  it.each(['cash', 'batch'] as const)(
    'serializes competing partial matches against shared %s capacity',
    async (shared) => {
      const s = await seed();
      const a = await cash(s);
      const b = await cash(s);
      const x = await batch(s);
      const y = await batch(s);
      const first = candidate(a, x, '80.00');
      const second = shared === 'cash' ? candidate(a, y, '80.00') : candidate(b, x, '80.00');
      const commands = [await matchBody(s, first), await matchBody(s, second)];
      const results = await Promise.all(commands.map((command) => submit(s, command)));
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      const loser = results[0]!.statusCode === 409 ? first : second;
      expect((await preview(s, loser)).blockers).toContain(
        shared === 'cash' ? 'CASH_CAPACITY_EXCEEDED' : 'BATCH_CAPACITY_EXCEEDED',
      );
      expect(await counts(s)).toEqual({ matches: 1, releases: 0 });
    },
  );

  it('deduplicates simultaneous exact match and release retries', async () => {
    const s = await seed();
    const c = await cash(s);
    const b = await batch(s);
    const body = await matchBody(s, candidate(c, b));
    const matched = await Promise.all([submit(s, body), submit(s, body)]);
    expect(matched.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    const saved = CashMatchReceiptSchema.parse(matched[0].json());
    expect(CashMatchReceiptSchema.parse(matched[1].json())).toEqual(saved);
    const command = await releaseBody(s, saved.id);
    const released = await Promise.all([
      submitRelease(s, saved.id, command),
      submitRelease(s, saved.id, command),
    ]);
    expect(released.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(ReleaseReceiptSchema.parse(released[0].json())).toEqual(
      ReleaseReceiptSchema.parse(released[1].json()),
    );
    expect(await counts(s)).toEqual({ matches: 1, releases: 1 });
  });

  it('does not turn a previously blocked match preview into approval while a concurrent release frees capacity', async () => {
    const s = await seed();
    const c = await cash(s);
    const b = await batch(s);
    const saved = await match(s, candidate(c, b, '80.00'));
    const blockedCommand = await matchBody(s, candidate(c, b, '50.00'));
    const releasing = await releaseBody(s, saved.id);
    const results = await Promise.all([
      submit(s, blockedCommand),
      submitRelease(s, saved.id, releasing),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([409, 201]);
    await match(s, candidate(c, b, '50.00'));
  });

  it('isolates source pairs, matches, releases and identical opaque identities across tenants', async () => {
    const a = await seed();
    const b = await seed();
    const p = cashInput();
    const q = batchInput();
    const ac = await cash(a, p);
    const ab = await batch(a, q);
    const bc = await cash(b, p);
    const bb = await batch(b, q);
    const first = await match(a, candidate(ac, ab));
    const second = await match(b, candidate(bc, bb));
    expect((await list(a)).items.map((row) => row.id)).toEqual([first.id]);
    expect((await list(b)).items.map((row) => row.id)).toEqual([second.id]);
    for (const payload of [candidate(ac, bb), candidate(bc, ab), candidate(ac, ab)])
      expect(
        (await inject({ method: 'POST', url: `${BASE}/preview`, headers: b.headers, payload }))
          .statusCode,
      ).toBe(404);
    expect(
      (
        await inject({
          method: 'POST',
          url: `${BASE}/${first.id}/release/preview`,
          headers: b.headers,
          payload: { reason: 'WRONG_MATCH' },
        })
      ).statusCode,
    ).toBe(404);
    expect((await submitRelease(b, first.id, await releaseBody(a, first.id))).statusCode).toBe(404);
    expect(await counts(a)).toEqual({ matches: 1, releases: 0 });
    expect(await counts(b)).toEqual({ matches: 1, releases: 0 });
  });

  it.each(['reconciliation.match', 'reconciliation.release'] as const)(
    'rolls back mutation and reservations if %s audit fails',
    async (action) => {
      const s = await seed();
      const c = await cash(s);
      const b = await batch(s);
      const saved = action === 'reconciliation.release' ? await match(s, candidate(c, b)) : null;
      const body = await matchBody(s, candidate(c, b));
      const releaseCommand = saved ? await releaseBody(s, saved.id) : null;
      const before = await sourceSnapshot(s);
      const beforeCounts = await counts(s);
      await failAudit(action);
      const result =
        saved && releaseCommand
          ? await submitRelease(s, saved.id, releaseCommand)
          : await submit(s, body);
      expect(result.statusCode, result.body).toBe(500);
      expect(result.body).not.toContain(PRIVATE_MARKER);
      expect(logs.join('')).not.toContain(PRIVATE_MARKER);
      expect(await sourceSnapshot(s)).toEqual(before);
      expect(await counts(s)).toEqual(beforeCounts);
      await removeAuditFailure();
      expect((await preview(s, candidate(c, b))).capacity.cashReservedMagnitude).toBe(
        saved ? '100.00' : '0.00',
      );
    },
  );

  it('withholds source views and exact mutation replay if read audit fails', async () => {
    const s = await seed();
    const c = await cash(s);
    const b = await batch(s);
    const body = await matchBody(s, candidate(c, b));
    const first = await submit(s, body);
    expect(first.statusCode).toBe(201);
    const saved = CashMatchReceiptSchema.parse(first.json());
    const releaseCommand = await releaseBody(s, saved.id);
    expect((await submitRelease(s, saved.id, releaseCommand)).statusCode).toBe(201);
    const before = await counts(s);
    await failAudit('reconciliation.read');
    const results = await Promise.all([
      inject({ method: 'GET', url: BASE, headers: s.headers }),
      inject({
        method: 'POST',
        url: `${BASE}/preview`,
        headers: s.headers,
        payload: candidate(c, b),
      }),
      inject({
        method: 'POST',
        url: `${BASE}/${saved.id}/release/preview`,
        headers: s.headers,
        payload: { reason: 'SOURCE_CHANGED' },
      }),
      submit(s, body),
      submitRelease(s, saved.id, releaseCommand),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([500, 500, 500, 500, 500]);
    for (const result of results) {
      expect(result.body).not.toContain(PRIVATE_MARKER);
      expect(result.body).not.toContain(c.payload.sourceAccountId);
    }
    expect(logs.join('')).not.toContain(PRIVATE_MARKER);
    expect(await counts(s)).toEqual(before);
  });

  it('paginates bounded dynamic history including released matches without duplicate entries or foreign cursors', async () => {
    const s = await seed();
    const other = await seed();
    const c = await cash(s);
    const b = await batch(s);
    const ids: string[] = [];
    for (let index = 0; index < 12; index += 1)
      ids.push((await match(s, candidate(c, b, '1.00'))).id);
    await release(s, ids[0]!);
    const first = await list(s);
    expect(first.items).toHaveLength(10);
    expect(first.hasMore).toBe(true);
    const second = await list(s, `?cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.items).toHaveLength(2);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((row) => row.id)).toEqual([...ids].reverse());
    expect(second.items.find((row) => row.id === ids[0])?.status).toBe('RELEASED');
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
    'rejects invalid list bounds%s',
    async (suffix) => {
      const s = await seed();
      expect(
        (await inject({ method: 'GET', url: `${BASE}${suffix}`, headers: s.headers })).statusCode,
      ).toBe(400);
    },
  );

  it('rejects zero/malformed amounts, caller authority fields and oversized bodies with closed errors', async () => {
    const s = await seed();
    const c = await cash(s);
    const b = await batch(s);
    const valid = candidate(c, b);
    const invalid: unknown[] = [
      { ...valid, amount: '0.00' },
      { ...valid, amount: '-0.00' },
      { ...valid, amount: '1.001' },
      { ...valid, amount: '100000000.00' },
      { ...valid, amount: 10 },
      { ...valid, amount: PRIVATE_MARKER },
      { ...valid, cashEvidenceId: PRIVATE_MARKER },
      { ...valid, cashEvidenceId: null },
      { ...valid, currency: 'EUR' },
      { ...valid, bankVerification: 'VERIFIED' },
      { ...valid, organizationId: s.organizationId },
      { ...valid, reviewedByUserId: s.user.id },
    ];
    for (const payload of invalid) {
      const result = await inject({
        method: 'POST',
        url: `${BASE}/preview`,
        payload: JSON.stringify(payload),
        headers: { ...s.headers, 'content-type': 'application/json' },
      });
      expect(result.statusCode, result.body).toBe(400);
      expect(result.body).not.toContain(PRIVATE_MARKER);
    }
    const malformed = await inject({
      method: 'POST',
      url: `${BASE}/preview`,
      headers: { ...s.headers, 'content-type': 'application/json' },
      payload: `{"amount":"${PRIVATE_MARKER}",`,
    });
    expect(malformed.statusCode).toBe(400);
    const oversized = await inject({
      method: 'POST',
      url: BASE,
      headers: { ...s.headers, 'content-type': 'application/json' },
      payload: `${JSON.stringify(await matchBody(s, valid))}${' '.repeat(1024 * 1024 + 1)}`,
    });
    expect(oversized.statusCode).toBe(413);
    expect(await counts(s)).toEqual({ matches: 0, releases: 0 });
    expect(logs.join('')).not.toContain(PRIVATE_MARKER);
  });

  it('retains immutable history and accepts only explicit allowlisted release reasons', async () => {
    const s = await seed();
    const c = await cash(s);
    const b = await batch(s);
    const saved = await match(s, candidate(c, b));
    const body = await releaseBody(s, saved.id);
    for (const method of ['PATCH', 'DELETE'] as const)
      expect(
        (await inject({ method, url: `${BASE}/${saved.id}`, headers: s.headers })).statusCode,
      ).toBe(404);
    for (const payload of [
      { ...body, reason: PRIVATE_MARKER },
      { ...body, releasedAmount: '1.00' },
      { ...body, reviewedByRole: 'OWNER' },
      { ...body, idempotencyKey: PRIVATE_MARKER },
    ]) {
      const result = await inject({
        method: 'POST',
        url: `${BASE}/${saved.id}/release`,
        headers: s.headers,
        payload,
      });
      expect(result.statusCode).toBe(400);
      expect(result.body).not.toContain(PRIVATE_MARKER);
    }
    expect(await counts(s)).toEqual({ matches: 1, releases: 0 });
    expect(logs.join('')).not.toContain(PRIVATE_MARKER);
  });
});

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { prisma, type UserRole } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import {
  EvidenceResponseSchema,
  ListResponseSchema,
  PreviewResponseSchema,
  RemittanceInputSchema,
  type RemittanceInput,
  type ReviewInput,
} from '../../lib/remittances/contract.js';

function payment(overrides: Partial<RemittanceInput> = {}): RemittanceInput {
  // The URL is a fixed checked-in synthetic fixture, never request input.
  const raw: unknown = JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    readFileSync(
      new URL('../../../test/fixtures/remittances/partial-payment.json', import.meta.url),
      'utf8',
    ),
  );
  return { ...RemittanceInputSchema.parse(raw), ...overrides };
}

function reversal(overrides: Partial<RemittanceInput> = {}): RemittanceInput {
  return payment({
    sourceRecordId: `synthetic-reversal-${randomUUID()}`,
    kind: 'REVERSAL',
    reversesSourceRecordId: 'synthetic-payment-1',
    reportedAmount: '-35.00',
    allocations: [
      { sourceLineId: 'line-a', amount: '-20.00', sourceStatus: null },
      { sourceLineId: 'line-b', amount: '-10.00', sourceStatus: null },
    ],
    adjustments: [],
    ...overrides,
  });
}

async function seed(role: UserRole = 'BILLING_STAFF', existingOrganizationId?: string) {
  const organizationId =
    existingOrganizationId ??
    (
      await prisma.organization.create({
        data: { name: 'Synthetic remittance practice', clerkOrgId: `org_${randomUUID()}` },
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
  const claim = await prisma.$transaction(async (tx) => {
    const created = await tx.claim.create({
      data: {
        organizationId,
        patientDOBHash: 'synthetic-only',
        claimNumber: `SYNTHETIC-${randomUUID()}`,
        cdtCodes: ['D2740'],
        claimAmount: '200.00',
        payerCode: 'CIGNA_DENTAL',
        serviceDate: new Date('2026-10-01'),
        status: 'COMPLETED',
        sourceSystem: 'OPEN_DENTAL',
        sourceNamespace: 'synthetic-practice',
        sourceClaimId: randomUUID(),
        sourceVersion: '1',
        sourceContentHash: 'a'.repeat(64),
      },
    });
    await tx.claimSourceDetails.create({
      data: {
        organizationId,
        claimId: created.id,
        schemaVersion: 1,
        importedClaimAmount: '200.00',
        lineCount: 2,
        coverageCount: 1,
      },
    });
    await tx.claimSourceLine.createMany({
      data: [
        { sourceLineId: 'line-a', position: 0, tooth: '4' },
        { sourceLineId: 'line-b', position: 1, tooth: '5' },
      ].map((line) => ({
        ...line,
        organizationId,
        claimId: created.id,
        procedureCode: 'D2740',
        serviceDate: new Date('2026-10-01'),
        billedAmount: '100.00',
      })),
    });
    await tx.claimSourceCoverage.create({
      data: {
        organizationId,
        claimId: created.id,
        sourceCoverageId: 'coverage-secondary',
        sequence: 2,
        payerName: 'Synthetic Dental Payer',
        isClaimCoverage: true,
        subscriberId: null,
      },
    });
    return created;
  });
  return { organizationId, user, claim, headers: { 'x-test-user-id': user.clerkUserId } };
}
type Seed = Awaited<ReturnType<typeof seed>>;
const baseUrl = (s: Seed): string => `/v1/claims/${s.claim.id}/remittances`;

describe('claim remittance evidence API (synthetic, real Postgres)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.startsWith('/dentabill_')
    )
      throw new Error('This destructive synthetic suite requires a local DentaBill test database.');
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    app = await buildServer({ logger: false });
    await prisma.$connect();
  });
  async function removeAuditFailure(): Promise<void> {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS reject_remittance_test_audit ON "AuditLog"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_remittance_test_audit()');
  }
  afterEach(async () => {
    await removeAuditFailure();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function imported(s: Seed, payload = payment()) {
    const response = await app.inject({
      method: 'POST',
      url: baseUrl(s),
      headers: s.headers,
      payload,
    });
    expect(response.statusCode, response.body).toBe(201);
    return EvidenceResponseSchema.parse(response.json());
  }
  async function preview(s: Seed, evidenceId: string) {
    const response = await app.inject({
      method: 'GET',
      url: `${baseUrl(s)}/${evidenceId}/preview`,
      headers: s.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    return PreviewResponseSchema.parse(response.json());
  }
  async function reviewBody(
    s: Seed,
    evidenceId: string,
    decision: ReviewInput['decision'] = 'ACCEPT',
  ): Promise<ReviewInput> {
    return {
      decision,
      reviewToken: (await preview(s, evidenceId)).reviewToken,
      idempotencyKey: randomUUID(),
    };
  }
  function review(s: Seed, evidenceId: string, payload: ReviewInput) {
    return app.inject({
      method: 'POST',
      url: `${baseUrl(s)}/${evidenceId}/review`,
      headers: s.headers,
      payload,
    });
  }
  async function accept(s: Seed, evidenceId: string) {
    const response = await review(s, evidenceId, await reviewBody(s, evidenceId));
    expect(response.statusCode, response.body).toBe(200);
    return EvidenceResponseSchema.parse(response.json());
  }
  async function list(s: Seed, suffix = '') {
    const response = await app.inject({
      method: 'GET',
      url: `${baseUrl(s)}${suffix}`,
      headers: s.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    return ListResponseSchema.parse(response.json());
  }
  async function failAudit(
    action: 'remittance.import' | 'remittance.review' | 'remittance.read',
  ): Promise<void> {
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_remittance_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION 'SYNTHETIC-PRIVATE-AUDIT-CONTENT'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_remittance_test_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_remittance_test_audit()',
    );
  }

  it('requires authentication on every evidence endpoint', async () => {
    const s = await seed();
    const e = await imported(s);
    const body = await reviewBody(s, e.id);
    const responses = await Promise.all([
      app.inject({ method: 'GET', url: baseUrl(s) }),
      app.inject({ method: 'POST', url: baseUrl(s), payload: payment() }),
      app.inject({ method: 'GET', url: `${baseUrl(s)}/${e.id}/preview` }),
      app.inject({ method: 'POST', url: `${baseUrl(s)}/${e.id}/review`, payload: body }),
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([401, 401, 401, 401]);
    expect(await prisma.claimRemittanceReview.count()).toBe(0);
  });

  it.each(['OWNER', 'ADMIN', 'BILLING_STAFF'] as const)(
    'permits the stored %s role and attributes its review',
    async (role) => {
      const s = await seed(role);
      const e = await imported(s);
      const accepted = await accept(s, e.id);
      expect(accepted.review).toMatchObject({ decision: 'ACCEPT', reviewedByUserId: s.user.id });
      expect((await list(s)).summary.acceptedCount).toBe(1);
    },
  );

  it('rejects a header-only unknown actor instead of trusting supplied role/org claims', async () => {
    const s = await seed();
    const response = await app.inject({
      method: 'POST',
      url: baseUrl(s),
      headers: {
        'x-test-user-id': 'not-onboarded',
        'x-role': 'OWNER',
        'x-organization-id': s.organizationId,
      },
      payload: payment(),
    });
    expect(response.statusCode).toBe(403);
    expect(await prisma.claimRemittanceEvidence.count()).toBe(0);
  });

  it('preserves partial amounts, distinct same-CDT lines, and signed/zero unknown adjustments without financial mutation', async () => {
    const s = await seed();
    const e = await imported(s);
    expect((await list(s)).summary).toMatchObject({
      reviewedReportedAmount: '0.00',
      pendingCount: 1,
    });
    const p = await preview(s, e.id);
    expect(p.blockers).toEqual([]);
    expect(p.unallocatedAmount).toBe('20.00');
    expect(
      p.allocations.map((line) => [line.sourceLineId, line.procedureCode, line.tooth, line.amount]),
    ).toEqual([
      ['line-a', 'D2740', '4', '60.00'],
      ['line-b', 'D2740', '5', '20.00'],
    ]);
    const accepted = await accept(s, e.id);
    expect(accepted.payload).toEqual(payment());
    const page = await list(s);
    expect(page.summary).toMatchObject({
      reviewedReportedAmount: '100.00',
      allocatedAmount: '80.00',
      unallocatedAmount: '20.00',
      pendingCount: 0,
      acceptedCount: 1,
      rejectedCount: 0,
      cashReceipt: 'UNVERIFIED',
      posting: 'UNVERIFIED',
      settlement: 'UNVERIFIED',
    });
    expect(page.summary.lines.map((line) => line.amount).sort()).toEqual(['20.00', '60.00']);
    const adjustments = await prisma.claimRemittanceAdjustment.findMany({
      orderBy: { sourceIndex: 'asc' },
    });
    expect(adjustments.map((a) => a.amount.toFixed(2))).toEqual(['12.00', '-3.00', '0.00']);
    expect(await prisma.claim.findUnique({ where: { id: s.claim.id } })).toEqual(s.claim);
    expect(await prisma.billingUsageRecord.count()).toBe(0);
  });

  it('accepts zero reported payment with separate adjustment facts without inventing cash', async () => {
    const s = await seed();
    const e = await imported(
      s,
      payment({ reportedAmount: '0.00', allocations: [], lineDetailCompleteness: 'ABSENT' }),
    );
    await accept(s, e.id);
    expect((await list(s)).summary).toMatchObject({
      reviewedReportedAmount: '0.00',
      allocatedAmount: '0.00',
      unallocatedAmount: '0.00',
      acceptedCount: 1,
      cashReceipt: 'UNVERIFIED',
    });
    expect(await prisma.claimRemittanceAdjustment.count()).toBe(3);
  });

  it('serializes concurrent identical source imports into one immutable record and one import audit', async () => {
    const s = await seed();
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        app.inject({ method: 'POST', url: baseUrl(s), headers: s.headers, payload: payment() }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 201]);
    expect(new Set(responses.map((r) => EvidenceResponseSchema.parse(r.json()).id)).size).toBe(1);
    expect(await prisma.claimRemittanceEvidence.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'remittance.import' } })).toBe(1);
  });

  it('rejects changed source facts and source identity rebound to another claim, but isolates identical source IDs across tenants', async () => {
    const s = await seed();
    const original = await imported(s);
    const sibling = await seed('BILLING_STAFF', s.organizationId);
    for (const [target, payload] of [
      [s, payment({ sourceVersion: '2' })],
      [sibling, payment()],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: baseUrl(target),
        headers: target.headers,
        payload,
      });
      expect(response.statusCode).toBe(409);
    }
    const other = await seed();
    const isolated = await imported(other);
    expect(isolated.id).not.toBe(original.id);
    expect((await list(s)).items).toEqual([original]);
  });

  it('does not deduplicate distinct claim reports sharing one document and payment trace', async () => {
    const s = await seed();
    const sibling = await seed('BILLING_STAFF', s.organizationId);
    const a = await imported(s);
    const b = await imported(sibling, payment({ sourceRecordId: 'synthetic-payment-2' }));
    await accept(s, a.id);
    await accept(sibling, b.id);
    expect((await list(s)).summary.reviewedReportedAmount).toBe('100.00');
    expect((await list(sibling)).summary.reviewedReportedAmount).toBe('100.00');
    expect(await prisma.claimRemittanceEvidence.count()).toBe(2);
  });

  it('scopes list/import/preview/review to the stored tenant and exact claim', async () => {
    const own = await seed();
    const other = await seed();
    const e = await imported(other);
    const sibling = await seed('ADMIN', own.organizationId);
    const body = await reviewBody(other, e.id);
    for (const url of [
      baseUrl(other),
      `${baseUrl(other)}/${e.id}/preview`,
      `${baseUrl(sibling)}/${e.id}/preview`,
    ]) {
      const response = await app.inject({ method: 'GET', url, headers: own.headers });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('synthetic-control');
    }
    for (const request of [
      { url: baseUrl(other), payload: payment() },
      { url: `${baseUrl(other)}/${e.id}/review`, payload: body },
      { url: `${baseUrl(sibling)}/${e.id}/review`, payload: body },
    ]) {
      const response = await app.inject({ method: 'POST', headers: own.headers, ...request });
      expect(response.statusCode).toBe(404);
    }
    expect(await prisma.claimRemittanceReview.count()).toBe(0);
  });

  it.each<[string, Partial<RemittanceInput>]>([
    [
      'SOURCE_LINE_MISSING',
      { allocations: [{ sourceLineId: 'absent-line', amount: '10.00', sourceStatus: null }] },
    ],
    ['SOURCE_COVERAGE_MISSING', { sourceCoverageId: 'absent-coverage' }],
  ])('retains unmatched source facts but blocks acceptance with %s', async (blocker, overrides) => {
    const s = await seed();
    const e = await imported(s, payment(overrides));
    expect((await preview(s, e.id)).blockers).toContain(blocker);
    expect((await review(s, e.id, await reviewBody(s, e.id))).statusCode).toBe(409);
    expect((await review(s, e.id, await reviewBody(s, e.id, 'REJECT'))).statusCode).toBe(200);
    expect((await list(s)).summary).toMatchObject({
      rejectedCount: 1,
      reviewedReportedAmount: '0.00',
    });
    expect(await prisma.claimRemittanceAllocation.count()).toBe(0);
  });

  it('preserves an orphan reversal for rejection rather than applying an unbound negative amount', async () => {
    const s = await seed();
    const e = await imported(s, reversal());
    expect((await preview(s, e.id)).blockers).toEqual(['ORIGINAL_MISSING']);
    expect((await review(s, e.id, await reviewBody(s, e.id))).statusCode).toBe(409);
    const rejected = await review(s, e.id, await reviewBody(s, e.id, 'REJECT'));
    expect(rejected.statusCode).toBe(200);
    expect(EvidenceResponseSchema.parse(rejected.json())).toMatchObject({
      payload: { reportedAmount: '-35.00' },
      review: { decision: 'REJECT', reportedAmount: '0.00', reversedEvidenceId: null },
    });
  });

  it('requires the original to be accepted and preserves original payer/coverage matching', async () => {
    const s = await seed();
    const original = await imported(s);
    const pending = await imported(s, reversal());
    expect((await preview(s, pending.id)).blockers).toContain('ORIGINAL_NOT_ACCEPTED');
    await accept(s, original.id);
    const changedPayer = await imported(s, reversal({ payerIdentifier: 'different-payer' }));
    expect((await preview(s, changedPayer.id)).blockers).toContain('REVERSAL_TARGET_MISMATCH');
    expect(
      (await review(s, changedPayer.id, await reviewBody(s, changedPayer.id))).statusCode,
    ).toBe(409);
  });

  it('applies partial and remaining reversals without replacing original evidence or double-counting adjustments', async () => {
    const s = await seed();
    const original = await imported(s);
    await accept(s, original.id);
    const first = await imported(
      s,
      reversal({
        adjustments: payment().adjustments.map((a, i) => ({
          ...a,
          amount: ['-4.00', '1.00', '0.00'][i] ?? '0.00',
        })),
      }),
    );
    await accept(s, first.id);
    expect((await list(s)).summary).toMatchObject({
      reviewedReportedAmount: '65.00',
      allocatedAmount: '50.00',
      unallocatedAmount: '15.00',
    });
    const remaining = await imported(
      s,
      reversal({
        reportedAmount: '-65.00',
        allocations: [
          { sourceLineId: 'line-a', amount: '-40.00', sourceStatus: null },
          { sourceLineId: 'line-b', amount: '-10.00', sourceStatus: null },
        ],
        adjustments: payment().adjustments.map((a, i) => ({
          ...a,
          amount: ['-8.00', '2.00', '0.00'][i] ?? '0.00',
        })),
      }),
    );
    expect((await preview(s, remaining.id)).remainingOriginalAmount).toBe('65.00');
    await accept(s, remaining.id);
    expect((await list(s)).summary).toMatchObject({
      reviewedReportedAmount: '0.00',
      allocatedAmount: '0.00',
      unallocatedAmount: '0.00',
      acceptedCount: 3,
      cashReceipt: 'UNVERIFIED',
    });
    expect((await preview(s, original.id)).evidence.payload).toEqual(payment());
    expect(await prisma.claim.findUnique({ where: { id: s.claim.id } })).toEqual(s.claim);
  });

  it.each([
    [
      'line',
      {
        reportedAmount: '-61.00',
        allocations: [{ sourceLineId: 'line-a', amount: '-61.00', sourceStatus: null }],
      },
    ],
    ['unallocated', { reportedAmount: '-21.00', allocations: [] }],
    [
      'adjustment',
      {
        reportedAmount: '0.00',
        allocations: [],
        adjustments: [{ ...payment().adjustments[0]!, amount: '-12.01' }],
      },
    ],
    [
      'negative adjustment direction',
      {
        reportedAmount: '0.00',
        allocations: [],
        adjustments: [{ ...payment().adjustments[1]!, amount: '-1.00' }],
      },
    ],
  ])(
    'enforces the original %s balance independently of total reported amount',
    async (_label, overrides) => {
      const s = await seed();
      const original = await imported(s);
      await accept(s, original.id);
      const e = await imported(s, reversal(overrides));
      expect((await preview(s, e.id)).blockers).toContain('REVERSAL_EXCEEDS_REMAINING');
      expect((await review(s, e.id, await reviewBody(s, e.id))).statusCode).toBe(409);
      expect(await prisma.claimRemittanceReview.count()).toBe(1);
    },
  );

  it('rejects changed adjustment identity even when reversal magnitude is within the balance', async () => {
    const s = await seed();
    const original = await imported(s);
    await accept(s, original.id);
    const e = await imported(
      s,
      reversal({
        reportedAmount: '0.00',
        allocations: [],
        adjustments: [{ ...payment().adjustments[0]!, reasonCode: 'OTHER', amount: '-1.00' }],
      }),
    );
    expect((await preview(s, e.id)).blockers).toContain('REVERSAL_ADJUSTMENT_MISMATCH');
    expect((await review(s, e.id, await reviewBody(s, e.id))).statusCode).toBe(409);
  });

  it('counts earlier accepted adjustment-only reversals against the remaining original adjustment', async () => {
    const s = await seed();
    const original = await imported(s);
    await accept(s, original.id);
    const first = await imported(
      s,
      reversal({
        reportedAmount: '0.00',
        allocations: [],
        adjustments: [{ ...payment().adjustments[0]!, amount: '-8.00' }],
      }),
    );
    await accept(s, first.id);
    const second = await imported(
      s,
      reversal({
        reportedAmount: '0.00',
        allocations: [],
        adjustments: [{ ...payment().adjustments[0]!, amount: '-5.00' }],
      }),
    );
    expect((await preview(s, second.id)).blockers).toContain('REVERSAL_EXCEEDS_REMAINING');
    expect((await review(s, second.id, await reviewBody(s, second.id))).statusCode).toBe(409);
    expect((await list(s)).summary.reviewedReportedAmount).toBe('100.00');
  });

  it('serializes concurrent partial reversals, invalidates the losing preview, and blocks refreshed over-reversal', async () => {
    const s = await seed();
    const original = await imported(s);
    await accept(s, original.id);
    const payload = {
      reportedAmount: '-70.00',
      allocations: [
        { sourceLineId: 'line-a', amount: '-40.00', sourceStatus: null },
        { sourceLineId: 'line-b', amount: '-15.00', sourceStatus: null },
      ],
    };
    const entries = [await imported(s, reversal(payload)), await imported(s, reversal(payload))];
    const bodies = await Promise.all(entries.map((entry) => reviewBody(s, entry.id)));
    const responses = await Promise.all(
      entries.map((entry, index) => review(s, entry.id, bodies[index]!)),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const loser = entries[responses.findIndex((r) => r.statusCode === 409)]!;
    const fresh = await preview(s, loser.id);
    expect(fresh.remainingOriginalAmount).toBe('30.00');
    expect(fresh.blockers).toContain('REVERSAL_EXCEEDS_REMAINING');
    expect((await review(s, loser.id, await reviewBody(s, loser.id))).statusCode).toBe(409);
    expect((await list(s)).summary).toMatchObject({
      reviewedReportedAmount: '30.00',
      allocatedAmount: '25.00',
      unallocatedAmount: '5.00',
      acceptedCount: 2,
    });
  });

  it.each(['claim', 'ledger'] as const)('rejects a preview after %s changes', async (change) => {
    const s = await seed();
    const e = await imported(s);
    const body = await reviewBody(s, e.id);
    if (change === 'claim')
      await prisma.claim.update({
        where: { id: s.claim.id, organizationId: s.organizationId },
        data: { priority: 22, updatedAt: new Date(s.claim.updatedAt.getTime() + 1000) },
      });
    else await imported(s, payment({ sourceRecordId: 'another-source-record' }));
    expect((await review(s, e.id, body)).statusCode).toBe(409);
    expect(await prisma.claimRemittanceReview.count()).toBe(0);
    await accept(s, e.id);
  });

  it('replays a lost review response and concurrent identical keys without duplicate children, even after the claim changes', async () => {
    const s = await seed();
    const e = await imported(s);
    const body = await reviewBody(s, e.id);
    const responses = await Promise.all([review(s, e.id, body), review(s, e.id, body)]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(responses[0].json()).toEqual(responses[1].json());
    await prisma.claim.update({
      where: { id: s.claim.id, organizationId: s.organizationId },
      data: { priority: 42 },
    });
    const replay = await review(s, e.id, body);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(responses[0].json());
    expect(await prisma.claimRemittanceReview.count()).toBe(1);
    expect(await prisma.claimRemittanceAllocation.count()).toBe(2);
    expect(await prisma.claimRemittanceAdjustment.count()).toBe(3);
    expect(await prisma.auditLog.count({ where: { action: 'remittance.review' } })).toBe(1);
  });

  it('conflicts when a saved key is reused with another decision, token, evidence or claim', async () => {
    const s = await seed();
    const e = await imported(s);
    const body = await reviewBody(s, e.id);
    expect((await review(s, e.id, body)).statusCode).toBe(200);
    for (const changed of [
      { ...body, decision: 'REJECT' as const },
      { ...body, reviewToken: 'b'.repeat(64) },
    ])
      expect((await review(s, e.id, changed)).statusCode).toBe(409);
    const sibling = await seed('OWNER', s.organizationId);
    for (const target of [s, sibling]) {
      const other = await imported(target, payment({ sourceRecordId: randomUUID() }));
      expect(
        (
          await review(target, other.id, {
            ...(await reviewBody(target, other.id)),
            idempotencyKey: body.idempotencyKey,
          })
        ).statusCode,
      ).toBe(409);
    }
    expect(await prisma.claimRemittanceReview.count()).toBe(1);
  });

  it('does not let another stored actor replay an approval as their own using its key', async () => {
    const s = await seed();
    const e = await imported(s);
    const body = await reviewBody(s, e.id);
    expect((await review(s, e.id, body)).statusCode).toBe(200);
    const other = await seed('OWNER', s.organizationId);
    const replay = await review({ ...s, user: other.user, headers: other.headers }, e.id, body);
    expect(replay.statusCode).toBe(409);
    expect((await preview(s, e.id)).evidence.review?.reviewedByUserId).toBe(s.user.id);
  });

  it.each(['remittance.import', 'remittance.review'] as const)(
    'rolls back all children on a late %s audit failure, redacts the error, and permits exact retry',
    async (action) => {
      const s = await seed();
      const e = action === 'remittance.review' ? await imported(s) : null;
      const body = e ? await reviewBody(s, e.id) : null;
      await failAudit(action);
      const response =
        e && body
          ? await review(s, e.id, body)
          : await app.inject({
              method: 'POST',
              url: baseUrl(s),
              headers: s.headers,
              payload: payment(),
            });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('SYNTHETIC-PRIVATE-AUDIT-CONTENT');
      expect(response.body).not.toContain('synthetic-control');
      expect(await prisma.claimRemittanceEvidence.count()).toBe(e ? 1 : 0);
      expect(await prisma.claimRemittanceReview.count()).toBe(0);
      expect(await prisma.claimRemittanceAllocation.count()).toBe(0);
      expect(await prisma.claimRemittanceAdjustment.count()).toBe(0);
      await removeAuditFailure();
      if (e && body) expect((await review(s, e.id, body)).statusCode).toBe(200);
      else await imported(s);
    },
  );

  it.each(['pending', 'accepted', 'rejected'] as const)(
    'retains a claim with %s evidence on DELETE without removing source detail',
    async (state) => {
      const s = await seed();
      const e = await imported(s);
      if (state !== 'pending')
        expect(
          (
            await review(
              s,
              e.id,
              await reviewBody(s, e.id, state === 'accepted' ? 'ACCEPT' : 'REJECT'),
            )
          ).statusCode,
        ).toBe(200);
      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/claims/${s.claim.id}`,
        headers: s.headers,
      });
      expect(response.statusCode).toBe(409);
      expect(await prisma.claim.count()).toBe(1);
      expect(await prisma.claimSourceLine.count()).toBe(2);
      expect(await prisma.claimRemittanceEvidence.count()).toBe(1);
    },
  );

  it.each(['import', 'review'] as const)(
    'fails an exact %s replay closed when its access audit fails without altering the saved evidence',
    async (kind) => {
      const s = await seed();
      const e = await imported(s);
      const body = await reviewBody(s, e.id);
      if (kind === 'review') expect((await review(s, e.id, body)).statusCode).toBe(200);
      const before = await prisma.claimRemittanceEvidence.findMany({ include: { review: true } });
      const auditCount = await prisma.auditLog.count();
      await failAudit('remittance.read');
      const request = () =>
        kind === 'review'
          ? review(s, e.id, body)
          : app.inject({ method: 'POST', url: baseUrl(s), headers: s.headers, payload: payment() });
      const failed = await request();
      expect(failed.statusCode).toBe(500);
      expect(failed.body).not.toContain('SYNTHETIC-PRIVATE-AUDIT-CONTENT');
      expect(failed.body).not.toContain('synthetic-control');
      expect(await prisma.claimRemittanceEvidence.findMany({ include: { review: true } })).toEqual(
        before,
      );
      expect(await prisma.auditLog.count()).toBe(auditCount);
      await removeAuditFailure();
      expect((await request()).statusCode).toBe(200);
      expect(await prisma.auditLog.count()).toBe(auditCount + 1);
    },
  );

  it('serializes claim deletion with source import without an orphan or partial deletion', async () => {
    const s = await seed();
    const [created, deleted] = await Promise.all([
      app.inject({ method: 'POST', url: baseUrl(s), headers: s.headers, payload: payment() }),
      app.inject({ method: 'DELETE', url: `/v1/claims/${s.claim.id}`, headers: s.headers }),
    ]);
    expect([
      [201, 409],
      [404, 204],
    ]).toContainEqual([created.statusCode, deleted.statusCode]);
    expect(await prisma.claim.count()).toBe(created.statusCode === 201 ? 1 : 0);
    expect(await prisma.claimRemittanceEvidence.count()).toBe(created.statusCode === 201 ? 1 : 0);
  });

  it('paginates without duplicate evidence, returns full-ledger totals on every page, and rejects foreign cursors', async () => {
    const s = await seed();
    const entries = [];
    for (let i = 0; i < 5; i++)
      entries.push(await imported(s, payment({ sourceRecordId: `page-${String(i)}` })));
    await accept(s, entries[0]!.id);
    const page = await list(s, '?limit=2');
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
    const second = await list(s, `?limit=2&cursor=${encodeURIComponent(page.nextCursor!)}`);
    const third = await list(s, `?limit=2&cursor=${encodeURIComponent(second.nextCursor!)}`);
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeNull();
    expect(new Set([...page.items, ...second.items, ...third.items].map((e) => e.id)).size).toBe(5);
    expect(second.summary).toEqual(page.summary);
    expect(third.summary).toEqual(page.summary);
    for (const target of [await seed('OWNER', s.organizationId), await seed()]) {
      const response = await app.inject({
        method: 'GET',
        url: `${baseUrl(target)}?cursor=${encodeURIComponent(page.nextCursor!)}`,
        headers: target.headers,
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain(s.organizationId);
    }
  });

  it.each([
    '?limit=0',
    '?limit=101',
    '?limit=1.5',
    '?cursor=not-json',
    '?unrecognized=synthetic-private',
  ] as const)('rejects malformed pagination %s safely', async (suffix) => {
    const s = await seed();
    const response = await app.inject({
      method: 'GET',
      url: `${baseUrl(s)}${suffix}`,
      headers: s.headers,
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('synthetic-private');
  });

  it('bounds large UTF-8 evidence pages by serialized bytes and traverses every item', async () => {
    const s = await seed();
    const ids: string[] = [];
    const large = payment({
      allocations: [],
      lineDetailCompleteness: 'ABSENT',
      adjustments: Array.from({ length: 500 }, (_, i) => ({
        sourceAdjustmentId: `${'界'.repeat(150)}-${String(i)}`,
        sourceLineId: null,
        codeSystem: '界'.repeat(32),
        groupCode: '界'.repeat(32),
        reasonCode: '界'.repeat(32),
        amount: '0.00',
        sourceReference: '界'.repeat(150),
      })),
    });
    expect(Buffer.byteLength(JSON.stringify(large))).toBeGreaterThan(600_000);
    for (let i = 0; i < 5; i++)
      ids.push((await imported(s, { ...large, sourceRecordId: `large-${String(i)}` })).id);
    let cursor: string | null = null;
    const seen: string[] = [];
    for (let pageNumber = 0; pageNumber < 6; pageNumber++) {
      const suffix: string = cursor
        ? `?limit=100&cursor=${encodeURIComponent(cursor)}`
        : '?limit=100';
      const response = await app.inject({
        method: 'GET',
        url: `${baseUrl(s)}${suffix}`,
        headers: s.headers,
      });
      expect(response.statusCode, response.body.slice(0, 200)).toBe(200);
      expect(Buffer.byteLength(response.body)).toBeLessThanOrEqual(2 * 1024 * 1024);
      const page = ListResponseSchema.parse(response.json());
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.summary.pendingCount).toBe(5);
      seen.push(...page.items.map((entry) => entry.id));
      cursor = page.nextCursor;
      expect(page.hasMore).toBe(cursor !== null);
      if (!cursor) break;
    }
    expect(seen.sort()).toEqual(ids.sort());
  }, 30_000);

  it('rejects untrusted review fields and invalid tokens/keys without exposing source data', async () => {
    const s = await seed();
    const e = await imported(s);
    const body = await reviewBody(s, e.id);
    for (const payload of [
      { ...body, reportedAmount: '999.00', private: 'SYNTHETIC-PRIVATE-REVIEW' },
      { ...body, reviewToken: 'SYNTHETIC-PRIVATE-REVIEW' },
      { ...body, idempotencyKey: 'SYNTHETIC-PRIVATE-REVIEW' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: `${baseUrl(s)}/${e.id}/review`,
        headers: s.headers,
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('SYNTHETIC-PRIVATE-REVIEW');
      expect(response.body).not.toContain('synthetic-control');
    }
    expect(await prisma.claimRemittanceReview.count()).toBe(0);
  });

  it('rejects malformed, extra, oversized, invalid-sign and inconsistent-total inputs without raw-value disclosure or writes', async () => {
    const s = await seed();
    const marker = 'SYNTHETIC-PRIVATE-INPUT';
    const invalid: unknown[] = [
      { ...payment(), unexpected: marker },
      { ...payment(), reportedAmount: marker },
      payment({ reportedAmount: '-0.00' }),
      payment({ reportedAmount: '-1.00' }),
      payment({ reportedDate: '2026-02-30' }),
      payment({ lineDetailCompleteness: 'COMPLETE' }),
      payment({ lineDetailCompleteness: 'ABSENT' }),
      payment({ allocations: [payment().allocations[0]!, payment().allocations[0]!] }),
      payment({ adjustments: [payment().adjustments[0]!, payment().adjustments[0]!] }),
      payment({ sourceRecordId: marker.repeat(20) }),
      payment({
        allocations: Array.from({ length: 501 }, (_, i) => ({
          sourceLineId: String(i),
          amount: '0.00',
          sourceStatus: null,
        })),
      }),
    ];
    for (const payload of invalid) {
      const response = await app.inject({
        method: 'POST',
        url: baseUrl(s),
        headers: { ...s.headers, 'content-type': 'application/json' },
        payload: JSON.stringify(payload),
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain(marker);
      expect(response.body).not.toContain('synthetic-control');
    }
    for (const payload of [
      `{"payerName":"${marker}",`,
      JSON.stringify({ [marker]: 'x'.repeat(1024 * 1024) }),
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: baseUrl(s),
        headers: { ...s.headers, 'content-type': 'application/json' },
        payload,
      });
      expect([400, 413]).toContain(response.statusCode);
      expect(response.body).not.toContain(marker);
    }
    expect(await prisma.claimRemittanceEvidence.count()).toBe(0);
  });
});

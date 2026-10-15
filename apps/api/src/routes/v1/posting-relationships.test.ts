import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { prisma, type UserRole } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { bulkInsertClaims } from '../../lib/csv/insert.js';
import { parseClaimsCSV } from '../../lib/csv/parser.js';
import type { CsvSource } from '../../lib/csv/types.js';
import { initEnv } from '../../lib/env.js';
import {
  PostingEvidenceSchema,
  PostingInputSchema,
  PostingPreviewSchema,
  type PostingInput,
} from '../../lib/posting-evidence/contract.js';
import {
  RelationshipListSchema,
  RelationshipPreviewSchema,
  RelationshipReceiptSchema,
  RelationshipReleasePreviewSchema,
  RelationshipReleaseReceiptSchema,
  RelationshipTargetsSchema,
  type RelationshipCandidate,
  type RelationshipDecision,
  type RelationshipReleaseDecision,
} from '../../lib/posting-relationships/contract.js';

const SOURCE = 'synthetic-relationships';
const BASE = '/v1/posting-relationships';
const PRIVATE_MARKER = 'SYNTHETIC-PRIVATE-RELATIONSHIP';
const financialState = {
  provenance: 'MANUAL_REVIEW',
  relationshipBasis: 'EXACT_SOURCE_IDENTITY',
  sourceVerification: 'UNVERIFIED',
  bankVerification: 'UNVERIFIED',
  settlement: 'UNVERIFIED',
  claimCashAllocation: 'UNALLOCATED',
} as const;
function input(overrides: Partial<PostingInput> = {}): PostingInput {
  const raw: unknown = JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed synthetic fixture URL
    readFileSync(
      new URL(
        '../../../test/fixtures/posting-relationships/01-header150-entries180.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const base = PostingInputSchema.parse(raw);
  return PostingInputSchema.parse({
    ...base,
    sourceReceiptId: randomUUID(),
    sourceRecordId: randomUUID(),
    entries: base.entries.map((entry) => ({ ...entry, sourceEntryId: randomUUID() })),
    ...overrides,
  });
}
function revision(payload: PostingInput, overrides: Partial<PostingInput> = {}): PostingInput {
  return PostingInputSchema.parse({
    ...payload,
    sourceRecordId: randomUUID(),
    sourceSequence: payload.sourceSequence + 1,
    ...overrides,
  });
}
async function seed(
  role: UserRole = 'BILLING_STAFF',
  existingOrganizationId?: string,
  sourceSystem: CsvSource = 'OPEN_DENTAL',
  sourceNamespace = SOURCE,
) {
  const organizationId =
    existingOrganizationId ??
    (
      await prisma.organization.create({
        data: {
          name: 'Synthetic posting relationship practice',
          clerkOrgId: `org_${randomUUID()}`,
        },
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
  const parsed = parseClaimsCSV(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed synthetic fixture URL
    readFileSync(
      new URL('../../../test/fixtures/posting-relationships/source-claims.csv', import.meta.url),
    ),
  );
  expect(parsed.errors).toEqual([]);
  await bulkInsertClaims({
    organizationId,
    actorId: user.id,
    source: sourceSystem,
    sourceNamespace,
    canonicalRows: parsed.rows,
    dobHashSecret: 'synthetic-relationship-import-hash',
  });
  const claims = await prisma.claim.findMany({
    where: { organizationId, sourceSystem, sourceNamespace },
    orderBy: { sourceClaimId: 'asc' },
    include: { sourceDetails: { include: { lines: { orderBy: { position: 'asc' } } } } },
  });
  expect(claims).toHaveLength(2);
  return { organizationId, user, claims, headers: { 'x-test-user-id': user.clerkUserId } };
}
type Seed = Awaited<ReturnType<typeof seed>>;
type Claim = Seed['claims'][number];
type Posting = ReturnType<typeof PostingEvidenceSchema.parse>;
function candidate(posting: Posting, claim: Claim, index = 0): RelationshipCandidate {
  const entry = posting.payload.entries[index]!;
  return {
    evidenceId: posting.id,
    sourceEntryId: entry.sourceEntryId,
    claimId: claim.id,
    claimSourceLineId:
      entry.sourceLineId === null
        ? null
        : (claim.sourceDetails?.lines.find((line) => line.sourceLineId === entry.sourceLineId)
            ?.id ?? null),
  };
}

describe('posting relationships API (synthetic, real Postgres)', { timeout: 30000 }, () => {
  let app: FastifyInstance;
  const logs: string[] = [];
  let ordinal = 0;
  function inject(options: InjectOptions) {
    ordinal += 1;
    return app.inject({ ...options, remoteAddress: `2001:db8::${ordinal.toString(16)}` });
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.startsWith('/dentabill_')
    )
      throw new Error('Posting relationship tests require an isolated local DentaBill database.');
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
  }, 30000);
  async function removeAuditFailure() {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS reject_relationship_test_audit ON "AuditLog"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_relationship_test_audit()');
  }
  afterEach(async () => {
    await removeAuditFailure();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
    logs.length = 0;
  }, 30000);
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  }, 30000);
  async function reviewPosting(s: Seed, id: string, decision: 'ACCEPT' | 'REJECT' = 'ACCEPT') {
    const p = await inject({
      method: 'GET',
      url: `/v1/posting-evidence/${id}/preview`,
      headers: s.headers,
    });
    expect(p.statusCode, p.body).toBe(200);
    const result = await inject({
      method: 'POST',
      url: `/v1/posting-evidence/${id}/review`,
      headers: s.headers,
      payload: {
        decision,
        reviewToken: PostingPreviewSchema.parse(p.json()).reviewToken,
        idempotencyKey: randomUUID(),
      },
    });
    expect(result.statusCode, result.body).toBe(200);
    return PostingEvidenceSchema.parse(result.json());
  }
  async function posting(
    s: Seed,
    payload = input(),
    decision: 'ACCEPT' | 'REJECT' | null = 'ACCEPT',
  ) {
    const result = await inject({
      method: 'POST',
      url: '/v1/posting-evidence',
      headers: s.headers,
      payload,
    });
    expect(result.statusCode, result.body).toBe(201);
    const row = PostingEvidenceSchema.parse(result.json());
    return decision ? reviewPosting(s, row.id, decision) : row;
  }
  async function targets(s: Seed, id: string) {
    const result = await inject({
      method: 'GET',
      url: `/v1/posting-evidence/${id}/relationship-targets`,
      headers: s.headers,
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(Buffer.byteLength(result.body)).toBeLessThanOrEqual(2 * 1024 * 1024);
    return RelationshipTargetsSchema.parse(result.json());
  }
  async function preview(s: Seed, payload: RelationshipCandidate) {
    const result = await inject({
      method: 'POST',
      url: `${BASE}/preview`,
      headers: s.headers,
      payload,
    });
    expect(result.statusCode, result.body).toBe(200);
    return RelationshipPreviewSchema.parse(result.json());
  }
  async function body(s: Seed, payload: RelationshipCandidate): Promise<RelationshipDecision> {
    return {
      ...payload,
      reviewToken: (await preview(s, payload)).reviewToken,
      idempotencyKey: randomUUID(),
    };
  }
  function submit(s: Seed, payload: RelationshipDecision) {
    return inject({ method: 'POST', url: BASE, headers: s.headers, payload });
  }
  async function link(s: Seed, payload: RelationshipCandidate) {
    const result = await submit(s, await body(s, payload));
    expect(result.statusCode, result.body).toBe(201);
    return RelationshipReceiptSchema.parse(result.json());
  }
  async function releasePreview(
    s: Seed,
    id: string,
    reason: RelationshipReleaseDecision['reason'] = 'SOURCE_CHANGED',
  ) {
    const result = await inject({
      method: 'POST',
      url: `${BASE}/${id}/release/preview`,
      headers: s.headers,
      payload: { reason },
    });
    expect(result.statusCode, result.body).toBe(200);
    return RelationshipReleasePreviewSchema.parse(result.json());
  }
  async function releaseBody(
    s: Seed,
    id: string,
    reason: RelationshipReleaseDecision['reason'] = 'SOURCE_CHANGED',
  ): Promise<RelationshipReleaseDecision> {
    return {
      reason,
      reviewToken: (await releasePreview(s, id, reason)).reviewToken,
      idempotencyKey: randomUUID(),
    };
  }
  function submitRelease(s: Seed, id: string, payload: RelationshipReleaseDecision) {
    return inject({ method: 'POST', url: `${BASE}/${id}/release`, headers: s.headers, payload });
  }
  async function release(
    s: Seed,
    id: string,
    reason: RelationshipReleaseDecision['reason'] = 'SOURCE_CHANGED',
  ) {
    const result = await submitRelease(s, id, await releaseBody(s, id, reason));
    expect(result.statusCode, result.body).toBe(201);
    return RelationshipReleaseReceiptSchema.parse(result.json());
  }
  async function list(s: Seed, suffix = '') {
    const result = await inject({ method: 'GET', url: `${BASE}${suffix}`, headers: s.headers });
    expect(result.statusCode, result.body).toBe(200);
    expect(Buffer.byteLength(result.body)).toBeLessThanOrEqual(2 * 1024 * 1024);
    return RelationshipListSchema.parse(result.json());
  }
  async function snapshot(s: Seed) {
    const where = { organizationId: s.organizationId };
    const orderBy = { id: 'asc' as const };
    return {
      claims: await prisma.claim.findMany({ where, orderBy }),
      lines: await prisma.claimSourceLine.findMany({ where, orderBy }),
      coverages: await prisma.claimSourceCoverage.findMany({ where, orderBy }),
      postingEvidence: await prisma.postingSourceEvidence.findMany({ where, orderBy }),
      postingReviews: await prisma.postingSourceReview.findMany({ where, orderBy }),
      postingEntries: await prisma.postingSourceEntry.findMany({ where, orderBy }),
      remittances: await prisma.claimRemittanceEvidence.findMany({ where, orderBy }),
      cash: await prisma.cashSourceEvidence.findMany({ where, orderBy }),
      batches: await prisma.remittanceBatchEvidence.findMany({ where, orderBy }),
      cashMatches: await prisma.cashBatchMatch.findMany({ where, orderBy }),
      allocations: await prisma.claimRemittanceAllocation.findMany({ where, orderBy }),
      usage: await prisma.billingUsageRecord.findMany({ where, orderBy }),
    };
  }
  async function changeClaim(s: Seed, claim = s.claims[0]!) {
    await prisma.claim.updateMany({
      where: { organizationId: s.organizationId, id: claim.id },
      data: { priority: claim.priority + 1, updatedAt: new Date(claim.updatedAt.getTime() + 1000) },
    });
  }
  async function failAudit(
    action:
      | 'posting.relationship.read'
      | 'posting.relationship.create'
      | 'posting.relationship.release',
  ) {
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_relationship_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION '${PRIVATE_MARKER}'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_relationship_test_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_relationship_test_audit()',
    );
  }

  it('requires authentication for targets, preview, list, link and both release handlers', async () => {
    const s = await seed();
    const p = await posting(s);
    const c = candidate(p, s.claims[0]!);
    const command = await body(s, c);
    const saved = await link(s, c);
    const releasing = await releaseBody(s, saved.id);
    const options: InjectOptions[] = [
      { method: 'GET', url: `/v1/posting-evidence/${p.id}/relationship-targets` },
      { method: 'GET', url: BASE },
      { method: 'POST', url: `${BASE}/preview`, payload: c },
      { method: 'POST', url: BASE, payload: command },
      {
        method: 'POST',
        url: `${BASE}/${saved.id}/release/preview`,
        payload: { reason: 'SOURCE_CHANGED' },
      },
      { method: 'POST', url: `${BASE}/${saved.id}/release`, payload: releasing },
    ];
    for (const option of options) expect((await inject(option)).statusCode).toBe(401);
    expect((await list(s)).items).toHaveLength(1);
  });

  it.each(['OWNER', 'ADMIN', 'BILLING_STAFF'] as const)(
    'uses the stored %s actor for relationship and release',
    async (role) => {
      const s = await seed(role);
      const p = await posting(s);
      const saved = await link(s, candidate(p, s.claims[0]!));
      expect(saved).toMatchObject({
        reviewedByUserId: s.user.id,
        reviewedByRole: role,
        ...financialState,
      });
      expect(await release(s, saved.id, 'WRONG_LINK')).toMatchObject({
        relationshipId: saved.id,
        reviewedByUserId: s.user.id,
        reviewedByRole: role,
        reason: 'WRONG_LINK',
      });
    },
  );

  it.each(['DENTRIX', 'EAGLESOFT', 'OPEN_DENTAL'] as const)(
    'resolves exact %s source identity despite duplicate display numbers and procedure codes',
    async (sourceSystem) => {
      const s = await seed('BILLING_STAFF', undefined, sourceSystem);
      const p = await posting(s, input({ sourceSystem }));
      const before = await snapshot(s);
      const resolved = await targets(s, p.id);
      expect(resolved).toMatchObject(financialState);
      expect(resolved.items.map((item) => item.candidate)).toEqual([
        candidate(p, s.claims[0]!, 0),
        candidate(p, s.claims[0]!, 1),
      ]);
      expect(resolved.items.every((item) => item.blockers.length === 0)).toBe(true);
      const a = await link(s, candidate(p, s.claims[0]!, 0));
      const b = await link(s, candidate(p, s.claims[0]!, 1));
      expect(a.claimSourceLineId).not.toBe(b.claimSourceLineId);
      expect((await list(s)).items.every((row) => row.status === 'CURRENT')).toBe(true);
      expect((await list(s)).items[0]?.source).toMatchObject({
        headerAmount: '150.00',
        entry: { amount: '80.00' },
      });
      expect(await snapshot(s)).toEqual(before);
    },
  );

  it('does not trust caller role or organization headers for an unknown stored actor', async () => {
    const s = await seed();
    const p = await posting(s);
    const result = await inject({
      method: 'POST',
      url: `${BASE}/preview`,
      payload: candidate(p, s.claims[0]!),
      headers: {
        'x-test-user-id': 'unknown-relationship-actor',
        'x-role': 'OWNER',
        'x-organization-id': s.organizationId,
      },
    });
    expect(result.statusCode).toBe(403);
  });

  it.each(['unknown', 'negative-transfer', 'zero-adjustment'] as const)(
    'preserves %s source facts without manufacturing payments or allocations',
    async (kind) => {
      const s = await seed();
      const base = input();
      const entry = base.entries[0]!;
      const amount = kind === 'unknown' ? null : kind === 'negative-transfer' ? '-25.00' : '0.00';
      const sourceAmount = kind === 'negative-transfer' ? '25.00' : amount;
      const sourceSignConvention =
        kind === 'negative-transfer' ? 'DEBIT_POSITIVE' : 'CREDIT_POSITIVE';
      const p = await posting(
        s,
        input({
          amount,
          sourceAmount,
          sourceSignConvention,
          entries: [
            {
              ...entry,
              amount,
              sourceAmount,
              sourceSignConvention,
              entryKind:
                kind === 'unknown'
                  ? 'UNKNOWN'
                  : kind === 'negative-transfer'
                    ? 'TRANSFER'
                    : 'ADJUSTMENT',
              sourceIsTransfer: kind === 'negative-transfer' ? true : null,
              sourceStatus: 'synthetic:uninterpreted',
              sourceVersion: 'child-v7',
            },
          ],
        }),
      );
      const before = await snapshot(s);
      const c = candidate(p, s.claims[0]!);
      const previewed = await preview(s, c);
      expect(previewed.blockers).toEqual([]);
      expect(previewed.source.entry).toEqual(p.payload.entries[0]);
      await link(s, c);
      expect((await list(s)).items[0]?.source.entry).toEqual(p.payload.entries[0]);
      expect(await snapshot(s)).toEqual(before);
    },
  );

  it('allows claim-only association but does not infer a line from a procedure-only reference', async () => {
    const s = await seed();
    const base = input();
    const p = await posting(
      s,
      input({
        entries: [{ ...base.entries[0]!, sourceLineId: null, sourceProcedureId: 'procedure-a' }],
      }),
    );
    const resolved = await targets(s, p.id);
    expect(resolved.items[0]?.candidate).toEqual(candidate(p, s.claims[0]!));
    expect(resolved.items[0]?.claim?.line).toBeNull();
    const forced = {
      ...candidate(p, s.claims[0]!),
      claimSourceLineId: s.claims[0]!.sourceDetails!.lines[0]!.id,
    };
    expect((await preview(s, forced)).blockers).toContain('SOURCE_LINE_ID_MISSING');
    expect((await submit(s, await body(s, forced))).statusCode).toBe(409);
    expect(await link(s, candidate(p, s.claims[0]!))).toMatchObject({ claimSourceLineId: null });
  });

  it.each([
    ['unsupported-system', 'SOURCE_SYSTEM_UNSUPPORTED'],
    ['missing-claim', 'SOURCE_CLAIM_ID_MISSING'],
    ['wrong-claim', 'CLAIM_SOURCE_IDENTITY_MISMATCH'],
    ['wrong-namespace', 'CLAIM_SOURCE_IDENTITY_MISMATCH'],
    ['unknown-line', 'SOURCE_LINE_NOT_FOUND'],
    ['wrong-procedure', 'SOURCE_PROCEDURE_MISMATCH'],
  ] as const)(
    'blocks %s without falling back to display numbers, amounts or procedure codes',
    async (kind, blocker) => {
      const s = await seed();
      const base = input();
      const entry = { ...base.entries[0]! };
      if (kind === 'missing-claim') entry.sourceClaimId = null;
      if (kind === 'wrong-claim') entry.sourceClaimId = 'missing-source-claim';
      if (kind === 'unknown-line') entry.sourceLineId = 'missing-source-line';
      if (kind === 'wrong-procedure') entry.sourceProcedureId = 'procedure-b';
      const p = await posting(
        s,
        input({
          sourceSystem: kind === 'unsupported-system' ? 'SYNTHETIC_PMS' : 'OPEN_DENTAL',
          sourceNamespace: kind === 'wrong-namespace' ? 'different-source' : SOURCE,
          entries: [entry],
        }),
      );
      const c = candidate(p, s.claims[0]!);
      const previewed = await preview(s, c);
      expect(previewed.blockers).toContain(blocker);
      expect((await submit(s, await body(s, c))).statusCode).toBe(409);
      const resolved = await targets(s, p.id);
      expect(resolved.items[0]?.blockers).toContain(blocker);
      expect((await list(s)).items).toEqual([]);
    },
  );

  it('rejects wrong local claim and line targets even when source and display fields look alike', async () => {
    const s = await seed();
    const p = await posting(s);
    const correct = candidate(p, s.claims[0]!);
    const wrongClaim = candidate(p, s.claims[1]!);
    expect((await preview(s, wrongClaim)).blockers).toContain('CLAIM_SOURCE_IDENTITY_MISMATCH');
    expect((await submit(s, await body(s, wrongClaim))).statusCode).toBe(409);
    const wrongLine = { ...correct, claimSourceLineId: s.claims[0]!.sourceDetails!.lines[1]!.id };
    expect((await preview(s, wrongLine)).blockers).toContain('SOURCE_LINE_NOT_FOUND');
    expect((await submit(s, await body(s, wrongLine))).statusCode).toBe(409);
    const absentLine = { ...correct, claimSourceLineId: null };
    expect((await preview(s, absentLine)).blockers).toContain('SOURCE_LINE_NOT_FOUND');
    expect((await submit(s, await body(s, absentLine))).statusCode).toBe(409);
  });

  it('does not promote a legacy claim display number into imported source identity', async () => {
    const s = await seed();
    const legacy = await prisma.claim.create({
      data: {
        organizationId: s.organizationId,
        patientDOBHash: 'synthetic-relationship-legacy',
        claimNumber: 'synthetic-legacy-claim',
        cdtCodes: ['D2740'],
        claimAmount: '100.00',
        serviceDate: new Date('2026-10-01T00:00:00Z'),
        payerCode: 'UNKNOWN',
      },
    });
    const base = input();
    const p = await posting(
      s,
      input({
        entries: [{ ...base.entries[0]!, sourceClaimId: legacy.claimNumber, sourceLineId: null }],
      }),
    );
    const c = {
      evidenceId: p.id,
      sourceEntryId: p.payload.entries[0]!.sourceEntryId,
      claimId: legacy.id,
      claimSourceLineId: null,
    };
    expect((await targets(s, p.id)).items[0]).toMatchObject({ candidate: null, claim: null });
    expect((await preview(s, c)).blockers).toContain('CLAIM_SOURCE_IDENTITY_MISMATCH');
    expect((await submit(s, await body(s, c))).statusCode).toBe(409);
    expect((await list(s)).items).toEqual([]);
  });

  it.each([null, 'REJECT'] as const)(
    'requires accepted source evidence when review is%s',
    async (decision) => {
      const s = await seed();
      const p = await posting(s, input(), decision);
      const c = candidate(p, s.claims[0]!);
      expect((await preview(s, c)).blockers).toContain('SOURCE_NOT_ACCEPTED');
      expect((await submit(s, await body(s, c))).statusCode).toBe(409);
      expect(
        (await targets(s, p.id)).items.every((item) =>
          item.blockers.includes('SOURCE_NOT_ACCEPTED'),
        ),
      ).toBe(true);
    },
  );

  it.each([null, 'REJECT', 'ACCEPT'] as const)(
    'retains stale identity reservations after a newer source review%s until explicit release',
    async (decision) => {
      const s = await seed();
      const p = await posting(s);
      const c = candidate(p, s.claims[0]!);
      const saved = await link(s, c);
      const newer = await posting(s, revision(p.payload), decision);
      expect((await list(s)).items[0]).toMatchObject({
        id: saved.id,
        status: 'STALE',
        blockers: expect.arrayContaining(['SOURCE_NOT_CURRENT']),
      });
      expect((await preview(s, c)).blockers).toContain('SOURCE_NOT_CURRENT');
      const next = candidate(newer, s.claims[0]!);
      expect((await preview(s, next)).blockers).toContain('ENTRY_ALREADY_LINKED');
      expect((await submit(s, await body(s, next))).statusCode).toBe(409);
      expect((await releasePreview(s, saved.id)).canRelease).toBe(true);
      await release(s, saved.id);
      if (decision === 'ACCEPT') await link(s, next);
      else expect((await preview(s, next)).blockers).toContain('SOURCE_NOT_ACCEPTED');
    },
  );

  it.each(['COMPLETE', 'PARTIAL', 'REMOVED'] as const)(
    'does not free a relationship when later%s evidence omits its entry',
    async (kind) => {
      const s = await seed();
      const p = await posting(s);
      const saved = await link(s, candidate(p, s.claims[0]!));
      await posting(
        s,
        revision(p.payload, {
          status: kind === 'REMOVED' ? 'REMOVED' : 'POSTED',
          detailCompleteness: kind === 'REMOVED' ? 'ABSENT' : kind,
          entries: [],
          amount: kind === 'REMOVED' ? null : '0.00',
          sourceAmount: kind === 'REMOVED' ? null : '0.00',
        }),
      );
      expect((await list(s)).items[0]).toMatchObject({
        id: saved.id,
        status: 'STALE',
        release: null,
      });
      if (kind !== 'PARTIAL') {
        const replacement = await posting(s, input({ entries: [p.payload.entries[0]!] }));
        const next = candidate(replacement, s.claims[0]!);
        expect((await preview(s, next)).blockers).toContain('ENTRY_ALREADY_LINKED');
        expect((await submit(s, await body(s, next))).statusCode).toBe(409);
        await release(s, saved.id);
        await link(s, next);
      } else await release(s, saved.id);
    },
  );

  it('makes a relationship stale after a claim edit and requires release before renewed approval', async () => {
    const s = await seed();
    const p = await posting(s);
    const c = candidate(p, s.claims[0]!);
    const saved = await link(s, c);
    await changeClaim(s);
    expect((await list(s)).items[0]).toMatchObject({
      status: 'STALE',
      blockers: expect.arrayContaining(['CLAIM_CHANGED']),
    });
    expect((await preview(s, c)).blockers).toContain('ENTRY_ALREADY_LINKED');
    await release(s, saved.id);
    const next = await link(s, c);
    expect(next.claimVersion).not.toBe(saved.claimVersion);
  });

  it('binds the exact target and claim version to approval, including source acceptance after a blocked preview', async () => {
    const s = await seed();
    const p = await posting(s, input(), null);
    const c = candidate(p, s.claims[0]!);
    const unaccepted = await body(s, c);
    await reviewPosting(s, p.id);
    expect((await submit(s, unaccepted)).statusCode).toBe(409);
    const fresh = await body(s, c);
    expect((await submit(s, { ...fresh, claimId: s.claims[1]!.id })).statusCode).toBe(409);
    expect(
      (await submit(s, { ...fresh, claimSourceLineId: s.claims[0]!.sourceDetails!.lines[1]!.id }))
        .statusCode,
    ).toBe(409);
    expect(
      (await submit(s, { ...fresh, sourceEntryId: p.payload.entries[1]!.sourceEntryId }))
        .statusCode,
    ).toBe(409);
    await changeClaim(s);
    expect((await submit(s, fresh)).statusCode).toBe(409);
    await link(s, c);
  });

  it('returns exact immutable link and release receipts after revisions, claim edits and relinking', async () => {
    const s = await seed();
    const p = await posting(s);
    const command = await body(s, candidate(p, s.claims[0]!));
    const first = await submit(s, command);
    expect(first.statusCode).toBe(201);
    const saved = RelationshipReceiptSchema.parse(first.json());
    const newer = await posting(s, revision(p.payload));
    await changeClaim(s);
    const releasing = await releaseBody(s, saved.id);
    const released = await submitRelease(s, saved.id, releasing);
    expect(released.statusCode).toBe(201);
    const receipt = RelationshipReleaseReceiptSchema.parse(released.json());
    await link(s, candidate(newer, s.claims[0]!));
    const replay = await submit(s, command);
    expect(replay.statusCode).toBe(200);
    expect(RelationshipReceiptSchema.parse(replay.json())).toEqual(saved);
    const releaseReplay = await submitRelease(s, saved.id, releasing);
    expect(releaseReplay.statusCode).toBe(200);
    expect(RelationshipReleaseReceiptSchema.parse(releaseReplay.json())).toEqual(receipt);
  });

  it('deduplicates exact concurrent commands and binds replay to actor, target and reason', async () => {
    const s = await seed();
    const other = await seed('ADMIN', s.organizationId);
    const p = await posting(s);
    const command = await body(s, candidate(p, s.claims[0]!));
    const linked = await Promise.all([submit(s, command), submit(s, command)]);
    expect(linked.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    const saved = RelationshipReceiptSchema.parse(linked[0].json());
    expect(RelationshipReceiptSchema.parse(linked[1].json())).toEqual(saved);
    expect((await submit(other, command)).statusCode).toBe(409);
    expect((await submit(s, { ...command, claimSourceLineId: null })).statusCode).toBe(409);
    const releasing = await releaseBody(s, saved.id);
    const released = await Promise.all([
      submitRelease(s, saved.id, releasing),
      submitRelease(s, saved.id, releasing),
    ]);
    expect(released.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(RelationshipReleaseReceiptSchema.parse(released[0].json())).toEqual(
      RelationshipReleaseReceiptSchema.parse(released[1].json()),
    );
    expect((await submitRelease(other, saved.id, releasing)).statusCode).toBe(409);
    expect(
      (await submitRelease(s, saved.id, { ...releasing, reason: 'WRONG_LINK' })).statusCode,
    ).toBe(409);
  });

  it('serializes competing fresh approvals for the same source identity', async () => {
    const s = await seed();
    const p = await posting(s);
    const c = candidate(p, s.claims[0]!);
    const commands = [await body(s, c), await body(s, c)];
    const results = await Promise.all(commands.map((command) => submit(s, command)));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect((await list(s)).items).toHaveLength(1);
    expect((await preview(s, c)).blockers).toContain('ENTRY_ALREADY_LINKED');
  });

  it('serializes approval racing a claim edit without leaving an incorrectly current relationship', async () => {
    const s = await seed();
    const p = await posting(s);
    const command = await body(s, candidate(p, s.claims[0]!));
    const [result] = await Promise.all([submit(s, command), changeClaim(s)]);
    expect([201, 409]).toContain(result.statusCode);
    const rows = (await list(s)).items;
    if (result.statusCode === 201)
      expect(rows[0]).toMatchObject({
        status: 'STALE',
        blockers: expect.arrayContaining(['CLAIM_CHANGED']),
      });
    else expect(rows).toEqual([]);
  });

  it('serializes approval racing a newer source observation and retains any committed reservation', async () => {
    const s = await seed();
    const p = await posting(s);
    const command = await body(s, candidate(p, s.claims[0]!));
    const [result, newer] = await Promise.all([
      submit(s, command),
      posting(s, revision(p.payload), null),
    ]);
    expect([201, 409]).toContain(result.statusCode);
    const rows = (await list(s)).items;
    if (result.statusCode === 201) {
      expect(rows[0]).toMatchObject({
        status: 'STALE',
        blockers: expect.arrayContaining(['SOURCE_NOT_CURRENT']),
        release: null,
      });
      await reviewPosting(s, newer.id);
      expect((await preview(s, candidate(newer, s.claims[0]!))).blockers).toContain(
        'ENTRY_ALREADY_LINKED',
      );
    } else expect(rows).toEqual([]);
  });

  it('isolates identical source identities, direct targets, receipts and releases across practices', async () => {
    const a = await seed();
    const b = await seed();
    const payload = input();
    const ap = await posting(a, payload);
    const bp = await posting(b, payload);
    const al = await link(a, candidate(ap, a.claims[0]!));
    const bl = await link(b, candidate(bp, b.claims[0]!));
    expect((await list(a)).items.map((row) => row.id)).toEqual([al.id]);
    expect((await list(b)).items.map((row) => row.id)).toEqual([bl.id]);
    for (const c of [candidate(ap, b.claims[0]!), candidate(bp, a.claims[0]!)])
      expect(
        (await inject({ method: 'POST', url: `${BASE}/preview`, headers: b.headers, payload: c }))
          .statusCode,
      ).toBe(404);
    expect(
      (
        await inject({
          method: 'GET',
          url: `/v1/posting-evidence/${ap.id}/relationship-targets`,
          headers: b.headers,
        })
      ).statusCode,
    ).toBe(404);
    expect((await submitRelease(b, al.id, await releaseBody(a, al.id))).statusCode).toBe(404);
  });

  it.each(['posting.relationship.create', 'posting.relationship.release'] as const)(
    'rolls back identity reservation changes if%s audit fails',
    async (action) => {
      const s = await seed();
      const p = await posting(s);
      const c = candidate(p, s.claims[0]!);
      const saved = action === 'posting.relationship.release' ? await link(s, c) : null;
      const command = await body(s, c);
      const releasing = saved ? await releaseBody(s, saved.id) : null;
      const before = await snapshot(s);
      await failAudit(action);
      const result =
        saved && releasing ? await submitRelease(s, saved.id, releasing) : await submit(s, command);
      expect(result.statusCode, result.body).toBe(500);
      expect(result.body).not.toContain(PRIVATE_MARKER);
      await removeAuditFailure();
      expect(await snapshot(s)).toEqual(before);
      expect((await list(s)).items).toHaveLength(saved ? 1 : 0);
      expect((await preview(s, c)).blockers.includes('ENTRY_ALREADY_LINKED')).toBe(Boolean(saved));
      expect(logs.join('')).not.toContain(PRIVATE_MARKER);
    },
  );

  it('withholds target suggestions, list, previews and exact replays if read audit fails', async () => {
    const s = await seed();
    const p = await posting(s);
    const c = candidate(p, s.claims[0]!);
    const command = await body(s, c);
    const first = await submit(s, command);
    expect(first.statusCode).toBe(201);
    const saved = RelationshipReceiptSchema.parse(first.json());
    const releasing = await releaseBody(s, saved.id);
    expect((await submitRelease(s, saved.id, releasing)).statusCode).toBe(201);
    await failAudit('posting.relationship.read');
    const results = await Promise.all([
      inject({
        method: 'GET',
        url: `/v1/posting-evidence/${p.id}/relationship-targets`,
        headers: s.headers,
      }),
      inject({ method: 'GET', url: BASE, headers: s.headers }),
      inject({ method: 'POST', url: `${BASE}/preview`, headers: s.headers, payload: c }),
      inject({
        method: 'POST',
        url: `${BASE}/${saved.id}/release/preview`,
        headers: s.headers,
        payload: { reason: 'SOURCE_CHANGED' },
      }),
      submit(s, command),
      submitRelease(s, saved.id, releasing),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([500, 500, 500, 500, 500, 500]);
    for (const result of results) {
      expect(result.body).not.toContain(PRIVATE_MARKER);
      expect(result.body).not.toContain(s.claims[0]!.claimNumber);
    }
    expect(logs.join('')).not.toContain(PRIVATE_MARKER);
  });

  it('pages retained links and releases with receipt-scoped cursors and bounded responses', async () => {
    const s = await seed();
    const base = input();
    const p = await posting(
      s,
      input({
        entries: Array.from({ length: 12 }, (_, index) => ({
          ...base.entries[0]!,
          sourceEntryId: `page-entry-${String(index)}`,
        })),
      }),
    );
    const ids: string[] = [];
    for (let index = 0; index < 12; index += 1)
      ids.push((await link(s, candidate(p, s.claims[0]!, index))).id);
    await release(s, ids[0]!);
    const first = await list(s, `?receiptId=${p.receiptId}`);
    expect(first.items).toHaveLength(10);
    expect(first.hasMore).toBe(true);
    const second = await list(
      s,
      `?receiptId=${p.receiptId}&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(second.items).toHaveLength(2);
    expect(second.hasMore).toBe(false);
    expect([...first.items, ...second.items].map((row) => row.id)).toEqual([...ids].reverse());
    expect(second.items.find((row) => row.id === ids[0])?.status).toBe('RELEASED');
    const otherPosting = await posting(s);
    expect((await list(s, `?receiptId=${otherPosting.receiptId}`)).items).toEqual([]);
    expect(
      (
        await inject({
          method: 'GET',
          url: `${BASE}?receiptId=${otherPosting.receiptId}&cursor=${encodeURIComponent(first.nextCursor!)}`,
          headers: s.headers,
        })
      ).statusCode,
    ).toBe(400);
    const foreign = await seed();
    expect(
      (
        await inject({
          method: 'GET',
          url: `${BASE}?receiptId=${p.receiptId}&cursor=${encodeURIComponent(first.nextCursor!)}`,
          headers: foreign.headers,
        })
      ).statusCode,
    ).toBe(400);
  });

  it.each([
    '?limit=0',
    '?limit=21',
    '?limit=1.5',
    '?cursor=malformed',
    '?receiptId=bad-id',
    '?unknown=private',
  ])('rejects invalid list bounds%s', async (suffix) => {
    const s = await seed();
    expect(
      (await inject({ method: 'GET', url: `${BASE}${suffix}`, headers: s.headers })).statusCode,
    ).toBe(400);
  });

  it('rejects caller authority, malformed identities, unsupported reasons and oversized commands with closed errors', async () => {
    const s = await seed();
    const p = await posting(s);
    const c = candidate(p, s.claims[0]!);
    for (const payload of [
      { ...c, organizationId: s.organizationId },
      { ...c, reviewedByRole: 'OWNER' },
      { ...c, claimSourceLineId: PRIVATE_MARKER },
      { ...c, sourceEntryId: '' },
      { ...c, sourceEntryId: 'a'.repeat(201) },
      { ...c, evidenceId: PRIVATE_MARKER },
      { ...c, amount: '100.00' },
      { ...c, bankVerification: 'VERIFIED' },
    ]) {
      const result = await inject({
        method: 'POST',
        url: `${BASE}/preview`,
        headers: s.headers,
        payload,
      });
      expect(result.statusCode, result.body).toBe(400);
      expect(result.body).not.toContain(PRIVATE_MARKER);
    }
    const saved = await link(s, c);
    const releasing = await releaseBody(s, saved.id);
    for (const payload of [
      { ...releasing, reason: PRIVATE_MARKER },
      { ...releasing, claimId: c.claimId },
      { ...releasing, releasedAmount: '1.00' },
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
    const oversized = await inject({
      method: 'POST',
      url: BASE,
      headers: { ...s.headers, 'content-type': 'application/json' },
      payload: `${JSON.stringify(await body(s, c))}${' '.repeat(1024 * 1024 + 1)}`,
    });
    expect(oversized.statusCode).toBe(413);
    expect(logs.join('')).not.toContain(PRIVATE_MARKER);
  });
});

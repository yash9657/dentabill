/* eslint-disable security/detect-non-literal-fs-filename -- Only checked-in synthetic fixtures resolved relative to this test. */
import { readFileSync } from 'node:fs';

import { prisma } from '@dentabill/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { bulkInsertClaims, type BulkInsertOptions } from './insert.js';
import { parseClaimsCSV } from './parser.js';
import type { CanonicalClaimRow } from './types.js';

const fixture = readFileSync(
  new URL('../../../test/fixtures/csv/opendental-source-details-synthetic.csv', import.meta.url),
);
function row(): CanonicalClaimRow {
  const parsed = parseClaimsCSV(fixture);
  const first = parsed.rows[0];
  if (!first || parsed.errors.length) throw new Error('Invalid synthetic source detail fixture');
  return first;
}
async function options(
  canonicalRows: readonly CanonicalClaimRow[] = [row()],
): Promise<BulkInsertOptions> {
  const organization = await prisma.organization.create({
    data: { name: 'Synthetic details', clerkOrgId: crypto.randomUUID() },
  });
  return {
    organizationId: organization.id,
    source: 'OPEN_DENTAL',
    sourceNamespace: 'synthetic-main',
    dobHashSecret: 'synthetic-import-hash-secret',
    canonicalRows,
  };
}
async function snapshot(organizationId: string) {
  return prisma.claimSourceDetails.findMany({
    where: { organizationId },
    include: {
      lines: { orderBy: { position: 'asc' } },
      coverages: { orderBy: { sequence: 'asc' } },
    },
  });
}

describe('source details atomic import (real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS import_details_test_fail ON "ClaimSourceLine"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS import_details_test_fail()');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" CASCADE');
  });

  it('persists synthetic source facts and stable line identities without manufacturing parent subscriber identity', async () => {
    const opts = await options();
    const result = await bulkInsertClaims(opts);
    expect(result.insertedRows).toBe(1);
    const saved = (await snapshot(opts.organizationId))[0];
    expect(saved).toMatchObject({ lineCount: 2, coverageCount: 2, schemaVersion: 1 });
    expect(saved?.importedClaimAmount.toFixed(2)).toBe('100.00');
    expect(
      saved?.lines.map((line) => [
        line.sourceLineId,
        line.procedureCode,
        line.tooth,
        line.billedAmount.toFixed(2),
        line.quantity?.toString() ?? null,
      ]),
    ).toEqual([
      ['proc-line-01', 'D1110', 'A', '40.00', '3'],
      ['proc-line-02', 'D1110', 'AS', '60.00', null],
    ]);
    expect(saved?.coverages).toMatchObject([
      {
        sequence: 1,
        isClaimCoverage: false,
        subscriberId: 'member-primary',
        patientMemberId: 'dependent-primary',
        sourceSubscriptionId: 'subscription-primary',
      },
      { sequence: 2, isClaimCoverage: true, subscriberId: null, payerIdentifier: 'SYNTH-002' },
    ]);
    const claim = await prisma.claim.findFirstOrThrow({
      where: { organizationId: opts.organizationId },
    });
    expect(claim.subscriberId).toBeNull();
    expect(claim.status).toBe('PENDING');
    expect(saved?.claimId).toBe(claim.id);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: opts.organizationId },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain('member-primary');
    expect(JSON.stringify(audit.metadata)).not.toContain('proc-line-01');
  });

  it('serializes concurrent imports without duplicating children or changing their stable IDs', async () => {
    const opts = await options();
    const results = await Promise.all(Array.from({ length: 5 }, () => bulkInsertClaims(opts)));
    expect(results.reduce((sum, result) => sum + result.insertedRows, 0)).toBe(1);
    const before = await snapshot(opts.organizationId);
    expect(before).toHaveLength(1);
    expect(before[0]?.lines).toHaveLength(2);
    expect(before[0]?.coverages).toHaveLength(2);
    expect((await bulkInsertClaims(opts)).skippedDuplicates).toBe(1);
    expect(await snapshot(opts.organizationId)).toEqual(before);
  });

  it('reports changed procedure facts while preserving the reviewed workflow and original snapshot', async () => {
    const opts = await options();
    await bulkInsertClaims(opts);
    const before = await snapshot(opts.organizationId);
    const claimId = before[0]?.claimId;
    if (!claimId) throw new Error('Missing synthetic claim');
    await prisma.claim.update({
      where: { id: claimId, organizationId: opts.organizationId },
      data: { status: 'APPEALING', claimAmount: '120.00' },
    });
    const first = row();
    if (!first.sourceDetails) throw new Error('Missing synthetic details');
    const changed: CanonicalClaimRow = {
      ...first,
      sourceDetails: {
        ...first.sourceDetails,
        lines: first.sourceDetails.lines.map((line, i) =>
          i === 0 ? { ...line, tooth: 'B' } : line,
        ),
      },
    };
    expect(
      (await bulkInsertClaims({ ...opts, canonicalRows: [changed] })).rows[0]?.disposition,
    ).toBe('SOURCE_CHANGED');
    expect((await bulkInsertClaims(opts)).rows[0]?.disposition).toBe('DUPLICATE');
    expect(await snapshot(opts.organizationId)).toEqual(before);
    const claim = await prisma.claim.findFirstOrThrow({
      where: { organizationId: opts.organizationId, id: claimId },
    });
    expect(claim.status).toBe('APPEALING');
    expect(claim.claimAmount.toFixed(2)).toBe('120.00');
  });

  it('requires reconciliation for formerly unmodeled JSON cells instead of silently calling them enriched', async () => {
    const original = row();
    const opts = await options([{ ...original, sourceDetails: null }]);
    await bulkInsertClaims(opts);
    expect(
      (await bulkInsertClaims({ ...opts, canonicalRows: [original] })).rows[0]?.disposition,
    ).toBe('SOURCE_CHANGED');
    expect(await snapshot(opts.organizationId)).toEqual([]);
  });

  it('allows source child IDs to repeat in distinct claims and tenants', async () => {
    const one = row();
    const first = await options([one, { ...one, sourceClaimId: 'different', rowIndex: 3 }]);
    const second = await options([one]);
    expect((await bulkInsertClaims(first)).insertedRows).toBe(2);
    expect((await bulkInsertClaims(second)).insertedRows).toBe(1);
    expect(await snapshot(first.organizationId)).toHaveLength(2);
    expect(await snapshot(second.organizationId)).toHaveLength(1);
  });

  it('rolls back parent, earlier child chunks and audit on a late child failure, then safely retries', async () => {
    const original = row();
    const firstLine = original.sourceDetails?.lines[0];
    if (!firstLine) throw new Error('Missing synthetic line');
    const data = ['a', 'b'].map(
      (prefix, index): CanonicalClaimRow => ({
        ...original,
        sourceClaimId: prefix,
        rowIndex: index + 2,
        claimAmount: '300.00',
        sourceDetails: {
          schemaVersion: 1,
          coverages: [],
          lines: Array.from({ length: 300 }, (_, i) => ({
            ...firstLine,
            sourceLineId: `${prefix}-${String(i)}`,
            billedAmount: '1.00',
          })),
        },
      }),
    );
    const opts = await options(data);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION import_details_test_fail() RETURNS trigger AS $$ BEGIN IF NEW."sourceLineId" = 'b-299' THEN RAISE EXCEPTION 'synthetic child failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER import_details_test_fail BEFORE INSERT ON "ClaimSourceLine" FOR EACH ROW EXECUTE FUNCTION import_details_test_fail()',
    );
    await expect(bulkInsertClaims(opts)).rejects.toThrow();
    expect(await prisma.claim.count({ where: { organizationId: opts.organizationId } })).toBe(0);
    expect(await snapshot(opts.organizationId)).toEqual([]);
    expect(await prisma.auditLog.count({ where: { organizationId: opts.organizationId } })).toBe(0);
    await prisma.$executeRawUnsafe('DROP TRIGGER import_details_test_fail ON "ClaimSourceLine"');
    expect((await bulkInsertClaims(opts)).insertedRows).toBe(2);
    expect(
      await prisma.claimSourceLine.count({ where: { organizationId: opts.organizationId } }),
    ).toBe(600);
  });
});

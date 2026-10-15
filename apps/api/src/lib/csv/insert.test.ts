import { prisma } from '@dentabill/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { bulkInsertClaims, type BulkInsertOptions } from './insert.js';
import { parseClaimsCSV } from './parser.js';
import type { CanonicalClaimRow } from './types.js';

const CSV = `PatNum,Birthdate,InsCarrier,ClaimIdent,ProcCodes,ClaimFee,ProcDate,DateSent,ClaimNum,SecDateTEdit,SubscriberId
1001,1990-05-12,Delta Dental PPO,DISPLAY-1,D2740,1240.00,2026-01-08,2026-01-09,001,revision-1,subscriber-1
`;
const baseRow = (): CanonicalClaimRow => {
  const row = parseClaimsCSV(Buffer.from(CSV)).rows[0];
  if (!row) throw new Error('Invalid synthetic fixture.');
  return row;
};
async function makeOptions(): Promise<BulkInsertOptions> {
  const org = await prisma.organization.create({
    data: { name: 'Synthetic import', clerkOrgId: crypto.randomUUID() },
  });
  return {
    organizationId: org.id,
    source: 'OPEN_DENTAL',
    sourceNamespace: 'practice-main',
    dobHashSecret: 'synthetic-import-hash-secret',
    canonicalRows: [baseRow()],
  };
}
function rows(opts: BulkInsertOptions, canonicalRows: CanonicalClaimRow[]): BulkInsertOptions {
  return { ...opts, canonicalRows };
}
async function stored(
  opts: BulkInsertOptions,
): Promise<Awaited<ReturnType<typeof prisma.claim.findMany>>> {
  return prisma.claim.findMany({ where: { organizationId: opts.organizationId } });
}

describe('source-scoped import (real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS import_test_fail ON "Claim"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS import_test_fail()');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" CASCADE');
  });

  it('collapses equal rows in one file and preserves every row result', async () => {
    const opts = await makeOptions();
    const result = await bulkInsertClaims(rows(opts, [baseRow(), { ...baseRow(), rowIndex: 3 }]));
    expect(result).toMatchObject({ insertedRows: 1, skippedDuplicates: 1, conflictRows: 0 });
    expect(result.rows.map((r) => [r.rowIndex, r.disposition])).toEqual([
      [2, 'INSERTED'],
      [3, 'DUPLICATE'],
    ]);
    expect(new Set(result.rows.map((r) => r.claimId)).size).toBe(1);
    expect(await stored(opts)).toHaveLength(1);
  });

  it('reports all conflicting same-file identities without accepting the first version', async () => {
    const opts = await makeOptions();
    const result = await bulkInsertClaims(
      rows(opts, [
        baseRow(),
        { ...baseRow(), rowIndex: 3, claimAmount: '100.00' },
        { ...baseRow(), rowIndex: 4, sourceClaimId: 'other' },
      ]),
    );
    expect(result).toMatchObject({ insertedRows: 1, skippedDuplicates: 0, conflictRows: 2 });
    expect(result.rows.map((r) => r.disposition)).toEqual([
      'BATCH_CONFLICT',
      'BATCH_CONFLICT',
      'INSERTED',
    ]);
    expect((await stored(opts)).map((r) => r.sourceClaimId)).toEqual(['other']);
  });

  it('serializes simultaneous reuploads and returns the same persisted claim to all callers', async () => {
    const opts = await makeOptions();
    const result = await Promise.all(Array.from({ length: 6 }, () => bulkInsertClaims(opts)));
    expect(result.reduce((n, r) => n + r.insertedRows, 0)).toBe(1);
    expect(result.reduce((n, r) => n + r.skippedDuplicates, 0)).toBe(5);
    expect(new Set(result.flatMap((r) => r.rows.map((row) => row.claimId))).size).toBe(1);
    expect(await stored(opts)).toHaveLength(1);
  });

  it('concurrent conflicting uploads retain exactly one version and report the loser', async () => {
    const opts = await makeOptions();
    const result = await Promise.all([
      bulkInsertClaims(opts),
      bulkInsertClaims(rows(opts, [{ ...baseRow(), claimAmount: '100.00' }])),
    ]);
    expect(result.flatMap((r) => r.rows.map((row) => row.disposition)).sort()).toEqual([
      'INSERTED',
      'SOURCE_CHANGED',
    ]);
    expect(await stored(opts)).toHaveLength(1);
  });

  it('does not deduplicate distinct source IDs by display number, payer, or DOB', async () => {
    const opts = await makeOptions();
    const result = await bulkInsertClaims(
      rows(opts, [baseRow(), { ...baseRow(), rowIndex: 3, sourceClaimId: '002' }]),
    );
    expect(result.insertedRows).toBe(2);
    expect(await stored(opts)).toHaveLength(2);
  });

  it('scopes identity by tenant, source system, and database', async () => {
    const opts = await makeOptions();
    const other = await makeOptions();
    for (const input of [
      opts,
      { ...opts, source: 'DENTRIX' as const },
      { ...opts, sourceNamespace: 'practice-second' },
      other,
    ]) {
      expect((await bulkInsertClaims(input)).insertedRows).toBe(1);
    }
    expect(await stored(opts)).toHaveLength(3);
    const foreign = await stored(other);
    expect(foreign).toHaveLength(1);
    expect(foreign[0]?.patientDOBHash).not.toBe((await stored(opts))[0]?.patientDOBHash);
  });

  it('retains reviewed workflow and local edits on exact source replay', async () => {
    const opts = await makeOptions();
    const first = await bulkInsertClaims(opts);
    const claimId = first.rows[0]?.claimId;
    if (!claimId) throw new Error('Missing test claim');
    await prisma.claim.update({
      where: { organizationId: opts.organizationId, id: claimId },
      data: { status: 'APPEALING', subscriberId: 'reviewed-value', retryCount: 2 },
    });
    const before = await stored(opts);
    expect((await bulkInsertClaims(opts)).rows[0]?.disposition).toBe('DUPLICATE');
    expect(await stored(opts)).toEqual(before);
  });

  it.each([
    { claimAmount: '100.00' },
    { sourceVersion: 'revision-2' },
    { sourcePatientId: '1002' },
    { patientDOB: '1990-05-13' },
    { subscriberId: 'changed' },
    { claimNumber: 'renumbered' },
    { payerLabel: 'Unmapped payer' },
    { cdtCodes: ['D1110'] },
    { submittedDate: null },
  ])('reports a changed source payload without any overwrite (%j)', async (change) => {
    const opts = await makeOptions();
    await bulkInsertClaims(opts);
    const before = await stored(opts);
    expect(
      (await bulkInsertClaims(rows(opts, [{ ...baseRow(), ...change }]))).rows[0]?.disposition,
    ).toBe('SOURCE_CHANGED');
    expect(await stored(opts)).toEqual(before);
  });

  it('detects changes to exported cells outside the current domain projection', async () => {
    const opts = await makeOptions();
    const original = {
      ...baseRow(),
      sourceFields: [...baseRow().sourceFields, ['status', 'Submitted'] as const],
    };
    await bulkInsertClaims(rows(opts, [original]));
    const changed = {
      ...original,
      sourceFields: original.sourceFields.map(([key, value]): readonly [string, string] => [
        key,
        key === 'status' ? 'Paid' : value,
      ]),
    };
    expect((await bulkInsertClaims(rows(opts, [changed]))).rows[0]?.disposition).toBe(
      'SOURCE_CHANGED',
    );
    expect((await stored(opts))[0]?.status).toBe('PENDING');
  });

  it('reports missing source identity without inventing it from other fields', async () => {
    const opts = await makeOptions();
    const result = await bulkInsertClaims(rows(opts, [{ ...baseRow(), sourceClaimId: null }]));
    expect(result).toMatchObject({
      insertedRows: 0,
      conflictRows: 1,
      rows: [{ disposition: 'MISSING_SOURCE_ID', claimId: null }],
    });
    expect(await stored(opts)).toHaveLength(0);
  });

  it.each([1, 2])(
    'leaves %i legacy candidate(s) untouched and never guesses a source binding',
    async (count) => {
      const opts = await makeOptions();
      for (let i = 0; i < count; i++)
        await prisma.claim.create({
          data: {
            organizationId: opts.organizationId,
            patientDOBHash: 'legacy',
            claimNumber: 'DISPLAY-1',
            claimAmount: '10.00',
            cdtCodes: ['D1110'],
            payerCode: 'UNKNOWN',
            serviceDate: new Date('2026-01-01'),
            status: 'APPEALING',
          },
        });
      const before = await stored(opts);
      const result = await bulkInsertClaims(opts);
      expect(result).toMatchObject({
        insertedRows: 0,
        conflictRows: 1,
        rows: [{ disposition: 'LEGACY_MATCH', claimId: count === 1 ? before[0]?.id : null }],
      });
      expect(await stored(opts)).toEqual(before);
    },
  );

  it('does not disclose or match another tenant’s legacy candidates', async () => {
    const opts = await makeOptions();
    const foreign = await makeOptions();
    await prisma.claim.create({
      data: {
        organizationId: foreign.organizationId,
        patientDOBHash: 'foreign',
        claimNumber: 'DISPLAY-1',
        claimAmount: '10.00',
        cdtCodes: [],
        payerCode: 'UNKNOWN',
        serviceDate: new Date(),
      },
    });
    expect((await bulkInsertClaims(opts)).insertedRows).toBe(1);
  });

  it('rolls back all chunks on a late database failure and permits a complete retry', async () => {
    const opts = await makeOptions();
    const input = rows(
      opts,
      Array.from({ length: 501 }, (_, i) => ({
        ...baseRow(),
        rowIndex: i + 2,
        sourceClaimId: `fault-${String(i)}`,
      })),
    );
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION import_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."sourceClaimId" = 'fault-500' THEN RAISE EXCEPTION 'synthetic late chunk failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER import_test_fail BEFORE INSERT ON "Claim" FOR EACH ROW EXECUTE FUNCTION import_test_fail()',
    );
    await expect(bulkInsertClaims(input)).rejects.toThrow();
    expect(await stored(opts)).toHaveLength(0);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: opts.organizationId, action: 'claim.import' },
      }),
    ).toBe(0);
    await prisma.$executeRawUnsafe('DROP TRIGGER import_test_fail ON "Claim"');
    expect((await bulkInsertClaims(input)).insertedRows).toBe(501);
    expect(await stored(opts)).toHaveLength(501);
  });

  it('database enforces unique complete identity and immutable imported provenance outside the importer', async () => {
    const opts = await makeOptions();
    await bulkInsertClaims(opts);
    const claim = (await stored(opts))[0];
    if (!claim) throw new Error('Missing test claim');
    const { id: _id, ...data } = claim;
    await expect(prisma.claim.create({ data })).rejects.toThrow();
    await expect(
      prisma.claim.create({ data: { ...data, sourceClaimId: 'new', sourceNamespace: null } }),
    ).rejects.toThrow();
    await expect(
      prisma.claim.update({
        where: { organizationId: opts.organizationId, id: claim.id },
        data: { sourceClaimId: 'rewritten' },
      }),
    ).rejects.toThrow();
    expect(await stored(opts)).toEqual([claim]);
  });

  it('audit stores only closed counts and source system, not imported PHI or user source label', async () => {
    const opts = await makeOptions();
    await bulkInsertClaims(opts);
    const log = await prisma.auditLog.findFirst({
      where: { organizationId: opts.organizationId, action: 'claim.import' },
    });
    expect(log?.metadata).toEqual({
      source: 'OPEN_DENTAL',
      totalRows: 1,
      insertedRows: 1,
      skippedDuplicates: 0,
      conflictRows: 0,
    });
  });
});

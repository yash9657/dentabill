import { randomUUID } from 'node:crypto';

import type { Claim, Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { prisma } from '../client.js';

import { MissingOrgScopeError } from './errors.js';
import { getOrgScopedDb } from './with-org.js';

type Line = Omit<Prisma.ClaimSourceLineCreateManyInput, 'claimId' | 'organizationId'>;
type Coverage = Omit<Prisma.ClaimSourceCoverageCreateManyInput, 'claimId' | 'organizationId'>;

function line(position = 0, billedAmount = '100.00', overrides: Partial<Line> = {}): Line {
  return {
    sourceLineId: `000-line-${String(position)}`,
    position,
    procedureCode: 'D2740',
    serviceDate: new Date('2026-01-01'),
    billedAmount,
    ...overrides,
  };
}

function coverage(
  sequence = 1,
  isClaimCoverage = true,
  overrides: Partial<Coverage> = {},
): Coverage {
  return {
    sourceCoverageId: `000-coverage-${String(sequence)}`,
    sequence,
    payerName: 'Synthetic payer',
    isClaimCoverage,
    ...overrides,
  };
}

async function claim(imported = true): Promise<Claim> {
  const org = await prisma.organization.create({
    data: { name: 'Synthetic source snapshot', clerkOrgId: `synthetic_${randomUUID()}` },
  });
  return prisma.claim.create({
    data: {
      organizationId: org.id,
      patientDOBHash: 'synthetic-only',
      claimNumber: 'SYNTHETIC-DISPLAY',
      claimAmount: '100.00',
      payerCode: 'UNKNOWN',
      cdtCodes: ['D2740'],
      serviceDate: new Date('2026-01-01'),
      ...(imported
        ? {
            sourceSystem: 'OPEN_DENTAL',
            sourceNamespace: 'synthetic',
            sourceClaimId: '0001',
            sourceContentHash: 'a'.repeat(64),
          }
        : {}),
    },
  });
}

async function admit(
  parent: Claim,
  lines: readonly Line[] = [line()],
  coverages: readonly Coverage[] = [coverage()],
  overrides: Partial<Prisma.ClaimSourceDetailsUncheckedCreateInput> = {},
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.claimSourceDetails.create({
      data: {
        claimId: parent.id,
        organizationId: parent.organizationId,
        importedClaimAmount: parent.claimAmount,
        lineCount: lines.length,
        coverageCount: coverages.length,
        ...overrides,
      },
    });
    if (lines.length)
      await tx.claimSourceLine.createMany({
        data: lines.map((item) => ({
          ...item,
          claimId: parent.id,
          organizationId: parent.organizationId,
        })),
      });
    if (coverages.length)
      await tx.claimSourceCoverage.createMany({
        data: coverages.map((item) => ({
          ...item,
          claimId: parent.id,
          organizationId: parent.organizationId,
        })),
      });
  });
}

async function absent(parent: Claim): Promise<void> {
  const where = { claimId: parent.id, organizationId: parent.organizationId };
  expect(await prisma.claimSourceDetails.count({ where })).toBe(0);
  expect(await prisma.claimSourceLine.count({ where })).toBe(0);
  expect(await prisma.claimSourceCoverage.count({ where })).toBe(0);
}

describe('immutable imported claim source details', () => {
  it('keeps repeated procedure codes, ordered lines, opaque anatomy, and noncontiguous coverage sequences', async () => {
    const parent = await claim();
    await admit(
      parent,
      [
        line(0, '40.00', {
          sourceProcedureId: '0000-Ab',
          codeVersion: '2026',
          quantity: '2.500',
          treatmentArea: 'Source Area',
          tooth: 'A',
          surface: 'MO',
          quadrant: 'source-q',
          toothRange: 'A-C',
          toothNumberingSystem: 'source-system',
        }),
        line(1, '60.00'),
      ],
      [
        coverage(1, false),
        coverage(3, true, {
          payerIdentifier: '000-PAYER',
          payerIdentifierSystem: 'source-id',
          sourcePlanId: '000-plan',
          sourceSubscriptionId: '000-sub',
          subscriberId: 'synthetic-subscriber',
          patientMemberId: 'synthetic-member',
          groupNumber: '000-group',
          relationship: 'source-relationship',
          effectiveDate: new Date('2026-01-01'),
          terminationDate: new Date('2026-12-31'),
        }),
      ],
    );
    const stored = await prisma.claimSourceDetails.findFirstOrThrow({
      where: { claimId: parent.id, organizationId: parent.organizationId },
      include: {
        lines: { orderBy: { position: 'asc' } },
        coverages: { orderBy: { sequence: 'asc' } },
      },
    });
    expect(stored.schemaVersion).toBe(1);
    expect(stored.importedClaimAmount.toFixed(2)).toBe('100.00');
    expect(stored.lines.map((item) => item.procedureCode)).toEqual(['D2740', 'D2740']);
    expect(stored.lines.map((item) => item.position)).toEqual([0, 1]);
    expect(stored.lines[0]?.quantity?.toFixed(3)).toBe('2.500');
    expect(stored.lines[0]).toMatchObject({
      tooth: 'A',
      surface: 'MO',
      toothRange: 'A-C',
      sourceProcedureId: '0000-Ab',
    });
    expect(stored.lines[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    expect(stored.coverages.map((item) => item.sequence)).toEqual([1, 3]);
    expect(stored.coverages[1]).toMatchObject({
      isClaimCoverage: true,
      subscriberId: 'synthetic-subscriber',
      patientMemberId: 'synthetic-member',
    });
  });

  it('admits either lines-only or coverages-only snapshots', async () => {
    const linesOnly = await claim();
    const coveragesOnly = await claim();
    await admit(linesOnly, [line()], []);
    await admit(coveragesOnly, [], [coverage(9)]);
    expect(
      await prisma.claimSourceDetails.count({
        where: { organizationId: linesOnly.organizationId },
      }),
    ).toBe(1);
    expect(
      await prisma.claimSourceDetails.count({
        where: { organizationId: coveragesOnly.organizationId },
      }),
    ).toBe(1);
  });

  it('rejects legacy/no-source parents and mismatched imported parent amounts', async () => {
    const legacy = await claim(false);
    await expect(admit(legacy)).rejects.toThrow();
    await absent(legacy);
    const imported = await claim();
    await expect(
      admit(imported, [line(0, '99.00')], [], { importedClaimAmount: '99.00' }),
    ).rejects.toThrow();
    await absent(imported);
  });

  it('enforces compound tenant references for details and both child kinds', async () => {
    const parent = await claim();
    const other = await claim();
    await expect(
      admit(parent, [], [], { organizationId: other.organizationId, lineCount: 1 }),
    ).rejects.toThrow();
    await admit(parent);
    await expect(
      prisma.claimSourceLine.create({
        data: {
          ...line(),
          claimId: parent.id,
          organizationId: other.organizationId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.claimSourceCoverage.create({
        data: {
          ...coverage(),
          claimId: parent.id,
          organizationId: other.organizationId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await absent(other);
  });

  it.each([
    ['missing line', [line()], [coverage()], { lineCount: 2 }],
    ['missing coverage', [line()], [coverage()], { coverageCount: 2 }],
    ['wrong billed total', [line(0, '99.99')], [], {}],
    ['missing first position', [line(1)], [], {}],
    ['no target coverage', [], [coverage(1, false)], {}],
    ['two target coverages', [], [coverage(1), coverage(2)], {}],
  ] satisfies readonly [
    string,
    Line[],
    Coverage[],
    Partial<Prisma.ClaimSourceDetailsUncheckedCreateInput>,
  ][])('rolls back the complete snapshot for %s', async (_label, lines, coverages, overrides) => {
    const parent = await claim();
    await expect(admit(parent, lines, coverages, overrides)).rejects.toThrow();
    await absent(parent);
  });

  it('defers completeness until transaction commit and rejects a parent admitted without children', async () => {
    const parent = await claim();
    let insertReturned = false;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.claimSourceDetails.create({
          data: {
            claimId: parent.id,
            organizationId: parent.organizationId,
            importedClaimAmount: '100.00',
            lineCount: 1,
            coverageCount: 0,
          },
        });
        insertReturned = true;
      }),
    ).rejects.toThrow();
    expect(insertReturned).toBe(true);
    await absent(parent);
  });

  it.each([
    { schemaVersion: 2 },
    { lineCount: -1 },
    { lineCount: 501 },
    { coverageCount: 10 },
    { lineCount: 0, coverageCount: 0 },
  ])('rejects invalid snapshot bounds %j', async (overrides) => {
    const parent = await claim();
    await expect(admit(parent, [], [], overrides)).rejects.toThrow();
    await absent(parent);
  });

  it.each([
    { billedAmount: '-1.00' },
    { quantity: '0.000' },
    { quantity: '-0.001' },
    { quantity: '1000000000.000' },
    { sourceLineId: '' },
    { procedureCode: 'x'.repeat(33) },
    { tooth: 'x'.repeat(81) },
    { sourceProcedureId: 'x'.repeat(201) },
  ] satisfies Partial<Line>[])('rejects invalid line facts %j', async (overrides) => {
    const parent = await claim();
    await expect(admit(parent, [line(0, '100.00', overrides)], [])).rejects.toThrow();
    await absent(parent);
  });

  it.each([
    { sequence: 0 },
    { sequence: 10 },
    { sourceCoverageId: '' },
    { payerName: 'x'.repeat(201) },
    { subscriberId: 'x'.repeat(201) },
    { relationship: 'x'.repeat(81) },
    { effectiveDate: new Date('2026-02-01'), terminationDate: new Date('2026-01-01') },
  ] satisfies Partial<Coverage>[])('rejects invalid coverage facts %j', async (overrides) => {
    const parent = await claim();
    await expect(admit(parent, [], [coverage(1, true, overrides)])).rejects.toThrow();
    await absent(parent);
  });

  it('accepts the exact maximum positive quantity and date boundaries without interpreting anatomy', async () => {
    const parent = await claim();
    await admit(
      parent,
      [line(0, '100.00', { quantity: '999999999.999', tooth: 'uninterpreted'.repeat(6) })],
      [
        coverage(1, true, {
          effectiveDate: new Date('2026-01-01'),
          terminationDate: new Date('2026-01-01'),
        }),
      ],
    );
    const saved = await prisma.claimSourceLine.findFirstOrThrow({
      where: { claimId: parent.id, organizationId: parent.organizationId },
    });
    expect(saved.quantity?.toFixed(3)).toBe('999999999.999');
  });

  it.each([
    'treatmentArea',
    'tooth',
    'surface',
    'quadrant',
    'toothRange',
    'toothNumberingSystem',
  ] as const)('rejects empty or control-bearing raw line tokens in %s', async (field) => {
    const parent = await claim();
    for (const value of ['', 'synthetic\ncontrol']) {
      await expect(admit(parent, [line(0, '100.00', { [field]: value })], [])).rejects.toThrow();
      await absent(parent);
    }
  });

  it('rejects empty/control coverage relationships and dates outside the ISO wire range', async () => {
    const parent = await claim();
    for (const relationship of ['', 'synthetic\ncontrol']) {
      await expect(admit(parent, [], [coverage(1, true, { relationship })])).rejects.toThrow();
    }
    await expect(
      admit(parent, [line(0, '100.00', { serviceDate: new Date('0000-01-01') })], []),
    ).rejects.toThrow();
    await expect(
      admit(parent, [], [coverage(1, true, { effectiveDate: new Date('+010000-01-01') })]),
    ).rejects.toThrow();
    await absent(parent);
  });

  it('rejects PostgreSQL numeric NaN rather than treating unknown amounts as a valid total', async () => {
    const parent = await claim();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.claimSourceDetails.create({
          data: {
            claimId: parent.id,
            organizationId: parent.organizationId,
            importedClaimAmount: '100.00',
            lineCount: 1,
            coverageCount: 0,
          },
        });
        await tx.$executeRaw`
        INSERT INTO "ClaimSourceLine" (id, "claimId", "organizationId", "sourceLineId", position, "procedureCode", "serviceDate", "billedAmount")
        VALUES (${randomUUID()}::uuid, ${parent.id}, ${parent.organizationId}, 'synthetic-line', 0, 'D2740', DATE '2026-01-01', 'NaN'::numeric)
      `;
      }),
    ).rejects.toThrow();
    await absent(parent);
  });

  it.each([
    ['line identity', [line(0, '50.00'), line(1, '50.00', { sourceLineId: '000-line-0' })], []],
    ['line position', [line(0, '50.00'), line(0, '50.00', { sourceLineId: 'other' })], []],
    [
      'coverage identity',
      [],
      [coverage(1), coverage(2, false, { sourceCoverageId: '000-coverage-1' })],
    ],
    ['coverage sequence', [], [coverage(1), coverage(1, false, { sourceCoverageId: 'other' })]],
  ] satisfies readonly [string, Line[], Coverage[]][])(
    'rejects repeated %s within the snapshot',
    async (_label, lines, coverages) => {
      const parent = await claim();
      await expect(admit(parent, lines, coverages)).rejects.toThrow();
      await absent(parent);
    },
  );

  it('rejects all updates and direct deletes, preserving snapshot facts after local Claim edits', async () => {
    const parent = await claim();
    await admit(parent);
    const where = { claimId: parent.id, organizationId: parent.organizationId };
    await expect(
      prisma.claimSourceDetails.updateMany({ where, data: { lineCount: 2 } }),
    ).rejects.toThrow();
    await expect(
      prisma.claimSourceLine.updateMany({ where, data: { billedAmount: '1.00' } }),
    ).rejects.toThrow();
    await expect(
      prisma.claimSourceCoverage.updateMany({ where, data: { subscriberId: 'replacement' } }),
    ).rejects.toThrow();
    await expect(prisma.claimSourceDetails.deleteMany({ where })).rejects.toThrow();
    await expect(prisma.claimSourceLine.deleteMany({ where })).rejects.toThrow();
    await expect(prisma.claimSourceCoverage.deleteMany({ where })).rejects.toThrow();
    await prisma.claim.update({
      where: { id: parent.id, organizationId: parent.organizationId },
      data: { claimAmount: '125.00', status: 'APPEALING' },
    });
    const stored = await prisma.claimSourceDetails.findFirstOrThrow({ where });
    expect(stored.importedClaimAmount.toFixed(2)).toBe('100.00');
    expect(await prisma.claimSourceLine.count({ where })).toBe(1);
    expect(await prisma.claimSourceCoverage.count({ where })).toBe(1);
  });

  it('rejects later child appends and permits only parent Claim cascade deletion', async () => {
    const parent = await claim();
    await admit(parent);
    await expect(
      prisma.claimSourceLine.create({
        data: {
          ...line(1, '0.00'),
          claimId: parent.id,
          organizationId: parent.organizationId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.claimSourceCoverage.create({
        data: {
          ...coverage(2, false),
          claimId: parent.id,
          organizationId: parent.organizationId,
        },
      }),
    ).rejects.toThrow();
    await prisma.claim.delete({ where: { id: parent.id, organizationId: parent.organizationId } });
    await absent(parent);
  });

  it('permits organization cascade deletion without leaving source snapshot children', async () => {
    const parent = await claim();
    await admit(parent);
    await prisma.organization.delete({ where: { id: parent.organizationId } });
    await absent(parent);
  });

  it('scopes all three read helpers and rejects unscoped mutations', async () => {
    const first = await claim();
    const second = await claim();
    await admit(first);
    await admit(second);
    const scoped = getOrgScopedDb(first.organizationId);
    expect(await scoped.claimSourceDetails.count()).toBe(1);
    expect(await scoped.claimSourceLine.count()).toBe(1);
    expect(await scoped.claimSourceCoverage.count()).toBe(1);
    expect(await scoped.claimSourceDetails.findFirst({ where: { claimId: second.id } })).toBeNull();
    expect(await scoped.claimSourceLine.findFirst({ where: { claimId: second.id } })).toBeNull();
    expect(
      await scoped.claimSourceCoverage.findFirst({ where: { claimId: second.id } }),
    ).toBeNull();
    expect(
      (await scoped.claimSourceDetails.findMany()).every(
        (item) => item.organizationId === first.organizationId,
      ),
    ).toBe(true);
    expect((await scoped.claimSourceLine.aggregate({ _count: true }))._count).toBe(1);
    expect(
      await scoped.claimSourceCoverage.groupBy({ by: ['organizationId'], _count: true }),
    ).toEqual([{ organizationId: first.organizationId, _count: 1 }]);
    await expect(
      prisma.claimSourceDetails.deleteMany({ where: { claimId: first.id } }),
    ).rejects.toThrow(MissingOrgScopeError);
    await expect(
      prisma.claimSourceLine.deleteMany({ where: { claimId: first.id } }),
    ).rejects.toThrow(MissingOrgScopeError);
    await expect(
      prisma.claimSourceCoverage.deleteMany({ where: { claimId: first.id } }),
    ).rejects.toThrow(MissingOrgScopeError);
  });
});

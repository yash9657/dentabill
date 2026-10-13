import { randomUUID } from 'node:crypto';

import { prisma, type UserRole } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';

import { ClaimSourceDetailsResponseSchema } from './claim-source-details.js';

async function seed(withDetails = true, role: UserRole = 'BILLING_STAFF') {
  const organization = await prisma.organization.create({
    data: { name: 'Synthetic source detail practice', clerkOrgId: `org_${randomUUID()}` },
  });
  const actor = await prisma.user.create({
    data: {
      organizationId: organization.id,
      clerkUserId: `user_${randomUUID()}`,
      email: 'source-details@example.test',
      role,
    },
  });
  const claim = await prisma.$transaction(async (tx) => {
    const created = await tx.claim.create({
      data: {
        organizationId: organization.id,
        patientDOBHash: 'synthetic-dob-hash',
        claimNumber: 'SYNTHETIC-DISPLAY-1',
        subscriberId: null,
        cdtCodes: ['D2740'],
        claimAmount: '420.00',
        payerCode: 'CIGNA_DENTAL',
        serviceDate: new Date('2026-10-01'),
        ...(withDetails
          ? {
              sourceSystem: 'OPEN_DENTAL',
              sourceNamespace: 'synthetic-practice',
              sourceClaimId: '000042',
              sourceVersion: 'source-revision-1',
              sourceContentHash: 'a'.repeat(64),
            }
          : {}),
      },
    });
    if (withDetails) {
      await tx.claimSourceDetails.create({
        data: {
          organizationId: organization.id,
          claimId: created.id,
          schemaVersion: 1,
          importedClaimAmount: '420.00',
          lineCount: 2,
          coverageCount: 2,
          createdAt: new Date('2026-10-02T03:04:05.000Z'),
        },
      });
      // Insert in reverse display order to exercise database ordering.
      await tx.claimSourceLine.createMany({
        data: [
          {
            organizationId: organization.id,
            claimId: created.id,
            sourceLineId: 'line-b',
            sourceProcedureId: 'procedure-b',
            position: 1,
            procedureCode: 'D2740',
            serviceDate: new Date('2026-10-01'),
            billedAmount: '319.90',
            tooth: 'AS',
            toothNumberingSystem: 'UNIVERSAL',
          },
          {
            organizationId: organization.id,
            claimId: created.id,
            sourceLineId: 'line-a',
            sourceProcedureId: 'procedure-a',
            position: 0,
            procedureCode: 'D2740',
            codeVersion: '2026',
            serviceDate: new Date('2026-09-30'),
            billedAmount: '100.10',
            quantity: '2.500',
            treatmentArea: 'Tooth',
            tooth: '4',
            surface: 'MO',
            quadrant: 'UR',
            toothRange: '4',
            toothNumberingSystem: 'UNIVERSAL',
          },
        ],
      });
      await tx.claimSourceCoverage.createMany({
        data: [
          {
            organizationId: organization.id,
            claimId: created.id,
            sourceCoverageId: 'coverage-secondary',
            sequence: 2,
            payerName: 'Synthetic Cigna coverage',
            payerIdentifier: 'synthetic-payer',
            payerIdentifierSystem: 'synthetic-id-system',
            isClaimCoverage: true,
            sourcePlanId: 'plan-secondary',
            sourceSubscriptionId: 'subscription-secondary',
            subscriberId: null,
            patientMemberId: 'synthetic-patient-member',
            groupNumber: 'synthetic-group',
            relationship: 'Child',
            effectiveDate: new Date('2026-01-01'),
            terminationDate: new Date('2026-12-31'),
          },
          {
            organizationId: organization.id,
            claimId: created.id,
            sourceCoverageId: 'coverage-primary',
            sequence: 1,
            payerName: 'Synthetic primary coverage',
            isClaimCoverage: false,
          },
        ],
      });
    }
    return created;
  });
  return { claim, organization, headers: { 'x-test-user-id': actor.clerkUserId } };
}

async function persisted(claimId: string, organizationId: string) {
  return prisma.claim.findFirstOrThrow({
    where: { id: claimId, organizationId },
    include: {
      sourceDetails: {
        include: {
          lines: { orderBy: { position: 'asc' } },
          coverages: { orderBy: { sequence: 'asc' } },
        },
      },
    },
  });
}

describe('GET /v1/claims/:id source details (real Postgres)', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    server = await buildServer({ logger: false });
    await prisma.$connect();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  it('requires authentication before exposing imported details', async () => {
    const { claim } = await seed();
    const response = await server.inject({ method: 'GET', url: `/v1/claims/${claim.id}` });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('coverage-secondary');
  });

  it('returns null for legacy claims instead of synthesizing a line from the code list', async () => {
    const { claim, headers } = await seed(false);
    const response = await server.inject({ method: 'GET', url: `/v1/claims/${claim.id}`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ cdtCodes: ['D2740'], sourceDetails: null });
    expect(await prisma.claimSourceLine.count()).toBe(0);
    expect(await prisma.claimSourceCoverage.count()).toBe(0);
  });

  it('returns null for an identified source claim imported without optional detail arrays', async () => {
    const { claim, organization, headers } = await seed(false);
    await prisma.claim.updateMany({
      where: { id: claim.id, organizationId: organization.id },
      data: {
        sourceSystem: 'DENTRIX',
        sourceNamespace: 'synthetic-practice',
        sourceClaimId: 'source-without-details',
        sourceContentHash: 'b'.repeat(64),
      },
    });
    const response = await server.inject({
      method: 'GET',
      url: `/v1/claims/${claim.id}`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('sourceDetails', null);
    expect(await prisma.claimSourceDetails.count()).toBe(0);
  });

  it.each(['OWNER', 'ADMIN', 'BILLING_STAFF'] as const)(
    'allows a same-organization %s to read the explicit source snapshot',
    async (role) => {
      const { claim, headers } = await seed(true, role);
      const response = await server.inject({
        method: 'GET',
        url: `/v1/claims/${claim.id}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ sourceDetails: unknown }>();
      const details = ClaimSourceDetailsResponseSchema.parse(body.sourceDetails);
      expect(details).toMatchObject({
        schemaVersion: 1,
        importedClaimAmount: '420.00',
        sourceSystem: 'OPEN_DENTAL',
        sourceNamespace: 'synthetic-practice',
        sourceClaimId: '000042',
        sourceVersion: 'source-revision-1',
        createdAt: '2026-10-02T03:04:05.000Z',
      });
      expect(
        details.lines.map((line) => [line.sourceLineId, line.procedureCode, line.tooth]),
      ).toEqual([
        ['line-a', 'D2740', '4'],
        ['line-b', 'D2740', 'AS'],
      ]);
      expect(details.lines[0]).toMatchObject({
        serviceDate: '2026-09-30',
        billedAmount: '100.10',
        quantity: '2.500',
        sourceProcedureId: 'procedure-a',
        codeVersion: '2026',
        treatmentArea: 'Tooth',
        surface: 'MO',
        quadrant: 'UR',
        toothRange: '4',
        toothNumberingSystem: 'UNIVERSAL',
      });
      expect(details.lines[1]).toMatchObject({
        quantity: null,
        codeVersion: null,
        surface: null,
        quadrant: null,
        toothRange: null,
      });
      expect(
        details.coverages.map((coverage) => [coverage.sequence, coverage.isClaimCoverage]),
      ).toEqual([
        [1, false],
        [2, true],
      ]);
      expect(details.coverages[1]).toMatchObject({
        sourcePlanId: 'plan-secondary',
        sourceSubscriptionId: 'subscription-secondary',
        subscriberId: null,
        patientMemberId: 'synthetic-patient-member',
        effectiveDate: '2026-01-01',
        terminationDate: '2026-12-31',
      });
      expect(details.coverages[0]).toMatchObject({
        subscriberId: null,
        patientMemberId: null,
        effectiveDate: null,
        terminationDate: null,
      });
      expect(JSON.stringify(details)).not.toContain('sourceContentHash');
      expect(JSON.stringify(details)).not.toContain('patientDOBHash');
      expect(JSON.stringify(details)).not.toContain('organizationId');
    },
  );

  it('preserves imported values and nullable outbound identity without writing claim data on read', async () => {
    const { claim, organization, headers } = await seed();
    await prisma.claim.updateMany({
      where: { id: claim.id, organizationId: organization.id },
      data: { claimAmount: '400.50' },
    });
    const before = await persisted(claim.id, organization.id);
    const response = await server.inject({ method: 'GET', url: `/v1/claims/${claim.id}`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      claimAmount: '400.5',
      sourceDetails: { importedClaimAmount: '420.00' },
    });
    expect(await persisted(claim.id, organization.id)).toEqual(before);
    expect(before.subscriberId).toBeNull();
    const audits = await prisma.auditLog.findMany({ where: { organizationId: organization.id } });
    expect(audits.map((entry) => entry.action)).toEqual(['claim.read']);
    expect(JSON.stringify(audits)).not.toContain('synthetic-patient-member');
    expect(JSON.stringify(audits)).not.toContain('coverage-secondary');
  });

  it('returns 404 for another organization or an absent claim without leaking source children', async () => {
    const own = await seed();
    const other = await seed();
    for (const id of [other.claim.id, 'missing-claim']) {
      const response = await server.inject({
        method: 'GET',
        url: `/v1/claims/${id}`,
        headers: own.headers,
      });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('sourceDetails');
      expect(response.body).not.toContain('coverage-secondary');
      expect(response.body).not.toContain(other.organization.id);
    }
    expect(await prisma.auditLog.count({ where: { organizationId: other.organization.id } })).toBe(
      0,
    );
  });

  it('keeps list, create and patch responses shallow and cannot patch the imported snapshot', async () => {
    const { claim, organization, headers } = await seed();
    const before = await persisted(claim.id, organization.id);
    const patched = await server.inject({
      method: 'PATCH',
      url: `/v1/claims/${claim.id}`,
      headers,
      payload: {
        priority: 25,
        sourceDetails: { importedClaimAmount: '0.00', lines: [], coverages: [] },
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).not.toHaveProperty('sourceDetails');
    expect((await persisted(claim.id, organization.id)).sourceDetails).toEqual(
      before.sourceDetails,
    );
    const listed = await server.inject({ method: 'GET', url: '/v1/claims', headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ items: unknown[] }>().items[0]).not.toHaveProperty('sourceDetails');
    const created = await server.inject({
      method: 'POST',
      url: '/v1/claims',
      headers,
      payload: {
        patientDOBHash: 'synthetic-new-hash',
        claimNumber: 'SYNTHETIC-NEW',
        cdtCodes: ['D1110'],
        claimAmount: '100.00',
        payerCode: 'CIGNA_DENTAL',
        serviceDate: '2026-10-01T00:00:00.000Z',
        sourceDetails: { importedClaimAmount: '0.00', lines: [], coverages: [] },
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).not.toHaveProperty('sourceDetails');
    expect(
      await prisma.claimSourceDetails.count({ where: { organizationId: organization.id } }),
    ).toBe(1);
  });
});

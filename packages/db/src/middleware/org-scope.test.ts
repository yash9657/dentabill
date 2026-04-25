import { describe, expect, it } from 'vitest';

import { prisma } from '../client.js';
import { MissingOrgScopeError } from '../lib/errors.js';

async function makeOrg(name = 'Acme Dental') {
  return prisma.organization.create({
    data: { name, clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}` },
  });
}

describe('orgScopeWriteExtension', () => {
  describe('create', () => {
    it('rejects claim.create with no organizationId', async () => {
      await expect(
        prisma.claim.create({
          data: {
            patientDOBHash: 'h',
            claimNumber: 'CL-X',
            cdtCodes: ['D2740'],
            claimAmount: '100.00',
            payerCode: 'DELTA_DENTAL_PPO',
            serviceDate: new Date(),
          } as never,
        }),
      ).rejects.toBeInstanceOf(MissingOrgScopeError);
    });

    it('allows claim.create when organizationId is present', async () => {
      const org = await makeOrg();
      const claim = await prisma.claim.create({
        data: {
          organizationId: org.id,
          patientDOBHash: 'h',
          claimNumber: 'CL-OK',
          cdtCodes: ['D2740'],
          claimAmount: '100.00',
          payerCode: 'DELTA_DENTAL_PPO',
          serviceDate: new Date(),
        },
      });
      expect(claim.organizationId).toBe(org.id);
    });

    it('rejects user.create with empty-string organizationId', async () => {
      await expect(
        prisma.user.create({
          data: {
            organizationId: '',
            clerkUserId: 'u_x',
            email: 'x@example.com',
            role: 'OWNER',
          },
        }),
      ).rejects.toBeInstanceOf(MissingOrgScopeError);
    });

    it('allows organization.create — Organization is the tenant root, not multi-tenant', async () => {
      const org = await prisma.organization.create({
        data: { name: 'Root Co', clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}` },
      });
      expect(org.id).toBeDefined();
    });
  });

  describe('createMany', () => {
    it('rejects createMany when any row lacks organizationId', async () => {
      const org = await makeOrg();
      await expect(
        prisma.claim.createMany({
          data: [
            {
              organizationId: org.id,
              patientDOBHash: 'h1',
              claimNumber: 'CL-A',
              cdtCodes: ['D2740'],
              claimAmount: '100.00',
              payerCode: 'DELTA_DENTAL_PPO',
              serviceDate: new Date(),
            },
            {
              patientDOBHash: 'h2',
              claimNumber: 'CL-B',
              cdtCodes: ['D2740'],
              claimAmount: '200.00',
              payerCode: 'DELTA_DENTAL_PPO',
              serviceDate: new Date(),
            } as never,
          ],
        }),
      ).rejects.toBeInstanceOf(MissingOrgScopeError);
    });

    it('allows createMany when every row has organizationId', async () => {
      const org = await makeOrg();
      const result = await prisma.claim.createMany({
        data: [
          {
            organizationId: org.id,
            patientDOBHash: 'h1',
            claimNumber: 'CL-M-1',
            cdtCodes: ['D2740'],
            claimAmount: '100.00',
            payerCode: 'DELTA_DENTAL_PPO',
            serviceDate: new Date(),
          },
          {
            organizationId: org.id,
            patientDOBHash: 'h2',
            claimNumber: 'CL-M-2',
            cdtCodes: ['D2740'],
            claimAmount: '200.00',
            payerCode: 'DELTA_DENTAL_PPO',
            serviceDate: new Date(),
          },
        ],
      });
      expect(result.count).toBe(2);
    });
  });

  describe('update / updateMany', () => {
    it('rejects update with where missing organizationId', async () => {
      const org = await makeOrg();
      const claim = await prisma.claim.create({
        data: {
          organizationId: org.id,
          patientDOBHash: 'h',
          claimNumber: 'CL-U',
          cdtCodes: ['D2740'],
          claimAmount: '100.00',
          payerCode: 'DELTA_DENTAL_PPO',
          serviceDate: new Date(),
        },
      });
      await expect(
        prisma.claim.update({
          where: { id: claim.id },
          data: { status: 'IN_QUEUE' },
        }),
      ).rejects.toBeInstanceOf(MissingOrgScopeError);
    });

    it('allows update when where includes organizationId', async () => {
      const org = await makeOrg();
      const claim = await prisma.claim.create({
        data: {
          organizationId: org.id,
          patientDOBHash: 'h',
          claimNumber: 'CL-U-OK',
          cdtCodes: ['D2740'],
          claimAmount: '100.00',
          payerCode: 'DELTA_DENTAL_PPO',
          serviceDate: new Date(),
        },
      });
      const updated = await prisma.claim.update({
        where: { id: claim.id, organizationId: org.id },
        data: { status: 'IN_QUEUE' },
      });
      expect(updated.status).toBe('IN_QUEUE');
    });

    it('rejects updateMany with where missing organizationId', async () => {
      await expect(
        prisma.claim.updateMany({
          where: { status: 'PENDING' },
          data: { status: 'IN_QUEUE' },
        }),
      ).rejects.toBeInstanceOf(MissingOrgScopeError);
    });
  });

  describe('delete / deleteMany', () => {
    it('rejects delete with where missing organizationId', async () => {
      const org = await makeOrg();
      const claim = await prisma.claim.create({
        data: {
          organizationId: org.id,
          patientDOBHash: 'h',
          claimNumber: 'CL-D',
          cdtCodes: ['D2740'],
          claimAmount: '100.00',
          payerCode: 'DELTA_DENTAL_PPO',
          serviceDate: new Date(),
        },
      });
      await expect(prisma.claim.delete({ where: { id: claim.id } })).rejects.toBeInstanceOf(
        MissingOrgScopeError,
      );
    });

    it('rejects deleteMany with where missing organizationId', async () => {
      await expect(
        prisma.claim.deleteMany({ where: { status: 'COMPLETED' } }),
      ).rejects.toBeInstanceOf(MissingOrgScopeError);
    });

    it('allows delete when where includes organizationId', async () => {
      const org = await makeOrg();
      const claim = await prisma.claim.create({
        data: {
          organizationId: org.id,
          patientDOBHash: 'h',
          claimNumber: 'CL-D-OK',
          cdtCodes: ['D2740'],
          claimAmount: '100.00',
          payerCode: 'DELTA_DENTAL_PPO',
          serviceDate: new Date(),
        },
      });
      const deleted = await prisma.claim.delete({
        where: { id: claim.id, organizationId: org.id },
      });
      expect(deleted.id).toBe(claim.id);
    });
  });

  describe('upsert', () => {
    it('rejects upsert when create payload lacks organizationId', async () => {
      const org = await makeOrg();
      await expect(
        prisma.user.upsert({
          where: { clerkUserId: 'u_no_org', organizationId: org.id },
          create: {
            clerkUserId: 'u_no_org',
            email: 'x@example.com',
            role: 'OWNER',
          } as never,
          update: { email: 'y@example.com' },
        }),
      ).rejects.toBeInstanceOf(MissingOrgScopeError);
    });

    it('rejects upsert when where lacks organizationId', async () => {
      const org = await makeOrg();
      await expect(
        prisma.user.upsert({
          where: { clerkUserId: 'u_no_where_org' },
          create: {
            organizationId: org.id,
            clerkUserId: 'u_no_where_org',
            email: 'x@example.com',
            role: 'OWNER',
          },
          update: { email: 'y@example.com' },
        }),
      ).rejects.toBeInstanceOf(MissingOrgScopeError);
    });
  });

  describe('non-multi-tenant models pass through', () => {
    it('Organization writes work without an organizationId guard', async () => {
      const org = await prisma.organization.create({
        data: { name: 'Solo', clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}` },
      });
      const updated = await prisma.organization.update({
        where: { id: org.id },
        data: { name: 'Solo Renamed' },
      });
      expect(updated.name).toBe('Solo Renamed');
      const deleted = await prisma.organization.delete({ where: { id: org.id } });
      expect(deleted.id).toBe(org.id);
    });
  });
});

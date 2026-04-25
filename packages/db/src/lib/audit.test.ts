import { describe, expect, it } from 'vitest';

import { prisma } from '../client.js';

import { audit } from './audit.js';
import { MissingOrgScopeError } from './errors.js';

async function makeOrg(name = 'Acme Dental') {
  return prisma.organization.create({
    data: { name, clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}` },
  });
}

describe('audit()', () => {
  it('rejects calls missing organizationId', async () => {
    await expect(
      audit({
        action: 'claim.read',
        resourceType: 'Claim',
        resourceId: 'clm_1',
        organizationId: '',
      }),
    ).rejects.toBeInstanceOf(MissingOrgScopeError);
  });

  it('writes an AuditLog row with the minimum required fields', async () => {
    const org = await makeOrg();
    const row = await audit({
      action: 'claim.read',
      resourceType: 'Claim',
      resourceId: 'clm_1',
      organizationId: org.id,
    });
    expect(row.organizationId).toBe(org.id);
    expect(row.action).toBe('claim.read');
    expect(row.resourceType).toBe('Claim');
    expect(row.resourceId).toBe('clm_1');
    expect(row.userId).toBeNull();
    expect(row.metadata).toEqual({});
  });

  it('persists optional userId, ip, user-agent, and metadata', async () => {
    const org = await makeOrg();
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        clerkUserId: 'clerk_user_x',
        email: 'biller@example.com',
        role: 'BILLING_STAFF',
      },
    });
    const row = await audit({
      action: 'claim.update',
      resourceType: 'Claim',
      resourceId: 'clm_2',
      organizationId: org.id,
      userId: user.id,
      ipAddress: '10.0.0.1',
      userAgent: 'Mozilla/5.0',
      metadata: { from: 'PENDING', to: 'IN_QUEUE' },
    });
    expect(row.userId).toBe(user.id);
    expect(row.ipAddress).toBe('10.0.0.1');
    expect(row.userAgent).toBe('Mozilla/5.0');
    expect(row.metadata).toEqual({ from: 'PENDING', to: 'IN_QUEUE' });
  });

  it('accepts a custom client (e.g. inside a transaction)', async () => {
    const org = await makeOrg();
    const row = await prisma.$transaction(async (tx) =>
      audit(
        {
          action: 'claim.read',
          resourceType: 'Claim',
          resourceId: 'clm_3',
          organizationId: org.id,
        },
        tx,
      ),
    );
    expect(row.organizationId).toBe(org.id);
  });
});

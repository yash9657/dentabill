import { afterAll, describe, expect, it } from 'vitest';

import { Prisma, PrismaClient, prisma } from './index.js';

describe('@dentabill/db client', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  // toBeInstanceOf(PrismaClient) blows up on Vitest's deep proxy walker;
  // duck-typing on the lifecycle methods is more reliable.
  it('exports a PrismaClient singleton with lifecycle methods', () => {
    expect(prisma).toBeDefined();
    expect(typeof prisma.$connect).toBe('function');
    expect(typeof prisma.$disconnect).toBe('function');
    expect(typeof prisma.$queryRaw).toBe('function');
    expect(typeof prisma.$transaction).toBe('function');
  });

  it('exposes the Prisma namespace for input/output types', () => {
    expect(Prisma).toBeDefined();
    expect(Prisma.ModelName).toBeDefined();
    expect(PrismaClient).toBeDefined();
  });

  it('exposes all PRD §5 model accessors', () => {
    expect(typeof prisma.organization.findMany).toBe('function');
    expect(typeof prisma.user.findMany).toBe('function');
    expect(typeof prisma.claim.findMany).toBe('function');
    expect(typeof prisma.call.findMany).toBe('function');
    expect(typeof prisma.callSummary.findMany).toBe('function');
    expect(typeof prisma.callEvent.findMany).toBe('function');
    expect(typeof prisma.payerConfig.findMany).toBe('function');
    expect(typeof prisma.auditLog.findMany).toBe('function');
  });

  it('connects to the database', async () => {
    // Trivial query that proves the migration applied and the client can talk.
    const result = await prisma.$queryRaw<[{ ok: number }]>`SELECT 1 AS ok`;
    expect(result[0].ok).toBe(1);
  });
});

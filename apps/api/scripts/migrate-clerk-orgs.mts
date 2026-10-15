#!/usr/bin/env tsx
/**
 * P4-T4 — Clerk Organizations reconciliation script (ADR-044).
 *
 * Walks all `Organization` rows whose `clerkOrgId` starts with the
 * synthetic `local_*` prefix (introduced in ADR-031 to satisfy the
 * NOT-NULL constraint before Clerk Organizations were enabled) and:
 *
 *   1. Creates a real Clerk org via `clerkClient.organizations`.
 *   2. Invites every `User` row whose `organizationId` matches the
 *      DentaBill org as a member of the new Clerk org.
 *   3. Swaps `Organization.clerkOrgId` to the real Clerk org id.
 *   4. Persists a reverse-map JSON file so a misfire can be rolled
 *      back without losing the audit trail.
 *
 * Idempotent: re-running the script for an already-migrated org is
 * a no-op (the `local_` prefix check fails). Per-row commit (no
 * outer transaction) so a partial failure leaves the rest of the
 * estate consistent.
 *
 * The Clerk SDK is loaded lazily so the script imports cleanly in
 * environments where `@clerk/backend` is not installed (CI dry-run,
 * dev without a Clerk secret).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@dentabill/db';

interface ReverseMapEntry {
  readonly dentabillOrgId: string;
  readonly previousClerkOrgId: string;
  readonly newClerkOrgId: string;
  readonly migratedAt: string;
  readonly memberClerkUserIds: readonly string[];
}

interface ScriptOptions {
  readonly dryRun: boolean;
  readonly outDir: string;
}

function parseArgs(argv: readonly string[]): ScriptOptions {
  return {
    dryRun: argv.includes('--dry-run'),
    outDir: argv.includes('--out') ? (argv[argv.indexOf('--out') + 1] ?? '/tmp') : '/tmp',
  };
}

interface ClerkOrganizationsClient {
  createOrganization: (input: { name: string; createdBy?: string }) => Promise<{ id: string }>;
  createOrganizationMembership: (input: {
    organizationId: string;
    userId: string;
    role: string;
  }) => Promise<unknown>;
}

interface ClerkClient {
  readonly organizations: ClerkOrganizationsClient;
}

async function loadClerkClient(): Promise<ClerkClient> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret || secret.length === 0) {
    throw new Error('CLERK_SECRET_KEY must be set to run the live migration.');
  }
  // Lazy import — the script must parse and dry-run cleanly without
  // @clerk/backend installed on the host.
  const moduleId = '@clerk/backend';
  const mod = (await import(moduleId)) as {
    createClerkClient?: (opts: { secretKey: string }) => ClerkClient;
  };
  if (typeof mod.createClerkClient !== 'function') {
    throw new Error('@clerk/backend.createClerkClient is unavailable.');
  }
  return mod.createClerkClient({ secretKey: secret });
}

async function migrateOne(
  prisma: PrismaClient,
  clerk: ClerkClient | null,
  org: { id: string; name: string; clerkOrgId: string },
  members: readonly { id: string; clerkUserId: string; role: string }[],
  dryRun: boolean,
): Promise<ReverseMapEntry | null> {
  if (dryRun) {
    process.stdout.write(
      `[dry-run] would migrate org ${org.id} (name="${org.name}", clerk=${org.clerkOrgId}) with ${String(members.length)} members\n`,
    );
    return null;
  }
  if (clerk === null) {
    throw new Error('Clerk client unavailable in non-dry-run mode.');
  }

  const owner = members.find((m) => m.role === 'OWNER') ?? members[0];
  const created = await clerk.organizations.createOrganization({
    name: org.name,
    ...(owner ? { createdBy: owner.clerkUserId } : {}),
  });

  for (const member of members) {
    if (owner && member.id === owner.id) continue;
    await clerk.organizations.createOrganizationMembership({
      organizationId: created.id,
      userId: member.clerkUserId,
      role: member.role === 'OWNER' ? 'org:admin' : 'org:member',
    });
  }

  await prisma.organization.update({
    where: { id: org.id },
    data: { clerkOrgId: created.id },
  });

  return {
    dentabillOrgId: org.id,
    previousClerkOrgId: org.clerkOrgId,
    newClerkOrgId: created.id,
    migratedAt: new Date().toISOString(),
    memberClerkUserIds: members.map((m) => m.clerkUserId),
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const clerk = opts.dryRun ? null : await loadClerkClient();

  const candidates = await prisma.organization.findMany({
    where: { clerkOrgId: { startsWith: 'local_' } },
    select: { id: true, name: true, clerkOrgId: true },
  });

  process.stdout.write(`found ${String(candidates.length)} orgs to migrate\n`);

  const reverseMap: ReverseMapEntry[] = [];
  for (const org of candidates) {
    const members = await prisma.user.findMany({
      where: { organizationId: org.id },
      select: { id: true, clerkUserId: true, role: true },
    });
    try {
      const entry = await migrateOne(prisma, clerk, org, members, opts.dryRun);
      if (entry) reverseMap.push(entry);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`failed to migrate org ${org.id}: ${msg}\n`);
    }
  }

  if (!opts.dryRun && reverseMap.length > 0) {
    const path = join(opts.outDir, `clerk-migration-${String(Date.now())}.json`);
    writeFileSync(path, JSON.stringify(reverseMap, null, 2));
    process.stdout.write(`wrote reverse map to ${path}\n`);
  }

  await prisma.$disconnect();
}

await main();

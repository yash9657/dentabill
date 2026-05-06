import { hashPatientDOB, prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import { FakeRetell } from '@dentabill/payer-ivr';
import type { CallJobData } from '@dentabill/queue';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadWorkerEnv } from './env.js';
import { createCallJobHandler, providerLineToE164 } from './handler.js';

/**
 * Integration tests for the real call-job handler (P3-T10).
 *
 * Hits the real `dentabill_test` Postgres so the org-scope read helper
 * + the write middleware (ADR-009 layers 1+2) are exercised exactly as
 * they will be in production. The Retell port is `FakeRetell` so the
 * full event flow runs in-process — no network, no flakiness.
 */

const HASH_SECRET = 'integration-test-secret-not-the-real-one';

const silentLogger = createLogger({
  level: 'fatal',
  pretty: false,
  base: { service: 'call-worker-test' },
});

const env = loadWorkerEnv({
  REDIS_URL: 'redis://localhost:6379/14',
  DATABASE_URL: 'postgresql://dentabill:dentabill@localhost:5432/dentabill_test?schema=public',
  RETELL_API_KEY: '',
  WORKER_OUTBOUND_NUMBER: '+15555550100',
});

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog", "BillingUsageRecord" RESTART IDENTITY CASCADE',
  );
});

interface SeedResult {
  readonly orgId: string;
  readonly claimId: string;
}

async function seedOrgAndClaim(opts?: { providerNpi?: string | null }): Promise<SeedResult> {
  const org = await prisma.organization.create({
    data: {
      name: 'Sunshine Family Dental',
      clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}`,
      npi: opts?.providerNpi === null ? null : (opts?.providerNpi ?? '1234567890'),
    },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      claimNumber: 'CLM-9001',
      patientDOBHash: hashPatientDOB({
        dob: '1990-05-12',
        organizationId: org.id,
        secret: HASH_SECRET,
      }),
      patientDOBLast4: '0512',
      cdtCodes: ['D1110'],
      claimAmount: '245.00',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date('2026-01-15T00:00:00.000Z'),
      status: 'IN_QUEUE',
      priority: 80,
    },
  });
  return { orgId: org.id, claimId: claim.id };
}

function jobFor(data: CallJobData): Parameters<ReturnType<typeof createCallJobHandler>>[0] {
  // BullMQ Job has many fields; the handler only reads `id` + `data`.
  return { id: 'job_test_1', data } as Parameters<ReturnType<typeof createCallJobHandler>>[0];
}

describe('createCallJobHandler — happy path', () => {
  it('drives PENDING → CALLING → COMPLETED, persists Call + CallEvent rows', async () => {
    const { orgId, claimId } = await seedOrgAndClaim();
    // Deterministic retellCallId so the test can drive simulateHappyPath
    // without racing the handler's startCall → DB-write → subscribe path.
    const retellCallId = 'fake_call_happy_1';
    const fake = new FakeRetell({ retellCallIdFactory: () => retellCallId });
    const handler = createCallJobHandler({
      logger: silentLogger,
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });

    const data: CallJobData = {
      organizationId: orgId,
      claimId,
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 1,
      claimPriority: 80,
      idempotencyKey: 'job-test-1',
    };

    // FakeRetell buffers events emitted before the handler subscribes
    // and replays them on subscribe (mirrors the production race where
    // Retell webhook delivery beats the worker's listener registration).
    // We can therefore kick the simulation eagerly once startCall has
    // been observed — no need to coordinate against the DB write.
    const handlerPromise = handler(jobFor(data), 'token');
    await waitFor(() => fake.startedCalls.length === 1);
    await fake.simulateHappyPath(retellCallId);

    const result = await handlerPromise;
    expect(result.outcome).toBe('COMPLETED');
    expect(result.callId).toMatch(/^c[a-z0-9]+$/);

    const claimAfter = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claimAfter.status).toBe('COMPLETED');
    expect(claimAfter.lastCallAt).not.toBeNull();

    const callRow = await prisma.call.findUniqueOrThrow({ where: { id: result.callId } });
    expect(callRow.organizationId).toBe(orgId);
    expect(callRow.claimId).toBe(claimId);
    expect(callRow.status).toBe('COMPLETED');
    expect(callRow.humanReached).toBe(true);
    expect(callRow.attemptNumber).toBe(1);
    expect(callRow.endedAt).not.toBeNull();
    expect(callRow.durationSeconds).not.toBeNull();
    expect(callRow.retellCallId).toBe(retellCallId);

    const events = await prisma.callEvent.findMany({
      where: { callId: result.callId },
      orderBy: { timestamp: 'asc' },
    });
    // Started + 4 transcripts + ended = 6 events from simulateHappyPath +
    // the auto-emitted call.started.
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(events.map((e) => e.eventType)).toContain('call.ended');
    expect(events.map((e) => e.eventType)).toContain('call.transcript');
  });
});

describe('createCallJobHandler — denial path', () => {
  it('flips Claim.status → DENIED when collectedInfo.claimStatus = "denied"', async () => {
    const { orgId, claimId } = await seedOrgAndClaim();
    const retellCallId = 'fake_call_deny_1';
    const fake = new FakeRetell({ retellCallIdFactory: () => retellCallId });
    const handler = createCallJobHandler({
      logger: silentLogger,
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });

    const data: CallJobData = {
      organizationId: orgId,
      claimId,
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 1,
      claimPriority: 80,
      idempotencyKey: 'job-test-deny-1',
    };

    const handlerPromise = handler(jobFor(data), 'token');
    await waitFor(() => fake.startedCalls.length === 1);
    await fake.simulateDenial(retellCallId);

    const result = await handlerPromise;
    expect(result.outcome).toBe('COMPLETED');

    const claimAfter = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claimAfter.status).toBe('DENIED');
  });
});

describe('createCallJobHandler — input validation & guards', () => {
  it('rejects a malformed job payload at the dequeue trust boundary', async () => {
    const fake = new FakeRetell();
    const handler = createCallJobHandler({
      logger: silentLogger,
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });
    // Bypass the CallJobData compile-time check so the test can assert
    // the dequeue-time runtime guard rejects out-of-range payloads. This
    // is the trust-boundary contract — the worker cannot rely on the
    // enqueuer having validated.
    const malformed = jobFor({
      organizationId: 'org_x',
      claimId: 'clm_x',
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 99,
      claimPriority: 50,
      idempotencyKey: 'bad-1',
    });
    await expect(handler(malformed, 'token')).rejects.toThrow();
    expect(fake.startedCalls).toHaveLength(0);
  });

  it('throws when the claim is not found in the named org (cross-org isolation)', async () => {
    const { orgId, claimId } = await seedOrgAndClaim();
    // Seed a SECOND org; we will look up `claimId` (org A) under org B.
    const otherOrg = await prisma.organization.create({
      data: { name: 'Other', clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}` },
    });
    const fake = new FakeRetell();
    const handler = createCallJobHandler({
      logger: silentLogger,
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });
    const data: CallJobData = {
      organizationId: otherOrg.id,
      claimId, // belongs to org A — must not be reachable from org B
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 1,
      claimPriority: 50,
      idempotencyKey: 'cross-org-1',
    };
    await expect(handler(jobFor(data), 'token')).rejects.toThrow(/not found in organization/);
    expect(fake.startedCalls).toHaveLength(0);

    // Org A's claim must remain untouched.
    const claimAfter = await prisma.claim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claimAfter.organizationId).toBe(orgId);
    expect(claimAfter.status).toBe('IN_QUEUE');
  });

  it('throws when the org has no provider NPI configured', async () => {
    const { orgId, claimId } = await seedOrgAndClaim({ providerNpi: null });
    const fake = new FakeRetell();
    const handler = createCallJobHandler({
      logger: silentLogger,
      prisma,
      retellPort: fake,
      env,
      outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
    });
    const data: CallJobData = {
      organizationId: orgId,
      claimId,
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 1,
      claimPriority: 50,
      idempotencyKey: 'no-npi-1',
    };
    await expect(handler(jobFor(data), 'token')).rejects.toThrow(/provider NPI/);
    expect(fake.startedCalls).toHaveLength(0);
  });
});

describe('providerLineToE164', () => {
  it('canonicalises hyphenated US numbers', () => {
    expect(providerLineToE164('1-800-765-6003')).toBe('+18007656003');
    expect(providerLineToE164('800-244-6224')).toBe('+18002446224');
  });

  it('keeps already-E.164 input unchanged', () => {
    expect(providerLineToE164('+18007656003')).toBe('+18007656003');
  });

  it('throws on a non-canonical line', () => {
    expect(() => providerLineToE164('555')).toThrow();
  });
});

/**
 * Polls `predicate` every 5ms up to `timeoutMs`. We use this instead of
 * `setTimeout(0)` because `FakeRetell.startCall` resolves on a microtask
 * but the handler then issues a Prisma write before the test can observe
 * the row; polling is the simplest way to bridge those steps without
 * coupling the test to internal timing.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor: predicate never became true');
}

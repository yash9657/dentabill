import { randomUUID } from 'node:crypto';

import { type CallStatus, type ClaimStatus, prisma } from '@dentabill/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { requestCallCancellation } from './cancel-call.js';

const REQUESTED_AT = new Date('2026-10-13T18:00:00.000Z');
const CLERK_USER_ID = 'clerk_cancel_operator';

async function seed(status: CallStatus = 'ON_HOLD', claimStatus: ClaimStatus = 'CALLING') {
  const org = await prisma.organization.create({
    data: { name: 'Cancellation Test Dental', clerkOrgId: `clerk_${randomUUID()}` },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      claimNumber: 'SYNTHETIC-CANCEL-1',
      subscriberId: 'SYNTHETIC-MEMBER-1',
      patientDOBHash: 'synthetic-not-a-real-dob',
      cdtCodes: ['D1110'],
      claimAmount: '245.00',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date('2026-01-15T00:00:00.000Z'),
      status: claimStatus,
    },
  });
  const call = await prisma.call.create({
    data: {
      organizationId: org.id,
      claimId: claim.id,
      retellCallId: `fake_cancel_${randomUUID()}`,
      status,
      startedAt: new Date('2026-10-13T17:59:00.000Z'),
      // Preserve independently received timing evidence, even before terminal status.
      endedAt: new Date('2026-10-13T17:59:45.000Z'),
      durationSeconds: 45,
    },
  });
  return {
    org,
    claim,
    call,
    input: {
      organizationId: org.id,
      callId: call.id,
      clerkUserId: CLERK_USER_ID,
      now: REQUESTED_AT,
    },
  };
}

function updateBarrier(expected = 1) {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrive: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  let count = 0;
  const client = prisma.$extends({
    query: {
      call: {
        async updateMany({ args, query }) {
          count += 1;
          if (count === expected) arrive();
          await released;
          return query(args);
        },
      },
    },
  });
  return { client, reached, release };
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_cancel_audit ON "AuditLog"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_cancel_audit()');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
});

describe('requestCallCancellation', () => {
  it.each<CallStatus>(['INITIATED', 'NAVIGATING_IVR', 'ON_HOLD', 'HUMAN_REACHED', 'COLLECTING'])(
    'requests cancellation of %s without fabricating terminal evidence',
    async (status) => {
      const { call, claim, input } = await seed(status);

      const result = await requestCallCancellation(prisma, input);

      expect(result).toEqual({
        ...call,
        cancelRequestedAt: REQUESTED_AT,
        cancelRequestedBy: CLERK_USER_ID,
      });
      expect(
        await prisma.claim.findFirst({
          where: { id: claim.id, organizationId: input.organizationId },
        }),
      ).toMatchObject({ status: 'MANUAL_REVIEW' });
      expect(await prisma.callEvent.findMany({ where: { callId: call.id } })).toEqual([
        expect.objectContaining({
          eventType: 'call.cancel.requested',
          timestamp: REQUESTED_AT,
          data: { requestedBy: CLERK_USER_ID, requestedAt: REQUESTED_AT.toISOString() },
        }),
      ]);
      expect(
        await prisma.auditLog.findMany({ where: { organizationId: input.organizationId } }),
      ).toEqual([
        expect.objectContaining({
          action: 'call.cancel.requested',
          resourceType: 'Call',
          resourceId: call.id,
          metadata: { clerkUserId: CLERK_USER_ID, previousStatus: status, claimChanged: true },
        }),
      ]);
    },
  );

  it('concurrent duplicate requests persist exactly one marker, event, and audit', async () => {
    const { input } = await seed();
    const barrier = updateBarrier(2);
    const pending = Promise.all([
      requestCallCancellation(barrier.client, input),
      requestCallCancellation(barrier.client, {
        ...input,
        clerkUserId: 'clerk_second_operator',
        now: new Date(REQUESTED_AT.getTime() + 1_000),
      }),
    ]);
    await barrier.reached;
    barrier.release();
    const [first, second] = await pending;

    expect(first).toEqual(second);
    expect(first?.cancelRequestedAt).not.toBeNull();
    expect(await prisma.callEvent.count({ where: { callId: input.callId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: input.organizationId } })).toBe(
      1,
    );
    const replay = await requestCallCancellation(prisma, input);
    expect(replay).toEqual(first);
    expect(await prisma.callEvent.count({ where: { callId: input.callId } })).toBe(1);
  });

  it.each<CallStatus>(['COMPLETED', 'FAILED', 'VOICEMAIL'])(
    'does not change an already %s call or its claim',
    async (status) => {
      const { call, claim, input } = await seed(status);

      expect(await requestCallCancellation(prisma, input)).toEqual(call);
      expect(
        await prisma.claim.findFirst({
          where: { id: claim.id, organizationId: input.organizationId },
        }),
      ).toEqual(claim);
      expect(await prisma.callEvent.count({ where: { callId: call.id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { organizationId: input.organizationId } })).toBe(
        0,
      );
    },
  );

  it('provider terminal status committed after the read wins without cancellation side effects', async () => {
    const { call, claim, input } = await seed();
    const barrier = updateBarrier();
    const pending = requestCallCancellation(barrier.client, input);
    await barrier.reached;
    let terminal;
    try {
      terminal = await prisma.call.update({
        where: { id: call.id, organizationId: input.organizationId },
        data: { status: 'COMPLETED', endedAt: REQUESTED_AT, durationSeconds: 60 },
      });
    } finally {
      barrier.release();
    }

    expect(await pending).toEqual(terminal);
    expect(
      await prisma.claim.findFirst({
        where: { id: claim.id, organizationId: input.organizationId },
      }),
    ).toEqual(claim);
    expect(await prisma.callEvent.count({ where: { callId: call.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: input.organizationId } })).toBe(
      0,
    );
  });

  it.each<ClaimStatus>(['RESOLVED', 'WRITTEN_OFF', 'NEEDS_INFO', 'MANUAL_REVIEW'])(
    'preserves an already reviewed %s claim',
    async (status) => {
      const { claim, input } = await seed('ON_HOLD', status);

      expect(await requestCallCancellation(prisma, input)).toMatchObject({
        status: 'ON_HOLD',
        cancelRequestedAt: REQUESTED_AT,
      });
      expect(
        await prisma.claim.findFirst({
          where: { id: claim.id, organizationId: input.organizationId },
        }),
      ).toEqual(claim);
      expect(
        await prisma.auditLog.findFirst({ where: { organizationId: input.organizationId } }),
      ).toMatchObject({ metadata: { claimChanged: false } });
    },
  );

  it.each<ClaimStatus>(['CALLING', 'RESOLVED'])(
    'preserves a newer %s claim version committed after the read',
    async (status) => {
      const { claim, input } = await seed();
      const barrier = updateBarrier();
      const pending = requestCallCancellation(barrier.client, input);
      await barrier.reached;
      let newer;
      try {
        newer = await prisma.claim.update({
          where: { id: claim.id, organizationId: input.organizationId },
          data: { status, updatedAt: new Date(claim.updatedAt.getTime() + 60_000) },
        });
      } finally {
        barrier.release();
      }

      expect(await pending).toMatchObject({ cancelRequestedAt: REQUESTED_AT });
      expect(
        await prisma.claim.findFirst({
          where: { id: claim.id, organizationId: input.organizationId },
        }),
      ).toEqual(newer);
      expect(
        await prisma.auditLog.findFirst({ where: { organizationId: input.organizationId } }),
      ).toMatchObject({ metadata: { claimChanged: false } });
    },
  );

  it('rolls the marker, claim, and event back if audit persistence fails', async () => {
    const { call, claim, input } = await seed();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_cancel_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'call.cancel.requested' THEN RAISE EXCEPTION 'synthetic cancellation audit outage'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_cancel_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_cancel_audit()',
    );

    await expect(requestCallCancellation(prisma, input)).rejects.toThrow();
    expect(
      await prisma.call.findFirst({ where: { id: call.id, organizationId: input.organizationId } }),
    ).toEqual(call);
    expect(
      await prisma.claim.findFirst({
        where: { id: claim.id, organizationId: input.organizationId },
      }),
    ).toEqual(claim);
    expect(await prisma.callEvent.count({ where: { callId: call.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: input.organizationId } })).toBe(
      0,
    );

    await prisma.$executeRawUnsafe('DROP TRIGGER reject_cancel_audit ON "AuditLog"');
    expect(await requestCallCancellation(prisma, input)).toMatchObject({
      cancelRequestedAt: REQUESTED_AT,
    });
  });

  it('returns null for absent or other-tenant calls without any writes', async () => {
    const { call, claim, input } = await seed();
    const other = await prisma.organization.create({
      data: { name: 'Other Test Dental', clerkOrgId: `clerk_${randomUUID()}` },
    });

    expect(
      await requestCallCancellation(prisma, { ...input, organizationId: other.id }),
    ).toBeNull();
    expect(await requestCallCancellation(prisma, { ...input, callId: 'absent-call' })).toBeNull();
    expect(
      await prisma.call.findFirst({ where: { id: call.id, organizationId: input.organizationId } }),
    ).toEqual(call);
    expect(
      await prisma.claim.findFirst({
        where: { id: claim.id, organizationId: input.organizationId },
      }),
    ).toEqual(claim);
    expect(await prisma.callEvent.count({ where: { callId: call.id } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: { in: [input.organizationId, other.id] } },
      }),
    ).toBe(0);
  });
});

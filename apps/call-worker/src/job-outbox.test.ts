import { createHash, randomUUID } from 'node:crypto';

import { prisma, type JobOutbox, type Prisma } from '@dentabill/db';
import { CallJobDataSchema, type CallJobData, type JobDispatcher } from '@dentabill/queue';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { enqueueJobOutbox, relayJobOutbox } from './job-outbox.js';

/** Real PostgreSQL, synthetic commands, in-memory transport only. */
const NOW = new Date('2030-01-01T00:00:00.000Z');
const organizationIds: string[] = [];
const clock = () => new Date(NOW);

beforeAll(async () => prisma.$connect());
afterEach(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds.splice(0) } } });
});
afterAll(async () => prisma.$disconnect());

async function organization() {
  const org = await prisma.organization.create({
    data: { clerkOrgId: `outbox_synthetic_${randomUUID()}`, name: 'Synthetic Outbox Practice' },
  });
  organizationIds.push(org.id);
  return org;
}

function callData(organizationId: string, idempotencyKey = `outbox_${randomUUID()}`): CallJobData {
  return {
    organizationId,
    claimId: `synthetic_claim_${randomUUID()}`,
    payerCode: 'DELTA_DENTAL_PPO',
    attemptNumber: 1,
    claimPriority: 80,
    idempotencyKey,
  };
}

async function enqueue(data: CallJobData, availableAt = NOW) {
  return enqueueJobOutbox(prisma, {
    organizationId: data.organizationId,
    kind: 'CALL_PLACE',
    data,
    availableAt,
  });
}

function dispatcher() {
  return {
    dispatchCall: vi.fn<JobDispatcher['dispatchCall']>().mockResolvedValue('synthetic-job'),
    dispatchSummary: vi
      .fn<JobDispatcher['dispatchSummary']>()
      .mockResolvedValue('synthetic-summary'),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function read(row: Pick<JobOutbox, 'id' | 'organizationId'>) {
  return prisma.jobOutbox.findFirstOrThrow({
    where: { id: row.id, organizationId: row.organizationId },
  });
}

describe('transactional outbox enqueue against PostgreSQL', () => {
  it('deduplicates the same scoped command and rejects a different command reusing its key', async () => {
    const org = await organization();
    const data = callData(org.id);
    const first = await enqueue(data);
    const replay = await enqueue(data);
    expect(replay.id).toBe(first.id);
    await expect(enqueue({ ...data, claimPriority: 20 })).rejects.toThrow(
      'Outbox key already belongs to a different command.',
    );
    expect(await prisma.jobOutbox.count({ where: { organizationId: org.id } })).toBe(1);
    expect(await read(first)).toEqual(first);
  });

  it('rolls domain state and its outbox command back in the same transaction', async () => {
    const org = await organization();
    const data = callData(org.id);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.organization.update({ where: { id: org.id }, data: { name: 'Rolled back' } });
        await enqueueJobOutbox(tx, { organizationId: org.id, kind: 'CALL_PLACE', data });
        throw new Error('Synthetic transaction abort');
      }),
    ).rejects.toThrow('Synthetic transaction abort');
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).toEqual(org);
    expect(await prisma.jobOutbox.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it('rejects a payload belonging to a different organization before insertion', async () => {
    const org = await organization();
    await expect(
      enqueueJobOutbox(prisma, {
        organizationId: org.id,
        kind: 'CALL_PLACE',
        data: callData('synthetic_wrong_org'),
      }),
    ).rejects.toThrow('Outbox organization mismatch.');
    expect(await prisma.jobOutbox.count({ where: { organizationId: org.id } })).toBe(0);
  });
});

describe('durable outbox relay against PostgreSQL', () => {
  it('allows only one concurrent sweep to dispatch a leased row', async () => {
    const org = await organization();
    const data = callData(org.id);
    const row = await enqueue(data);
    const response = deferred<string>();
    const queue = dispatcher();
    queue.dispatchCall.mockReturnValue(response.promise);
    const options = { prisma, jobDispatcher: queue, organizationId: org.id, clock };
    const sweeps = [relayJobOutbox(options), relayJobOutbox(options)];
    try {
      await vi.waitFor(() => {
        expect(queue.dispatchCall).toHaveBeenCalledTimes(1);
      });
      const leased = await read(row);
      expect(leased).toMatchObject({ state: 'PENDING', deliveryAttempts: 1, deliveredAt: null });
      expect(leased.leaseToken).toEqual(expect.any(String));
      expect(leased.leaseExpiresAt).toEqual(new Date(NOW.getTime() + 30_000));
      response.resolve('synthetic-accepted');
      const results = await Promise.all(sweeps);
      expect(results.reduce((sum, result) => sum + result.selected, 0)).toBe(1);
      expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(1);
      expect(queue.dispatchCall).toHaveBeenCalledWith(data, { priority: 21 });
      expect(await read(row)).toMatchObject({
        state: 'DELIVERED',
        deliveryAttempts: 1,
        deliveredAt: NOW,
        leaseToken: null,
        leaseExpiresAt: null,
      });
      expect(await relayJobOutbox(options)).toEqual({
        selected: 0,
        sent: 0,
        failed: 0,
        quarantined: 0,
      });
      expect(queue.dispatchCall).toHaveBeenCalledTimes(1);
    } finally {
      response.resolve('cleanup');
      await Promise.allSettled(sweeps);
    }
  });

  it('keeps equal command keys isolated by organization during a scoped sweep', async () => {
    const first = await organization();
    const second = await organization();
    const key = 'synthetic_same_key';
    const firstData = callData(first.id, key);
    const secondData = callData(second.id, key);
    const firstRow = await enqueue(firstData);
    const secondRow = await enqueue(secondData);
    const queue = dispatcher();
    const report = await relayJobOutbox({
      prisma,
      jobDispatcher: queue,
      organizationId: first.id,
      idempotencyKey: key,
      clock,
    });
    expect(report).toEqual({ selected: 1, sent: 1, failed: 0, quarantined: 0 });
    expect(queue.dispatchCall).toHaveBeenCalledTimes(1);
    expect(queue.dispatchCall).toHaveBeenCalledWith(firstData, { priority: 21 });
    expect(await read(firstRow)).toMatchObject({ state: 'DELIVERED' });
    expect(await read(secondRow)).toEqual(secondRow);
  });

  it('dispatches both command kinds with each row organization during a trusted global sweep', async () => {
    const first = await organization();
    const second = await organization();
    const data = callData(first.id);
    const call = await enqueue(data);
    const summaryData = {
      organizationId: second.id,
      callId: 'synthetic_call',
      promptVersion: 'v1',
      idempotencyKey: `summary_${randomUUID()}`,
    };
    const summary = await enqueueJobOutbox(prisma, {
      organizationId: second.id,
      kind: 'SUMMARY_GENERATE',
      data: summaryData,
      availableAt: NOW,
    });
    const queue = dispatcher();
    expect(await relayJobOutbox({ prisma, jobDispatcher: queue, clock })).toEqual({
      selected: 2,
      sent: 2,
      failed: 0,
      quarantined: 0,
    });
    expect(queue.dispatchCall).toHaveBeenCalledWith(data, { priority: 21 });
    expect(queue.dispatchSummary).toHaveBeenCalledWith(summaryData);
    expect(await read(call)).toMatchObject({ organizationId: first.id, state: 'DELIVERED' });
    expect(await read(summary)).toMatchObject({ organizationId: second.id, state: 'DELIVERED' });
  });

  it('persists backoff between fresh relay invocations and clears the failure only after acceptance', async () => {
    const org = await organization();
    const data = callData(org.id);
    const row = await enqueue(data);
    const queue = dispatcher();
    queue.dispatchCall.mockRejectedValue(
      new Error('Synthetic transport detail must not be stored'),
    );
    const relayAt = (elapsed: number, nextQueue = queue) =>
      relayJobOutbox({
        prisma,
        jobDispatcher: nextQueue,
        organizationId: org.id,
        clock: () => new Date(NOW.getTime() + elapsed),
      });
    expect(await relayAt(0)).toEqual({ selected: 1, sent: 0, failed: 1, quarantined: 0 });
    expect(await read(row)).toMatchObject({
      state: 'PENDING',
      deliveryAttempts: 1,
      availableAt: new Date(NOW.getTime() + 1_000),
      deliveredAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: 'DISPATCH_FAILED',
    });
    expect((await relayAt(999)).selected).toBe(0);
    expect((await relayAt(1_000)).failed).toBe(1);
    expect(await read(row)).toMatchObject({
      deliveryAttempts: 2,
      availableAt: new Date(NOW.getTime() + 3_000),
    });
    const recoveredQueue = dispatcher();
    expect((await relayAt(2_999, recoveredQueue)).selected).toBe(0);
    expect((await relayAt(3_000, recoveredQueue)).sent).toBe(1);
    expect(queue.dispatchCall).toHaveBeenCalledTimes(2);
    expect(recoveredQueue.dispatchCall).toHaveBeenCalledTimes(1);
    expect(await read(row)).toMatchObject({
      state: 'DELIVERED',
      deliveryAttempts: 3,
      lastErrorCode: null,
      deliveredAt: new Date(NOW.getTime() + 3_000),
    });
  });

  it('waits for availableAt and respects the sweep row limit', async () => {
    const org = await organization();
    const first = await enqueue(callData(org.id), new Date(NOW.getTime() + 5_000));
    const second = await enqueue(callData(org.id), new Date(NOW.getTime() + 6_000));
    const queue = dispatcher();
    const options = { prisma, jobDispatcher: queue, organizationId: org.id, limit: 1 };
    expect((await relayJobOutbox({ ...options, clock })).selected).toBe(0);
    expect(queue.dispatchCall).not.toHaveBeenCalled();
    expect(
      (await relayJobOutbox({ ...options, clock: () => new Date(NOW.getTime() + 7_000) })).sent,
    ).toBe(1);
    expect(await read(first)).toMatchObject({ state: 'DELIVERED' });
    expect(await read(second)).toEqual(second);
    expect(
      (await relayJobOutbox({ ...options, clock: () => new Date(NOW.getTime() + 7_000) })).sent,
    ).toBe(1);
    expect(queue.dispatchCall).toHaveBeenCalledTimes(2);
  });

  it.each(['schema', 'hash', 'organization', 'key'] as const)(
    'quarantines %s corruption before dispatch',
    async (corruption) => {
      const org = await organization();
      const data = callData(org.id);
      const row = await enqueue(data);
      let payload: Prisma.InputJsonValue = data;
      let payloadHash = row.payloadHash;
      if (corruption === 'schema') payload = { organizationId: org.id };
      if (corruption === 'hash') payloadHash = '0'.repeat(64);
      if (corruption === 'organization' || corruption === 'key') {
        payload = {
          ...data,
          ...(corruption === 'organization'
            ? { organizationId: 'synthetic_wrong_org' }
            : { idempotencyKey: 'synthetic_wrong_key' }),
        };
        payloadHash = createHash('sha256')
          .update(JSON.stringify(CallJobDataSchema.parse(payload)))
          .digest('hex');
      }
      await prisma.jobOutbox.updateMany({
        where: { id: row.id, organizationId: org.id },
        data: { payload, payloadHash },
      });
      const queue = dispatcher();
      expect(
        await relayJobOutbox({ prisma, jobDispatcher: queue, organizationId: org.id, clock }),
      ).toEqual({
        selected: 1,
        sent: 0,
        failed: 0,
        quarantined: 1,
      });
      expect(queue.dispatchCall).not.toHaveBeenCalled();
      expect(queue.dispatchSummary).not.toHaveBeenCalled();
      expect(await read(row)).toMatchObject({
        state: 'QUARANTINED',
        lastErrorCode: 'PAYLOAD_INVALID',
        deliveryAttempts: 0,
        deliveredAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
      });
    },
  );

  it('quarantines previously exhausted rows without another transport attempt', async () => {
    const org = await organization();
    const row = await enqueue(callData(org.id));
    await prisma.jobOutbox.updateMany({
      where: { id: row.id, organizationId: org.id },
      data: { deliveryAttempts: 10 },
    });
    const queue = dispatcher();
    expect(
      await relayJobOutbox({ prisma, jobDispatcher: queue, organizationId: org.id, clock }),
    ).toEqual({
      selected: 1,
      sent: 0,
      failed: 0,
      quarantined: 1,
    });
    expect(queue.dispatchCall).not.toHaveBeenCalled();
    expect(await read(row)).toMatchObject({
      state: 'QUARANTINED',
      lastErrorCode: 'DELIVERY_EXHAUSTED',
      deliveryAttempts: 10,
    });
  });

  it('persists the tenth failed attempt as quarantined and does not retry it later', async () => {
    const org = await organization();
    const row = await enqueue(callData(org.id));
    await prisma.jobOutbox.updateMany({
      where: { id: row.id, organizationId: org.id },
      data: { deliveryAttempts: 9 },
    });
    const queue = dispatcher();
    queue.dispatchCall.mockRejectedValue(new Error('Synthetic outage'));
    expect(
      await relayJobOutbox({ prisma, jobDispatcher: queue, organizationId: org.id, clock }),
    ).toEqual({
      selected: 1,
      sent: 0,
      failed: 1,
      quarantined: 1,
    });
    expect(await read(row)).toMatchObject({
      state: 'QUARANTINED',
      deliveryAttempts: 10,
      deliveredAt: null,
    });
    expect(
      (
        await relayJobOutbox({
          prisma,
          jobDispatcher: queue,
          organizationId: org.id,
          clock: () => new Date(NOW.getTime() + 3_600_000),
        })
      ).selected,
    ).toBe(0);
    expect(queue.dispatchCall).toHaveBeenCalledTimes(1);
  });

  it('keeps a timed-out acceptance pending and ignores its later acknowledgement', async () => {
    const org = await organization();
    const row = await enqueue(callData(org.id));
    const response = deferred<string>();
    const queue = dispatcher();
    queue.dispatchCall.mockReturnValue(response.promise);
    const result = await relayJobOutbox({
      prisma,
      jobDispatcher: queue,
      organizationId: org.id,
      clock,
      sendTimeoutMs: 20,
    });
    expect(result).toEqual({ selected: 1, sent: 0, failed: 1, quarantined: 0 });
    const pending = await read(row);
    expect(pending).toMatchObject({
      state: 'PENDING',
      lastErrorCode: 'DISPATCH_TIMEOUT',
      deliveredAt: null,
      deliveryAttempts: 1,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    response.resolve('synthetic-late-acceptance');
    await response.promise;
    expect(await read(row)).toEqual(pending);
    const nextQueue = dispatcher();
    expect(
      (
        await relayJobOutbox({
          prisma,
          jobDispatcher: nextQueue,
          organizationId: org.id,
          clock: () => pending.availableAt,
        })
      ).sent,
    ).toBe(1);
    expect(await read(row)).toMatchObject({
      state: 'DELIVERED',
      deliveryAttempts: 2,
      lastErrorCode: null,
    });
    expect(queue.dispatchCall).toHaveBeenCalledTimes(1);
    expect(nextQueue.dispatchCall).toHaveBeenCalledTimes(1);
  });

  it.each(['accept', 'reject'] as const)(
    'fences an expired owner’s late %s after another sweep acquires the lease',
    async (outcome) => {
      const org = await organization();
      const row = await enqueue(callData(org.id));
      const firstResponse = deferred<string>();
      const nextResponse = deferred<string>();
      const firstQueue = dispatcher();
      const nextQueue = dispatcher();
      firstQueue.dispatchCall.mockReturnValue(firstResponse.promise);
      nextQueue.dispatchCall.mockReturnValue(nextResponse.promise);
      let elapsed = 0;
      const options = {
        prisma,
        organizationId: org.id,
        clock: () => new Date(NOW.getTime() + elapsed),
        leaseMs: 3_000,
        sendTimeoutMs: 2_000,
      };
      const firstSweep = relayJobOutbox({ ...options, jobDispatcher: firstQueue });
      let nextSweep: ReturnType<typeof relayJobOutbox> | undefined;
      try {
        await vi.waitFor(() => {
          expect(firstQueue.dispatchCall).toHaveBeenCalledTimes(1);
        });
        const firstLease = await read(row);
        // Advance the persisted lease clock while the first transport response is held.
        elapsed = 3_001;
        nextSweep = relayJobOutbox({ ...options, jobDispatcher: nextQueue });
        await vi.waitFor(() => {
          expect(nextQueue.dispatchCall).toHaveBeenCalledTimes(1);
        });
        const nextLease = await read(row);
        expect(nextLease.leaseToken).not.toBe(firstLease.leaseToken);
        expect(nextLease).toMatchObject({
          state: 'PENDING',
          deliveryAttempts: 2,
          deliveredAt: null,
        });
        if (outcome === 'accept') firstResponse.resolve('synthetic-stale-acceptance');
        else firstResponse.reject(new Error('Synthetic stale failure'));
        expect(await firstSweep).toEqual({ selected: 1, sent: 0, failed: 0, quarantined: 0 });
        expect(await read(row)).toEqual(nextLease);
        nextResponse.resolve('synthetic-current-acceptance');
        expect(await nextSweep).toEqual({ selected: 1, sent: 1, failed: 0, quarantined: 0 });
        expect(await read(row)).toMatchObject({
          state: 'DELIVERED',
          deliveredAt: new Date(NOW.getTime() + elapsed),
          deliveryAttempts: 2,
          leaseToken: null,
          leaseExpiresAt: null,
        });
      } finally {
        firstResponse.resolve('cleanup');
        nextResponse.resolve('cleanup');
        await Promise.allSettled([firstSweep, ...(nextSweep ? [nextSweep] : [])]);
      }
    },
  );

  it('stops a sweep at its processing budget instead of dispatching the next ready row', async () => {
    const org = await organization();
    await enqueue(callData(org.id));
    const second = await enqueue(callData(org.id), new Date(NOW.getTime() + 1));
    const response = deferred<string>();
    const queue = dispatcher();
    queue.dispatchCall.mockReturnValue(response.promise);
    try {
      expect(
        await relayJobOutbox({
          prisma,
          jobDispatcher: queue,
          organizationId: org.id,
          clock: () => new Date(NOW.getTime() + 2),
          budgetMs: 150,
          sendTimeoutMs: 1_000,
        }),
      ).toEqual({ selected: 1, sent: 0, failed: 1, quarantined: 0 });
      expect(queue.dispatchCall).toHaveBeenCalledTimes(1);
      expect(await read(second)).toEqual(second);
    } finally {
      response.resolve('cleanup');
    }
  });
});

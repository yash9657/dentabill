import { createHash, randomUUID } from 'node:crypto';

import { prisma, type CallIntent } from '@dentabill/db';
import {
  FakeRetell,
  type RetellCallCandidate,
  type RetellReconciliationClient,
  type StartCallInput,
} from '@dentabill/payer-ivr';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { observeAcceptedCall, sweepDueAcceptedCalls } from './call-observer.js';

const organizations: string[] = [];
const epoch = new Date('2026-10-13T12:00:00.000Z');
async function seed() {
  const org = await prisma.organization.create({
    data: { name: 'Synthetic observer clinic', clerkOrgId: `observer_${randomUUID()}` },
  });
  organizations.push(org.id);
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      claimNumber: 'SYNTHETIC',
      patientDOBHash: 'fake',
      cdtCodes: ['D1110'],
      claimAmount: 100,
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: epoch,
      status: 'CALLING',
    },
  });
  const id = randomUUID();
  const request: StartCallInput = {
    payerCode: claim.payerCode,
    agentId: 'synthetic-agent',
    fromNumberE164: '+15555550100',
    toNumberE164: '+15555550101',
    agentMetadata: {
      practiceName: 'Synthetic',
      providerNpi: '1234567890',
      subscriberId: 'fake-member',
      dateOfService: '2026-10-01',
    },
    idempotencyKey: id,
    maxDurationMs: 60_000,
  };
  const call = await prisma.call.create({
    data: {
      organizationId: org.id,
      claimId: claim.id,
      retellCallId: `synthetic_${id}`,
      retellAgentId: request.agentId,
      status: 'INITIATED',
      startedAt: epoch,
    },
  });
  const where = { organizationId: org.id, id };
  await prisma.callIntent.create({
    data: {
      ...where,
      claimId: claim.id,
      claimVersion: claim.updatedAt,
      payerCode: claim.payerCode,
      attemptNumber: 1,
      claimPriority: 50,
      idempotencyKey: `synthetic_${id}`,
      state: 'ACCEPTED',
      callId: call.id,
      requestPayload: request,
      requestHash: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
      submittedAt: epoch,
      callDeadlineAt: new Date(epoch.getTime() + 60_000),
      nextObservationAt: epoch,
    },
  });
  const candidate: RetellCallCandidate = {
    providerCallId: call.retellCallId,
    agentId: request.agentId,
    fromNumberE164: request.fromNumberE164,
    toNumberE164: request.toNumberE164,
    intentId: id,
    callType: 'phone_call',
    direction: 'outbound',
    startedAt: epoch.toISOString(),
  };
  const ended = {
    type: 'call.ended' as const,
    retellCallId: call.retellCallId,
    endedAt: new Date(epoch.getTime() + 50_000).toISOString(),
    durationSeconds: 50,
    endReason: 'completed' as const,
  };
  const getCall = vi
    .fn<RetellReconciliationClient['getCall']>()
    .mockResolvedValue({ candidate, terminalEvent: null });
  const provider: RetellReconciliationClient = {
    getCall,
    findCallsByIntent: vi.fn().mockRejectedValue(new Error('Observer must never list/create.')),
  };
  const endCall = vi.fn().mockResolvedValue(undefined);
  const fake = new FakeRetell();
  const retellPort = {
    startCall: vi.fn().mockRejectedValue(new Error('Observer must never create.')),
    endCall,
    subscribe: fake.subscribe.bind(fake),
  };
  const read = (): Promise<CallIntent> => prisma.callIntent.findFirstOrThrow({ where });
  const run = (at = epoch, extra: Partial<Parameters<typeof observeAcceptedCall>[0]> = {}) =>
    observeAcceptedCall({
      prisma,
      organizationId: org.id,
      intentId: id,
      provider,
      retellPort,
      clock: () => at,
      ...extra,
    });
  return {
    org,
    claim,
    call,
    where,
    candidate,
    ended,
    getCall,
    provider,
    retellPort,
    endCall,
    read,
    run,
  };
}

beforeAll(async () => {
  await prisma.$connect();
});
afterEach(async () => {
  for (const organizationId of organizations.splice(0)) {
    await prisma.callIntent.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('durable accepted-call observation', () => {
  it('backfills a historical deadline and cannot restart it from observation time', async () => {
    const s = await seed();
    await prisma.callIntent.updateMany({
      where: s.where,
      data: { callDeadlineAt: null, nextObservationAt: null },
    });
    await s.run(new Date(epoch.getTime() + 120_000));
    expect((await s.read()).callDeadlineAt).toEqual(new Date(epoch.getTime() + 60_000));
    expect(s.endCall).toHaveBeenCalledWith({
      retellCallId: s.call.retellCallId,
      reason: 'duration_cap_exceeded',
    });
    expect(await s.read()).toMatchObject({
      state: 'ACCEPTED',
      stopAttempts: 1,
      stopAcknowledgedAt: expect.any(Date),
    });
    expect(await prisma.jobOutbox.count({ where: { organizationId: s.org.id } })).toBe(0);
  });

  it('bounds Stop retries, keeps ACKs nonterminal, stops automatic remote reads at confirmation expiry, and permits an explicit read', async () => {
    const s = await seed();
    const first = new Date(epoch.getTime() + 60_000);
    await s.run(first);
    await s.run(new Date(first.getTime() + 1));
    expect(s.endCall).toHaveBeenCalledTimes(1);
    await s.run(new Date(first.getTime() + 60_000));
    await s.run(new Date(first.getTime() + 120_000));
    expect(s.endCall).toHaveBeenCalledTimes(3);
    expect((await s.run(new Date(first.getTime() + 180_000))).outcome).toBe(
      'RECONCILIATION_REQUIRED',
    );
    expect(await s.read()).toMatchObject({
      state: 'ACCEPTED',
      observationErrorCode: 'STOP_ATTEMPTS_EXHAUSTED',
      completedAt: null,
    });
    const reads = s.getCall.mock.calls.length;
    const expired = new Date(first.getTime() + 300_000);
    await s.run(expired);
    expect(s.getCall).toHaveBeenCalledTimes(reads);
    expect(await s.read()).toMatchObject({
      state: 'ACCEPTED',
      observationErrorCode: 'STOP_CONFIRMATION_EXPIRED',
      nextObservationAt: new Date(expired.getTime() + 300_000),
    });
    expect(
      await prisma.call.findFirstOrThrow({ where: { id: s.call.id, organizationId: s.org.id } }),
    ).toMatchObject({ endedAt: null });
    expect(await prisma.jobOutbox.count({ where: { organizationId: s.org.id } })).toBe(0);
    s.getCall.mockResolvedValue({ candidate: s.candidate, terminalEvent: s.ended });
    expect((await s.run(expired, { forceRead: true, readOnly: true })).outcome).toBe('COMPLETED');
    expect(s.endCall).toHaveBeenCalledTimes(3);
    expect(
      await prisma.jobOutbox.count({
        where: { organizationId: s.org.id, kind: 'SUMMARY_GENERATE' },
      }),
    ).toBe(1);
  });

  it('uses an existing operator cancellation marker before the duration deadline', async () => {
    const s = await seed();
    await prisma.call.updateMany({
      where: { id: s.call.id, organizationId: s.org.id },
      data: { cancelRequestedAt: epoch },
    });
    await s.run();
    expect(s.endCall).toHaveBeenCalledWith({
      retellCallId: s.call.retellCallId,
      reason: 'operator_cancel',
    });
    expect(await s.read()).toMatchObject({
      state: 'ACCEPTED',
      stopRequestedAt: epoch,
      stopReason: 'operator_cancel',
    });
  });

  it('does not stop or acknowledge a real persisted call through a missing-key FakeRetell', async () => {
    const s = await seed();
    const fake = new FakeRetell();
    expect(
      (await s.run(new Date(epoch.getTime() + 60_000), { provider: null, retellPort: fake }))
        .outcome,
    ).toBe('RECONCILIATION_REQUIRED');
    expect(fake.endedCalls).toHaveLength(0);
    expect(await s.read()).toMatchObject({
      state: 'ACCEPTED',
      stopAttempts: 0,
      stopAcknowledgedAt: null,
      observationErrorCode: 'STOP_UNAVAILABLE',
    });
  });

  it('rejects wrong provider identity and invalid saved request hashes before a Stop', async () => {
    const s = await seed();
    s.getCall.mockResolvedValue({
      candidate: { ...s.candidate, intentId: 'foreign' },
      terminalEvent: s.ended,
    });
    await s.run(new Date(epoch.getTime() + 60_000));
    expect(s.endCall).not.toHaveBeenCalled();
    expect(await s.read()).toMatchObject({
      state: 'ACCEPTED',
      observationErrorCode: 'PROVIDER_IDENTITY_MISMATCH',
    });
    s.getCall.mockClear();
    await prisma.callIntent.updateMany({ where: s.where, data: { requestHash: 'tampered' } });
    await s.run(new Date(epoch.getTime() + 120_000));
    expect(s.getCall).not.toHaveBeenCalled();
    expect(s.endCall).not.toHaveBeenCalled();
    expect(await s.read()).toMatchObject({
      state: 'ACCEPTED',
      observationErrorCode: 'INVALID_REQUEST_SNAPSHOT',
    });
  });

  it('uses a persisted terminal source despite unavailable provider configuration and preserves a reviewed claim', async () => {
    const s = await seed();
    await prisma.callEvent.create({
      data: { callId: s.call.id, eventType: 'webhook.call.ended', data: s.ended },
    });
    await prisma.claim.updateMany({
      where: { id: s.claim.id, organizationId: s.org.id },
      data: { status: 'MANUAL_REVIEW' },
    });
    expect((await s.run(epoch, { provider: null })).outcome).toBe('COMPLETED');
    expect(s.getCall).not.toHaveBeenCalled();
    expect(s.endCall).not.toHaveBeenCalled();
    expect(
      await prisma.claim.findFirstOrThrow({ where: { id: s.claim.id, organizationId: s.org.id } }),
    ).toMatchObject({ status: 'MANUAL_REVIEW' });
    expect((await s.run()).outcome).toBe('ALREADY_PROCESSED');
    expect(await prisma.jobOutbox.count({ where: { organizationId: s.org.id } })).toBe(1);
  });

  it('isolates tenants and rejects active leases even when a manual read is requested', async () => {
    const s = await seed();
    expect((await s.run(epoch, { organizationId: 'foreign' })).outcome).toBe('BLOCKED');
    await prisma.callIntent.updateMany({
      where: s.where,
      data: {
        observationLeaseToken: 'another-owner',
        observationLeaseExpiresAt: new Date(epoch.getTime() + 60_000),
      },
    });
    const before = await s.read();
    expect((await s.run(epoch, { forceRead: true })).outcome).toBe('RESCHEDULED');
    expect(await s.read()).toEqual(before);
    expect(s.getCall).not.toHaveBeenCalled();
    expect(s.endCall).not.toHaveBeenCalled();
  });

  it('preserves bounded retry state after an ambiguous Stop failure without logging or storing the error', async () => {
    const s = await seed();
    s.endCall.mockRejectedValue(new Error('SYNTHETIC-PRIVATE-PAYLOAD'));
    await s.run(new Date(epoch.getTime() + 60_000));
    expect(await s.read()).toMatchObject({
      state: 'ACCEPTED',
      stopAttempts: 1,
      stopAcknowledgedAt: null,
      observationErrorCode: 'STOP_FAILED',
    });
    expect(JSON.stringify(await s.read())).not.toContain('SYNTHETIC-PRIVATE-PAYLOAD');
  });

  it('read-only status retrieval does not request a Stop even when the deadline passed', async () => {
    const s = await seed();
    await s.run(new Date(epoch.getTime() + 60_000), { readOnly: true });
    expect(s.getCall).toHaveBeenCalledTimes(1);
    expect(s.endCall).not.toHaveBeenCalled();
    expect((await s.read()).stopAttempts).toBe(0);
  });

  it('bounds a provider that never settles and releases ownership with a persisted retry time', async () => {
    const s = await seed();
    s.getCall.mockImplementation(() => new Promise(() => undefined));
    const result = await s.run();
    expect(result.outcome).toBe('RESCHEDULED');
    expect(await s.read()).toMatchObject({
      state: 'ACCEPTED',
      observationLeaseToken: null,
      observationLeaseExpiresAt: null,
      observationErrorCode: 'PROVIDER_LOOKUP_FAILED',
      nextObservationAt: new Date(epoch.getTime() + 30_000),
    });
    expect(s.endCall).not.toHaveBeenCalled();
  }, 15_000);

  it('a due sweep observes only eligible calls and never starts a call', async () => {
    const s = await seed();
    s.getCall.mockResolvedValue({ candidate: s.candidate, terminalEvent: s.ended });
    const result = await sweepDueAcceptedCalls({
      prisma,
      provider: s.provider,
      retellPort: s.retellPort,
      clock: () => epoch,
    });
    expect(result).toMatchObject({ selected: 1, observed: 1, terminal: 1, failed: 0 });
    expect(s.retellPort.startCall).not.toHaveBeenCalled();
    expect(s.getCall).toHaveBeenCalledTimes(1);
  });
});

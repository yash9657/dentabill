import { createHash, randomUUID } from 'node:crypto';

import { prisma } from '@dentabill/db';
import {
  StartCallInputSchema,
  type RetellCallCandidate,
  type RetellPort,
  type RetellReconciliationClient,
} from '@dentabill/payer-ivr';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { sweepDueAcceptedCalls } from './call-observer.js';

const now = new Date('2030-01-01T00:00:00.000Z');
const organizations: string[] = [];
beforeAll(async () => prisma.$connect());
afterEach(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: organizations.splice(0) } } });
});
afterAll(async () => prisma.$disconnect());

describe('independent observer scheduler regressions', () => {
  it('observes a migrated NULL due-time row ahead of a full recurring batch of known due times', async () => {
    const org = await prisma.organization.create({
      data: { clerkOrgId: `synthetic_${randomUUID()}`, name: 'Synthetic Observer Review' },
    });
    organizations.push(org.id);
    const candidates = new Map<string, RetellCallCandidate>();
    let legacyIntentId = '';
    let legacyProviderCallId = '';
    for (let index = 0; index < 6; index += 1) {
      const claim = await prisma.claim.create({
        data: {
          organizationId: org.id,
          claimNumber: `synthetic_${randomUUID()}`,
          patientDOBHash: 'synthetic',
          subscriberId: 'SYNTHETIC',
          claimAmount: '100',
          payerCode: 'CIGNA_DENTAL',
          serviceDate: new Date('2029-12-01'),
          status: 'CALLING',
        },
      });
      const call = await prisma.call.create({
        data: {
          organizationId: org.id,
          claimId: claim.id,
          retellCallId: `provider_${randomUUID()}`,
          retellAgentId: 'agent_synthetic',
        },
      });
      const id = `intent_${randomUUID()}`;
      const snapshot = StartCallInputSchema.parse({
        payerCode: claim.payerCode,
        agentId: 'agent_synthetic',
        fromNumberE164: '+15555550100',
        toNumberE164: '+15555550200',
        agentMetadata: {
          practiceName: org.name,
          providerNpi: '1234567890',
          subscriberId: 'SYNTHETIC',
          dateOfService: '2029-12-01',
        },
        idempotencyKey: id,
        maxDurationMs: 3_600_000,
      });
      await prisma.callIntent.create({
        data: {
          id,
          organizationId: org.id,
          claimId: claim.id,
          idempotencyKey: `original_${id}`,
          payerCode: claim.payerCode,
          attemptNumber: 1,
          claimPriority: 80,
          claimVersion: claim.updatedAt,
          state: 'ACCEPTED',
          callId: call.id,
          submittedAt: new Date(now.getTime() - 60_000),
          requestPayload: snapshot,
          requestHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
          callDeadlineAt: new Date(now.getTime() + 3_540_000),
          nextObservationAt: index === 5 ? null : new Date(now.getTime() - 30_000),
        },
      });
      candidates.set(call.retellCallId, {
        providerCallId: call.retellCallId,
        agentId: snapshot.agentId,
        fromNumberE164: snapshot.fromNumberE164,
        toNumberE164: snapshot.toNumberE164,
        intentId: id,
        callType: 'phone_call',
        direction: 'outbound',
        startedAt: null,
      });
      if (index === 5) {
        legacyIntentId = id;
        legacyProviderCallId = call.retellCallId;
      }
    }
    const getCall = vi.fn<RetellReconciliationClient['getCall']>(async ({ providerCallId }) => {
      const candidate = candidates.get(providerCallId);
      if (!candidate) throw new Error('Unexpected synthetic provider ID');
      return { candidate, terminalEvent: null };
    });
    const provider: RetellReconciliationClient = {
      findCallsByIntent: vi.fn(async () => []),
      getCall,
    };
    const startCall = vi.fn(async () => {
      throw new Error('Must not create a call');
    });
    const endCall = vi.fn(async () => {
      throw new Error('No call is due to stop');
    });
    const retellPort: RetellPort = {
      startCall,
      endCall,
      subscribe: () => () => undefined,
    };
    const counts = await sweepDueAcceptedCalls({
      prisma,
      provider,
      retellPort,
      clock: () => new Date(now),
      limit: 5,
      budgetMs: 25_000,
    });
    expect(counts).toMatchObject({ selected: 5, observed: 5, rescheduled: 5, failed: 0 });
    expect(getCall).toHaveBeenCalledWith(
      expect.objectContaining({ providerCallId: legacyProviderCallId }),
    );
    expect(
      await prisma.callIntent.findFirstOrThrow({
        where: { id: legacyIntentId, organizationId: org.id },
      }),
    ).toMatchObject({
      observationAttempts: 1,
      nextObservationAt: new Date(now.getTime() + 30_000),
    });
    expect(startCall).not.toHaveBeenCalled();
    expect(endCall).not.toHaveBeenCalled();
  });
});

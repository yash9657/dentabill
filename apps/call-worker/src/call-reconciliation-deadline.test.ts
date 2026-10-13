import { createHash, randomUUID } from 'node:crypto';

import { prisma } from '@dentabill/db';
import {
  StartCallInputSchema,
  type RetellCallCandidate,
  type RetellReconciliationClient,
} from '@dentabill/payer-ivr';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { reconcileCallIntent } from './call-reconciliation.js';

const now = new Date('2030-01-01T00:00:00.000Z');
const organizations: string[] = [];
beforeAll(async () => prisma.$connect());
afterEach(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: organizations.splice(0) } } });
});
afterAll(async () => prisma.$disconnect());

async function fixture(
  options: {
    maxDurationMs?: number;
    submittedAt?: Date | null;
    callDeadlineAt?: Date;
  } = {},
) {
  const org = await prisma.organization.create({
    data: { name: 'Synthetic Deadline Practice', clerkOrgId: `synthetic_${randomUUID()}` },
  });
  organizations.push(org.id);
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      claimNumber: `synthetic_${randomUUID()}`,
      patientDOBHash: 'synthetic',
      subscriberId: 'SYNTHETIC',
      claimAmount: '100',
      payerCode: 'CIGNA_DENTAL',
      serviceDate: new Date('2029-12-01'),
      status: 'MANUAL_REVIEW',
    },
  });
  const id = `intent_${randomUUID()}`;
  const snapshot = StartCallInputSchema.parse({
    payerCode: claim.payerCode,
    agentId: 'agent_synthetic',
    fromNumberE164: '+15555550100',
    toNumberE164: '+15555550200',
    agentMetadata: {
      practiceName: 'Synthetic Deadline Practice',
      providerNpi: '1234567890',
      subscriberId: 'SYNTHETIC',
      dateOfService: '2029-12-01',
    },
    idempotencyKey: id,
    ...(options.maxDurationMs === undefined ? {} : { maxDurationMs: options.maxDurationMs }),
  });
  const intent = await prisma.callIntent.create({
    data: {
      id,
      organizationId: org.id,
      claimId: claim.id,
      idempotencyKey: `original_${id}`,
      payerCode: claim.payerCode,
      attemptNumber: 1,
      claimPriority: 80,
      claimVersion: claim.updatedAt,
      state: 'UNKNOWN',
      submittedAt:
        options.submittedAt === undefined
          ? new Date('2029-12-31T23:58:00.000Z')
          : options.submittedAt,
      createdAt: new Date('2029-12-31T23:50:00.000Z'),
      ...(options.callDeadlineAt === undefined ? {} : { callDeadlineAt: options.callDeadlineAt }),
      requestPayload: snapshot,
      requestHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    },
  });
  const candidate: RetellCallCandidate = {
    providerCallId: `provider_${randomUUID()}`,
    agentId: snapshot.agentId,
    fromNumberE164: snapshot.fromNumberE164,
    toNumberE164: snapshot.toNumberE164,
    intentId: id,
    callType: 'phone_call',
    direction: 'outbound',
    startedAt: null,
  };
  const provider = {
    findCallsByIntent: vi
      .fn<RetellReconciliationClient['findCallsByIntent']>()
      .mockResolvedValue([candidate]),
    getCall: vi
      .fn<RetellReconciliationClient['getCall']>()
      .mockResolvedValue({ candidate, terminalEvent: null }),
  };
  const scope = { id, organizationId: org.id };
  return {
    intent,
    candidate,
    scope,
    provider,
    run: () =>
      reconcileCallIntent({
        prisma,
        provider,
        organizationId: org.id,
        intentId: id,
        clerkUserId: 'synthetic_reviewer',
        clock: () => new Date(now),
      }),
    read: () => prisma.callIntent.findFirstOrThrow({ where: scope }),
  };
}

describe('recovered-call observation deadlines in PostgreSQL', () => {
  it.each([
    ['legacy duration', {}, '2030-01-01T00:13:00.000Z'],
    ['saved cap already overdue', { maxDurationMs: 60_000 }, '2029-12-31T23:59:00.000Z'],
    ['missing submitted timestamp', { submittedAt: null }, '2030-01-01T00:05:00.000Z'],
    [
      'existing persisted deadline',
      { callDeadlineAt: new Date('2029-12-31T23:57:00.000Z') },
      '2029-12-31T23:57:00.000Z',
    ],
  ] as const)(
    'preserves original timing for %s and schedules immediate observation',
    async (_name, options, expectedDeadline) => {
      const s = await fixture(options);
      expect(await s.run()).toMatchObject({ outcome: 'RECOVERED' });
      expect(await s.read()).toMatchObject({
        state: 'ACCEPTED',
        callDeadlineAt: new Date(expectedDeadline),
        nextObservationAt: now,
      });
      const outbox = await prisma.jobOutbox.findFirstOrThrow({
        where: {
          organizationId: s.scope.organizationId,
          idempotencyKey: `call.resume.${s.intent.id}`,
        },
      });
      expect(outbox.state).toBe('PENDING');
    },
  );

  it.each([false, true])(
    'does not overwrite a deadline saved during lookup (original response binds=%s)',
    async (bindOriginal) => {
      const s = await fixture();
      const persistedDeadline = new Date('2029-12-31T23:56:00.000Z');
      s.provider.getCall.mockImplementationOnce(async () => {
        await prisma.$transaction(async (tx) => {
          const call = bindOriginal
            ? await tx.call.create({
                data: {
                  organizationId: s.scope.organizationId,
                  claimId: s.intent.claimId,
                  retellCallId: s.candidate.providerCallId,
                  retellAgentId: s.candidate.agentId,
                },
              })
            : null;
          await tx.callIntent.updateMany({
            where: s.scope,
            data: {
              callDeadlineAt: persistedDeadline,
              ...(call ? { state: 'ACCEPTED', callId: call.id } : {}),
            },
          });
        });
        return { candidate: s.candidate, terminalEvent: null };
      });
      expect(await s.run()).toMatchObject({
        outcome: bindOriginal ? 'ALREADY_BOUND' : 'RECOVERED',
      });
      expect(await s.read()).toMatchObject({
        callDeadlineAt: persistedDeadline,
        nextObservationAt: now,
      });
    },
  );
});

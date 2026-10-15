import { createHash, randomUUID } from 'node:crypto';

import { prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import {
  StartCallInputSchema,
  type RetellCallCandidate,
  type RetellCallEndedEvent,
  type RetellPort,
  type RetellReconciliationClient,
  type StartCallInput,
  type StartCallResult,
} from '@dentabill/payer-ivr';
import {
  asBullMqJob,
  CALL_JOB_NAME,
  CallJobDataSchema,
  type CallJobData,
  type CallJobResult,
} from '@dentabill/queue';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { reconcileCallIntent } from './call-reconciliation.js';
import { loadWorkerEnv } from './env.js';
import { createCallJobHandler } from './handler.js';

const organizations: string[] = [];
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function job(data: CallJobData) {
  return asBullMqJob<CallJobData, CallJobResult, typeof CALL_JOB_NAME>({
    id: data.idempotencyKey,
    name: CALL_JOB_NAME,
    data,
    attemptsMade: 0,
  });
}

describe('late provider create response racing positive reconciliation', () => {
  it.each(['reconciliation', 'original create'] as const)(
    'uses one binding and finalizes once when %s commits first',
    async (winner) => {
      const organization = await prisma.organization.create({
        data: {
          name: 'Synthetic Race Practice',
          clerkOrgId: `synthetic_race_${randomUUID()}`,
          npi: '1234567890',
        },
      });
      organizations.push(organization.id);
      const claim = await prisma.claim.create({
        data: {
          organizationId: organization.id,
          claimNumber: 'SYNTHETIC-RACE-CLAIM',
          subscriberId: 'SYNTHETIC-RACE-MEMBER',
          patientDOBHash: 'synthetic-no-patient',
          cdtCodes: ['D1110'],
          claimAmount: '100.00',
          payerCode: 'DELTA_DENTAL_PPO',
          serviceDate: new Date('2026-10-01T00:00:00.000Z'),
          status: 'IN_QUEUE',
          priority: 80,
        },
      });
      const data: CallJobData = {
        organizationId: organization.id,
        claimId: claim.id,
        payerCode: claim.payerCode,
        attemptNumber: 1,
        claimPriority: 80,
        idempotencyKey: `race_${randomUUID()}`,
      };
      const intent = await prisma.callIntent.create({
        data: { ...data, payerCode: claim.payerCode, claimVersion: claim.updatedAt },
      });
      let currentTime = Date.parse('2030-01-01T12:00:00.000Z');
      const startedAt = new Date(currentTime).toISOString();
      const clock = (): Date => new Date(currentTime);
      const submitted = deferred<StartCallInput>();
      const createResponse = deferred<StartCallResult>();
      const subscribed = deferred<string>();
      const startCall = vi.fn<RetellPort['startCall']>((input) => {
        submitted.resolve(input);
        return createResponse.promise;
      });
      const endCall = vi.fn<RetellPort['endCall']>(() =>
        Promise.reject(new Error('Unexpected synthetic hangup.')),
      );
      const retellPort: RetellPort = {
        startCall,
        endCall,
        // No callback emits an event: only the reconciler's durable source can finish this call.
        subscribe: vi.fn<RetellPort['subscribe']>((retellCallId) => {
          subscribed.resolve(retellCallId);
          return () => undefined;
        }),
      };
      const env = loadWorkerEnv({
        DATABASE_URL: process.env.DATABASE_URL,
        REDIS_URL: 'redis://localhost:6379/14',
        NODE_ENV: 'test',
        RETELL_API_KEY: '',
        WORKER_OUTBOUND_NUMBER: '+15555550100',
      });
      const handler = createCallJobHandler({
        prisma,
        retellPort,
        env,
        clock,
        outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
        logger: createLogger({ level: 'fatal', pretty: false }),
      });
      const original = handler(job(data), 'original-delivery');
      const actualInput = await submitted.promise;
      const submitting = await prisma.callIntent.findFirstOrThrow({
        where: { id: intent.id, organizationId: organization.id },
      });
      expect(submitting).toMatchObject({ state: 'SUBMITTING', callId: null });
      const snapshot = StartCallInputSchema.parse(submitting.requestPayload);
      expect(snapshot).toEqual(actualInput);
      expect(submitting.requestHash).toBe(
        createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
      );
      expect(await prisma.call.count({ where: { organizationId: organization.id } })).toBe(0);

      const candidate: RetellCallCandidate = {
        providerCallId: `provider_race_${randomUUID()}`,
        agentId: snapshot.agentId,
        fromNumberE164: snapshot.fromNumberE164,
        toNumberE164: snapshot.toNumberE164,
        intentId: snapshot.idempotencyKey,
        callType: 'phone_call',
        direction: 'outbound',
        startedAt,
      };
      const terminalEvent: RetellCallEndedEvent = {
        type: 'call.ended',
        retellCallId: candidate.providerCallId,
        startedAt,
        endedAt: '2030-01-01T12:01:00.000Z',
        durationSeconds: 60,
        endReason: 'agent_hangup',
        transcript: { text: 'Synthetic final source preserved.\n', turns: null },
      };
      const lookupStarted = deferred<true>();
      const lookupResponse = deferred<{
        candidate: RetellCallCandidate;
        terminalEvent: RetellCallEndedEvent;
      }>();
      const provider: RetellReconciliationClient = {
        findCallsByIntent: vi.fn(() => Promise.resolve([candidate])),
        getCall: vi.fn(() => {
          lookupStarted.resolve(true);
          return winner === 'original create'
            ? lookupResponse.promise
            : Promise.resolve({ candidate, terminalEvent });
        }),
      };
      currentTime += 60_001;
      const reconciling = reconcileCallIntent({
        prisma,
        provider,
        organizationId: organization.id,
        intentId: intent.id,
        clerkUserId: 'synthetic-race-reviewer',
        clock,
      });
      if (winner === 'original create') {
        await lookupStarted.promise;
        createResponse.resolve({ retellCallId: candidate.providerCallId, queuedAt: startedAt });
        expect(await subscribed.promise).toBe(candidate.providerCallId);
        const bound = await prisma.callIntent.findFirstOrThrow({
          where: { id: intent.id, organizationId: organization.id },
        });
        expect(bound).toMatchObject({ state: 'ACCEPTED', requestHash: submitting.requestHash });
        expect(bound.reconcileLeaseToken).not.toBeNull();
        expect(
          await prisma.callEvent.count({
            where: { callId: bound.callId ?? '', call: { organizationId: organization.id } },
          }),
        ).toBe(0);
        lookupResponse.resolve({ candidate, terminalEvent });
      }
      const recovered = await reconciling;
      expect(recovered).toMatchObject({
        outcome: winner === 'original create' ? 'ALREADY_BOUND' : 'RECOVERED',
        callId: expect.any(String),
      });
      if (!recovered.callId) throw new Error('Expected recovered call binding.');
      expect(
        await prisma.callIntent.findFirst({
          where: { id: intent.id, organizationId: organization.id },
        }),
      ).toMatchObject({ state: 'ACCEPTED', callId: recovered.callId });
      const resumeRow = await prisma.jobOutbox.findFirstOrThrow({
        where: {
          organizationId: organization.id,
          kind: 'CALL_PLACE',
          idempotencyKey: `call.resume.${intent.id}`,
        },
      });
      const resume = CallJobDataSchema.parse(resumeRow.payload);
      expect(resumeRow).toMatchObject({ state: 'PENDING', deliveryAttempts: 0 });
      expect(
        await prisma.callEvent.findFirst({
          where: {
            callId: recovered.callId,
            call: { organizationId: organization.id },
            eventType: 'call.ended',
          },
        }),
      ).toMatchObject({ data: { ...terminalEvent, source: 'retell_get_call' } });

      if (winner === 'reconciliation') {
        createResponse.resolve({ retellCallId: candidate.providerCallId, queuedAt: startedAt });
      }
      expect(await original).toMatchObject({
        outcome: 'COMPLETED',
        callId: recovered.callId,
        retellCallId: candidate.providerCallId,
        durationSeconds: 60,
      });
      expect(await handler(job(resume), 'resume-delivery')).toMatchObject({
        outcome: 'ALREADY_PROCESSED',
      });
      expect(startCall).toHaveBeenCalledTimes(1);
      expect(endCall).not.toHaveBeenCalled();
      expect(await prisma.call.count({ where: { organizationId: organization.id } })).toBe(1);
      expect(
        await prisma.callIntent.findFirst({
          where: { id: intent.id, organizationId: organization.id },
        }),
      ).toMatchObject({ state: 'TERMINAL', callId: recovered.callId });
      expect(
        await prisma.call.findFirst({
          where: { id: recovered.callId, organizationId: organization.id },
        }),
      ).toMatchObject({ status: 'COMPLETED', durationSeconds: 60 });
      expect(
        await prisma.jobOutbox.count({
          where: { organizationId: organization.id, kind: 'SUMMARY_GENERATE' },
        }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: {
            organizationId: organization.id,
            action: 'call.end',
            resourceId: recovered.callId,
          },
        }),
      ).toBe(1);
      expect(
        await prisma.auditLog.findFirst({
          where: {
            organizationId: organization.id,
            resourceId: intent.id,
            action: 'call.intent.reconciled',
          },
        }),
      ).toMatchObject({
        metadata: { outcome: winner === 'original create' ? 'ALREADY_BOUND' : 'RECOVERED' },
      });
    },
    15_000,
  );
});

import { createHash, randomUUID } from 'node:crypto';

import { prisma, type CallIntentState, type UserRole } from '@dentabill/db';
import {
  StartCallInputSchema,
  type RetellCallCandidate,
  type RetellReconciliationClient,
  type StartCallInput,
} from '@dentabill/payer-ivr';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../app.js';

const findCalls = vi.fn<RetellReconciliationClient['findCallsByIntent']>();
const getCall = vi.fn<RetellReconciliationClient['getCall']>();
const provider: RetellReconciliationClient = { findCallsByIntent: findCalls, getCall };

async function fixture(role: UserRole = 'OWNER', state: CallIntentState = 'UNKNOWN') {
  const unique = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: 'Synthetic recovery practice', clerkOrgId: `org_${unique}`, npi: '1234567890' },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      clerkUserId: `user_${unique}`,
      email: 'synthetic@example.test',
      role,
    },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: organization.id,
      patientDOBHash: 'synthetic-hash',
      subscriberId: 'SYNTHETIC-MEMBER',
      claimNumber: `SYNTHETIC-${unique}`,
      claimAmount: '120.00',
      payerCode: 'CIGNA_DENTAL',
      serviceDate: new Date('2026-01-01T00:00:00Z'),
      status: 'MANUAL_REVIEW',
      priority: 80,
    },
  });
  const intentId = `intent_${unique.replaceAll('-', '')}`;
  const requestPayload: StartCallInput = {
    payerCode: 'CIGNA_DENTAL',
    agentId: 'agent_synthetic',
    fromNumberE164: '+15555550100',
    toNumberE164: '+15555550101',
    idempotencyKey: intentId,
    agentMetadata: {
      practiceName: organization.name,
      providerNpi: '1234567890',
      subscriberId: 'SYNTHETIC-MEMBER',
      dateOfService: '2026-01-01',
    },
  };
  const intent = await prisma.callIntent.create({
    data: {
      id: intentId,
      organizationId: organization.id,
      claimId: claim.id,
      idempotencyKey: `key_${unique}`,
      payerCode: claim.payerCode,
      claimPriority: 80,
      claimVersion: claim.updatedAt,
      attemptNumber: 1,
      state,
      submittedAt: new Date(Date.now() - 120_000),
      requestPayload,
      requestHash: createHash('sha256')
        .update(JSON.stringify(StartCallInputSchema.parse(requestPayload)))
        .digest('hex'),
    },
  });
  return { organization, user, claim, intent, headers: { 'x-test-user-id': user.clerkUserId } };
}

function candidate(intentId: string): RetellCallCandidate {
  return {
    providerCallId: 'call_synthetic_recovery',
    agentId: 'agent_synthetic',
    fromNumberE164: '+15555550100',
    toNumberE164: '+15555550101',
    intentId,
    callType: 'phone_call',
    direction: 'outbound',
    startedAt: new Date(Date.now() - 90_000).toISOString(),
  };
}

interface RecoveryBody {
  intent: null | {
    id: string;
    state: string;
    callId: string | null;
    lastCheckOutcome: string | null;
    lastCheckedAt: string | null;
    nextCheckAt: string | null;
  };
  canCheck: boolean;
  canReview: boolean;
  availability: string;
  outcome?: string;
}
const body = (response: { json(): unknown }): RecoveryBody => response.json() as RecoveryBody;

describe('call recovery API with real Postgres and synthetic read-only provider', () => {
  let server: FastifyInstance;
  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    findCalls.mockReset().mockResolvedValue([]);
    getCall.mockReset();
    server = await buildServer({ logger: false, callRecoveryProvider: provider });
  });
  afterEach(async () => {
    await server.close();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
  });

  it('requires authentication on both read and action routes', async () => {
    expect(
      (await server.inject({ method: 'GET', url: '/v1/claims/missing/call-recovery' })).statusCode,
    ).toBe(401);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/v1/call-intents/missing/reconcile',
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    expect(findCalls).not.toHaveBeenCalled();
  });

  it('scopes both identifiers to the authenticated organization', async () => {
    const a = await fixture();
    const b = await fixture();
    expect(
      (
        await server.inject({
          method: 'GET',
          url: `/v1/claims/${a.claim.id}/call-recovery`,
          headers: b.headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/v1/call-intents/${a.intent.id}/reconcile`,
          headers: b.headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(findCalls).not.toHaveBeenCalled();
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('exposes a safe status projection without provider identity or the PHI request snapshot', async () => {
    const seed = await fixture();
    const response = await server.inject({
      method: 'GET',
      url: `/v1/claims/${seed.claim.id}/call-recovery`,
      headers: seed.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(body(response)).toMatchObject({
      canCheck: true,
      canReview: true,
      availability: 'AVAILABLE',
      intent: { id: seed.intent.id, state: 'UNKNOWN', callId: null },
    });
    expect(Object.keys(body(response).intent ?? {}).sort()).toEqual(
      [
        'id',
        'state',
        'attemptNumber',
        'createdAt',
        'submittedAt',
        'callId',
        'lastCheckedAt',
        'lastCheckOutcome',
        'nextCheckAt',
      ].sort(),
    );
    for (const sensitive of [
      'SYNTHETIC-MEMBER',
      'agent_synthetic',
      '+15555550100',
      seed.intent.requestHash!,
      seed.organization.name,
    ])
      expect(response.body).not.toContain(sensitive);
    expect(findCalls).not.toHaveBeenCalled();
  });

  it('allows billing staff to read uncertainty but not trigger lookup', async () => {
    const seed = await fixture('BILLING_STAFF');
    const read = await server.inject({
      method: 'GET',
      url: `/v1/claims/${seed.claim.id}/call-recovery`,
      headers: seed.headers,
    });
    expect(body(read)).toMatchObject({ canReview: false, canCheck: false });
    const action = await server.inject({
      method: 'POST',
      url: `/v1/call-intents/${seed.intent.id}/reconcile`,
      headers: seed.headers,
      payload: {},
    });
    expect(action.statusCode).toBe(403);
    expect(findCalls).not.toHaveBeenCalled();
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('reports unavailable lookup safely when no client is configured', async () => {
    await server.close();
    server = await buildServer({ logger: false, callRecoveryProvider: null });
    const seed = await fixture();
    const read = await server.inject({
      method: 'GET',
      url: `/v1/claims/${seed.claim.id}/call-recovery`,
      headers: seed.headers,
    });
    expect(body(read)).toMatchObject({
      canCheck: false,
      canReview: true,
      availability: 'NOT_CONFIGURED',
    });
    const action = await server.inject({
      method: 'POST',
      url: `/v1/call-intents/${seed.intent.id}/reconcile`,
      headers: seed.headers,
      payload: {},
    });
    expect(action.statusCode).toBe(503);
    expect(action.json()).toMatchObject({ code: 'CALL_RECONCILIATION_UNAVAILABLE' });
    expect(findCalls).not.toHaveBeenCalled();
  });

  it.each([
    { providerCallId: 'caller_selected' },
    { organizationId: 'caller_selected' },
    { intentId: 'caller_selected' },
  ])('rejects caller-controlled lookup routing %j', async (payload) => {
    const seed = await fixture();
    const response = await server.inject({
      method: 'POST',
      url: `/v1/call-intents/${seed.intent.id}/reconcile`,
      headers: seed.headers,
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(findCalls).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'ADMIN'] as const)(
    'allows %s to look up only the stored intent; no match remains blocked and cooldown is enforced',
    async (role) => {
      const seed = await fixture(role);
      const response = await server.inject({
        method: 'POST',
        url: `/v1/call-intents/${seed.intent.id}/reconcile`,
        headers: seed.headers,
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(body(response)).toMatchObject({
        outcome: 'NO_MATCH',
        canCheck: false,
        intent: {
          id: seed.intent.id,
          state: 'UNKNOWN',
          callId: null,
          lastCheckOutcome: 'NO_MATCH',
        },
      });
      expect(body(response).intent?.lastCheckedAt).not.toBeNull();
      expect(body(response).intent?.nextCheckAt).not.toBeNull();
      expect(findCalls).toHaveBeenCalledTimes(1);
      expect(findCalls.mock.calls[0]?.[0].intentId).toBe(seed.intent.id);
      const replay = await server.inject({
        method: 'POST',
        url: `/v1/call-intents/${seed.intent.id}/reconcile`,
        headers: seed.headers,
      });
      expect(replay.statusCode, replay.body).toBe(200);
      expect(body(replay).outcome).toBe('NOT_READY');
      expect(findCalls).toHaveBeenCalledTimes(1);
      expect(await prisma.call.count()).toBe(0);
      expect(await prisma.jobOutbox.count()).toBe(0);
      expect((await prisma.claim.findUniqueOrThrow({ where: { id: seed.claim.id } })).status).toBe(
        'MANUAL_REVIEW',
      );
      const audits = await prisma.auditLog.findMany({
        where: { organizationId: seed.organization.id },
      });
      expect(audits.length).toBeGreaterThan(0);
      for (const audit of audits) {
        expect(audit.metadata).toMatchObject({ clerkUserId: seed.user.clerkUserId });
      }
    },
  );

  it('serializes concurrent reviewed checks with one provider lookup', async () => {
    const seed = await fixture();
    let entered: () => void = () => undefined;
    let release: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    findCalls.mockImplementation(async () => {
      entered();
      await blocked;
      return [];
    });
    const input = {
      method: 'POST' as const,
      url: `/v1/call-intents/${seed.intent.id}/reconcile`,
      headers: seed.headers,
      payload: {},
    };
    const first = server.inject(input);
    await started;
    try {
      const second = await server.inject(input);
      expect(second.statusCode).toBe(200);
      expect(body(second)).toMatchObject({ outcome: 'IN_PROGRESS', canCheck: false });
      expect(findCalls).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    expect(body(await first).outcome).toBe('NO_MATCH');
    expect(await prisma.call.count()).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: seed.organization.id,
          action: 'call.intent.reconciliation.started',
        },
      }),
    ).toBe(1);
  });

  it('honors the submitting grace and read-side eligibility', async () => {
    const seed = await fixture('OWNER', 'SUBMITTING');
    await prisma.callIntent.update({
      where: { id: seed.intent.id, organizationId: seed.organization.id },
      data: { submittedAt: new Date() },
    });
    const read = await server.inject({
      method: 'GET',
      url: `/v1/claims/${seed.claim.id}/call-recovery`,
      headers: seed.headers,
    });
    expect(body(read).canCheck).toBe(false);
    expect(body(read).intent?.nextCheckAt).not.toBeNull();
    const response = await server.inject({
      method: 'POST',
      url: `/v1/call-intents/${seed.intent.id}/reconcile`,
      headers: seed.headers,
      payload: {},
    });
    expect(body(response).outcome).toBe('NOT_READY');
    expect(findCalls).not.toHaveBeenCalled();
  });

  it('returns a bound local call without exposing provider identity or redialing', async () => {
    const seed = await fixture();
    const found = candidate(seed.intent.id);
    findCalls.mockResolvedValue([found]);
    getCall.mockResolvedValue({ candidate: found, terminalEvent: null });
    const response = await server.inject({
      method: 'POST',
      url: `/v1/call-intents/${seed.intent.id}/reconcile`,
      headers: seed.headers,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(body(response)).toMatchObject({
      outcome: 'RECOVERED',
      canCheck: false,
      intent: { state: 'ACCEPTED' },
    });
    expect(body(response).intent?.callId).toBeTruthy();
    expect(response.body).not.toContain(found.providerCallId);
    expect(await prisma.call.count()).toBe(1);
    expect(await prisma.jobOutbox.count()).toBe(1);
    const replay = await server.inject({
      method: 'POST',
      url: `/v1/call-intents/${seed.intent.id}/reconcile`,
      headers: seed.headers,
      payload: {},
    });
    expect(body(replay).outcome).toBe('ALREADY_BOUND');
    expect(findCalls).toHaveBeenCalledTimes(1);
  });

  it('does not leak a provider error into the response or enable a new call', async () => {
    const seed = await fixture();
    findCalls.mockRejectedValue(new Error('SYNTHETIC sensitive member and credential'));
    const response = await server.inject({
      method: 'POST',
      url: `/v1/call-intents/${seed.intent.id}/reconcile`,
      headers: seed.headers,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(body(response)).toMatchObject({
      outcome: 'LOOKUP_FAILED',
      canCheck: false,
      intent: { state: 'UNKNOWN' },
    });
    expect(response.body).not.toContain('sensitive');
    expect(await prisma.call.count()).toBe(0);
  });

  it('shows no active submission once an unbound intent has been cancelled', async () => {
    const seed = await fixture('OWNER', 'CANCELLED');
    const response = await server.inject({
      method: 'GET',
      url: `/v1/claims/${seed.claim.id}/call-recovery`,
      headers: seed.headers,
    });
    expect(body(response)).toMatchObject({ intent: null, canCheck: false });
  });
});

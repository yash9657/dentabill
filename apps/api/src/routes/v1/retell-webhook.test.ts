import { createHmac } from 'node:crypto';

import { prisma } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';

/**
 * `/v1/webhooks/retell` integration tests against real Postgres.
 *
 * The webhook is unauthenticated at the Clerk layer — its only
 * gatekeeper is the HMAC-SHA256 signature. Each test crafts a
 * payload, signs it with the same `RETELL_WEBHOOK_SECRET` the API
 * loaded, and asserts the route accepts / rejects appropriately.
 *
 * `process.env.RETELL_WEBHOOK_SECRET` is set in `beforeAll` BEFORE
 * `buildServer()` so `getEnv()` snapshots the same value the test
 * computes signatures against.
 */

const TEST_SECRET = 'integration-test-retell-webhook-secret-v1';

function sign(rawBody: string | Buffer, secret = TEST_SECRET): string {
  return createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody)
    .digest('hex');
}

interface SeedResult {
  readonly orgId: string;
  readonly callId: string;
  readonly retellCallId: string;
}

async function seedOrgClaimAndCall(): Promise<SeedResult> {
  const org = await prisma.organization.create({
    data: {
      name: 'A',
      clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}`,
      npi: '1234567890',
    },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      patientDOBHash: 'hash_abc',
      claimNumber: 'CLM-WH-1',
      cdtCodes: ['D2740'],
      claimAmount: '420.00',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date('2026-01-15T00:00:00.000Z'),
      status: 'CALLING',
      priority: 80,
    },
  });
  const retellCallId = `fake_wh_${Math.random().toString(36).slice(2)}`;
  const call = await prisma.call.create({
    data: {
      organizationId: org.id,
      claimId: claim.id,
      retellCallId,
      status: 'NAVIGATING_IVR',
      attemptNumber: 1,
      startedAt: new Date(),
    },
  });
  return { orgId: org.id, callId: call.id, retellCallId };
}

interface WebhookEnvelope {
  eventId: string;
  deliveredAt: string;
  event: {
    type: string;
    retellCallId?: string;
    [k: string]: unknown;
  };
}

function envelope(retellCallId: string, eventId: string): WebhookEnvelope {
  return {
    eventId,
    deliveredAt: '2026-01-15T18:00:00.000Z',
    event: {
      type: 'call.ended',
      retellCallId,
      endedAt: '2026-01-15T18:00:30.000Z',
      durationSeconds: 30,
      endReason: 'completed',
    },
  };
}

describe('POST /v1/webhooks/retell (P3-T17)', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    process.env.RETELL_WEBHOOK_SECRET = TEST_SECRET;
    server = await buildServer({ logger: false });
    await prisma.$connect();
  });

  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog", "RetellWebhookEvent" RESTART IDENTITY CASCADE',
    );
  });

  it('rejects 401 when X-Retell-Signature header is missing', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/retell',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('rejects 401 when the signature does not match the body (tampered body)', async () => {
    const original = JSON.stringify(envelope('rcid_x', 'evt_1'));
    const goodSig = sign(original);
    // Tamper a single byte after computing the signature.
    const tampered = original.replace('30', '31'); // 30 → 31 in durationSeconds
    const response = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/retell',
      headers: { 'content-type': 'application/json', 'x-retell-signature': goodSig },
      payload: tampered,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('rejects 401 when the signature is signed with the wrong secret', async () => {
    const body = JSON.stringify(envelope('rcid_x', 'evt_2'));
    const badSig = sign(body, 'an-impostors-secret-not-the-real-one');
    const response = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/retell',
      headers: { 'content-type': 'application/json', 'x-retell-signature': badSig },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects 400 VALIDATION_ERROR for a verified body that does not match the envelope schema', async () => {
    const malformed = JSON.stringify({ eventId: 'evt_3', event: { not_a_real_event: true } });
    const sig = sign(malformed);
    const response = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/retell',
      headers: { 'content-type': 'application/json', 'x-retell-signature': sig },
      payload: malformed,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('VALIDATION_ERROR');
  });

  it('accepts a valid signed envelope, persists CallEvent + RetellWebhookEvent + Call.status', async () => {
    const { callId, retellCallId } = await seedOrgClaimAndCall();
    const body = JSON.stringify(envelope(retellCallId, 'evt_happy_1'));
    const sig = sign(body);
    const response = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/retell',
      headers: { 'content-type': 'application/json', 'x-retell-signature': sig },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ ok: true }>().ok).toBe(true);

    const wh = await prisma.retellWebhookEvent.findUnique({
      where: { eventId: 'evt_happy_1' },
    });
    expect(wh).not.toBeNull();

    const events = await prisma.callEvent.findMany({
      where: { callId, eventType: 'webhook.call.ended' },
    });
    expect(events).toHaveLength(1);

    const callAfter = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(callAfter.status).toBe('COMPLETED');
    expect(callAfter.humanReached).toBe(true);
    expect(callAfter.durationSeconds).toBe(30);
    expect(callAfter.endedAt).not.toBeNull();
  });

  it('returns 200 { replayed: true } on a duplicate eventId (idempotent re-delivery)', async () => {
    const { retellCallId } = await seedOrgClaimAndCall();
    const body = JSON.stringify(envelope(retellCallId, 'evt_replay_1'));
    const sig = sign(body);
    const headers = { 'content-type': 'application/json', 'x-retell-signature': sig };

    const first = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/retell',
      headers,
      payload: body,
    });
    expect(first.statusCode).toBe(200);

    const second = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/retell',
      headers,
      payload: body,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ replayed?: boolean }>().replayed).toBe(true);

    // Only one webhook row + one CallEvent row across two deliveries.
    const events = await prisma.callEvent.findMany({
      where: { eventType: 'webhook.call.ended' },
    });
    expect(events).toHaveLength(1);
    const whRows = await prisma.retellWebhookEvent.findMany({});
    expect(whRows).toHaveLength(1);
  });

  it('returns 200 { ignored: unknown_call } when the retellCallId has no Call row', async () => {
    const body = JSON.stringify(envelope('rcid_unknown_999', 'evt_unknown_1'));
    const sig = sign(body);
    const response = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/retell',
      headers: { 'content-type': 'application/json', 'x-retell-signature': sig },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ ignored?: string }>().ignored).toBe('unknown_call');

    // The webhook still gets logged in RetellWebhookEvent so re-delivery
    // remains a no-op.
    const wh = await prisma.retellWebhookEvent.findUniqueOrThrow({
      where: { eventId: 'evt_unknown_1' },
    });
    expect(wh.retellCallId).toBe('rcid_unknown_999');
  });

  it('handles call.error events by flipping Call.status to FAILED', async () => {
    const { callId, retellCallId } = await seedOrgClaimAndCall();
    const errorEnvelope = {
      eventId: 'evt_err_1',
      deliveredAt: '2026-01-15T18:00:00.000Z',
      event: {
        type: 'call.error',
        retellCallId,
        code: 'agent_unreachable',
        message: 'Agent did not respond',
        occurredAt: '2026-01-15T18:00:30.000Z',
      },
    };
    const body = JSON.stringify(errorEnvelope);
    const sig = sign(body);
    const response = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/retell',
      headers: { 'content-type': 'application/json', 'x-retell-signature': sig },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    const callAfter = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(callAfter.status).toBe('FAILED');
  });

  it('rejects 400 on an empty body', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/retell',
      headers: { 'content-type': 'application/json', 'x-retell-signature': sign('') },
      payload: '',
    });
    // Empty body trips the route's own VALIDATION_ERROR check, which the
    // global error handler turns into 400.
    expect(response.statusCode).toBe(400);
  });
});

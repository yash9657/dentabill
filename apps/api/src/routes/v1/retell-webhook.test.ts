import { prisma } from '@dentabill/db';
import { reconcileRetellWebhookInbox } from '@dentabill/payer-ivr';
import type { FastifyInstance } from 'fastify';
import { symmetric } from 'retell-sdk/lib/webhook_auth.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';

const TEST_SECRET = 'synthetic-retell-webhook-api-key';
const START = Date.UTC(2026, 9, 13, 12);
function ended(retellCallId: string): object {
  return {
    event: 'call_ended',
    call: {
      call_id: retellCallId,
      direction: 'outbound',
      call_status: 'ended',
      start_timestamp: START,
      end_timestamp: START + 30_123,
      duration_ms: 30_123,
      disconnection_reason: 'agent_hangup',
      transcript: 'Agent: Synthetic test.\nUser: No payment received.',
      transcript_object: [
        {
          role: 'agent',
          content: 'Synthetic test.',
          words: [{ word: 'Synthetic', start: 0.5, end: 1 }],
        },
        {
          role: 'user',
          content: 'No payment received.',
          words: [{ word: 'No', start: 2, end: 2.5 }],
        },
      ],
      call_analysis: { custom_analysis_data: { claimStatus: 'paid', amount: 99999 } },
      metadata: { organizationId: 'forged-org' },
    },
  };
}
async function seed(
  retellCallId = 'call_synthetic_wh_01',
): Promise<{ orgId: string; callId: string }> {
  const org = await prisma.organization.create({
    data: { name: 'Synthetic', clerkOrgId: `synthetic_${crypto.randomUUID()}` },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      patientDOBHash: 'synthetic',
      claimNumber: 'SYNTHETIC-1',
      cdtCodes: ['D2740'],
      claimAmount: '420',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date(START),
      status: 'CALLING',
      priority: 80,
    },
  });
  const call = await prisma.call.create({
    data: {
      organizationId: org.id,
      claimId: claim.id,
      retellCallId,
      status: 'NAVIGATING_IVR',
      startedAt: new Date(START - 5_000),
    },
  });
  return { orgId: org.id, callId: call.id };
}

describe('Retell signed wire delivery and transactional inbox (synthetic, real Postgres)', () => {
  let server: FastifyInstance;
  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    process.env.RETELL_WEBHOOK_SECRET = TEST_SECRET;
    server = await buildServer({ logger: false });
    await prisma.$connect();
  });
  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_retell_audit ON "AuditLog"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_retell_audit()');
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Organization", "RetellWebhookEvent" RESTART IDENTITY CASCADE',
    );
  });
  async function post(
    payload: object | string,
    signingKey = TEST_SECRET,
    timestamp = Date.now(),
  ): Promise<Awaited<ReturnType<typeof server.inject>>> {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return server.inject({
      method: 'POST',
      url: '/v1/webhooks/retell',
      headers: {
        'content-type': 'application/json',
        'x-retell-signature': await symmetric.sign(body, signingKey, timestamp),
      },
      payload: body,
    });
  }

  it('rejects absent, wrong-key, stale and mutated signatures before any persistence', async () => {
    const body = JSON.stringify(ended('call_unknown'));
    const unsigned = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/retell',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(unsigned.statusCode).toBe(401);
    expect((await post(body, 'wrong-key')).statusCode).toBe(401);
    expect((await post(body, TEST_SECRET, Date.now() - 300_001)).statusCode).toBe(401);
    const tampered = await server.inject({
      method: 'POST',
      url: '/v1/webhooks/retell',
      headers: {
        'content-type': 'application/json',
        'x-retell-signature': await symmetric.sign(body, TEST_SECRET, Date.now()),
      },
      payload: body.replace('99999', '99998'),
    });
    expect(tampered.statusCode).toBe(401);
    expect(await prisma.retellWebhookEvent.count()).toBe(0);
  });

  it('rejects an internal fake envelope and malformed provider fields without reflecting input', async () => {
    const malformed = await post('{"transcript":"PHI sentinel",');
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain('PHI sentinel');
    expect(malformed.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(
      (
        await post({
          eventId: 'old-fake',
          deliveredAt: new Date().toISOString(),
          event: { type: 'call.ended' },
        })
      ).statusCode,
    ).toBe(400);
    const response = await post({
      event: 'call_ended',
      call: { call_id: 'secret-text-in-field', direction: 'PHI sentinel' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('PHI sentinel');
    expect(response.body).not.toContain('secret-text-in-field');
    expect(await prisma.retellWebhookEvent.count()).toBe(0);
  });

  it('commits canonical source transcript and call state together without adopting analysis or tenant metadata', async () => {
    const { orgId, callId } = await seed();
    expect((await post(ended('call_synthetic_wh_01'))).statusCode).toBe(200);
    const receipt = await prisma.retellWebhookEvent.findUniqueOrThrow({
      where: { eventId: 'retell:call_ended:call_synthetic_wh_01' },
    });
    expect(receipt.organizationId).toBe(orgId);
    expect(receipt.processedAt).not.toBeNull();
    expect(receipt.payload).toBeNull();
    const call = await prisma.call.findFirstOrThrow({
      where: { id: callId, organizationId: orgId },
    });
    expect(call).toMatchObject({ status: 'COMPLETED', durationSeconds: 30, humanReached: false });
    expect(call.startedAt?.getTime()).toBe(START);
    const events = await prisma.callEvent.findMany({
      where: { callId, call: { organizationId: orgId } },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({
      type: 'call.ended',
      providerEndReason: 'agent_hangup',
      transcript: {
        turns: [
          { role: 'agent', text: 'Synthetic test.', startOffsetSeconds: 0.5 },
          { role: 'user', text: 'No payment received.', startOffsetSeconds: 2 },
        ],
      },
    });
    expect(JSON.stringify(events)).not.toContain('99999');
    expect(JSON.stringify(events)).not.toContain('forged-org');
    expect(
      await prisma.auditLog.count({
        where: { organizationId: orgId, action: 'call.webhook.accepted' },
      }),
    ).toBe(1);
  });

  it('deduplicates concurrent redelivery and equivalent JSON serialization using event + call ID', async () => {
    const { callId } = await seed();
    const responses = await Promise.all([
      post(ended('call_synthetic_wh_01')),
      post(JSON.stringify(ended('call_synthetic_wh_01'), null, 2)),
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(responses.filter((r) => r.json<{ replayed?: boolean }>().replayed)).toHaveLength(1);
    expect(await prisma.retellWebhookEvent.count()).toBe(1);
    expect(await prisma.callEvent.count({ where: { callId } })).toBe(1);
  });

  it('retains an early event durably, then binds only to its actual call tenant', async () => {
    const response = await post(ended('call_early'));
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ pending: true });
    expect(await prisma.callEvent.count()).toBe(0);
    const pending = await prisma.retellWebhookEvent.findUniqueOrThrow({
      where: { eventId: 'retell:call_ended:call_early' },
    });
    expect(pending.processedAt).toBeNull();
    expect(pending.organizationId).toBeNull();
    expect(pending.payload).not.toBeNull();
    const actual = await seed('call_early');
    const other = await seed('call_other_tenant');
    await reconcileRetellWebhookInbox(prisma, {
      organizationId: other.orgId,
      callId: actual.callId,
      retellCallId: 'call_early',
    });
    expect(await prisma.callEvent.count()).toBe(0);
    await reconcileRetellWebhookInbox(prisma, {
      organizationId: actual.orgId,
      callId: actual.callId,
      retellCallId: 'call_early',
    });
    expect(await prisma.callEvent.count({ where: { callId: actual.callId } })).toBe(1);
    expect(await prisma.callEvent.count({ where: { callId: other.callId } })).toBe(0);
    expect((await post(ended('call_early'))).json()).toMatchObject({ replayed: true });
  });

  it('rolls back marker, event, state and audit on a real database failure so a retry succeeds', async () => {
    const { callId, orgId } = await seed();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_retell_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'call.webhook.accepted' THEN RAISE EXCEPTION 'synthetic audit outage'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_retell_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_retell_audit()',
    );
    expect((await post(ended('call_synthetic_wh_01'))).statusCode).toBe(500);
    expect(await prisma.retellWebhookEvent.count()).toBe(0);
    expect(await prisma.callEvent.count({ where: { callId } })).toBe(0);
    expect(
      (await prisma.call.findFirstOrThrow({ where: { id: callId, organizationId: orgId } })).status,
    ).toBe('NAVIGATING_IVR');
    await prisma.$executeRawUnsafe('DROP TRIGGER reject_retell_audit ON "AuditLog"');
    expect((await post(ended('call_synthetic_wh_01'))).statusCode).toBe(200);
    expect(await prisma.callEvent.count({ where: { callId } })).toBe(1);
  });

  it('does not reopen a terminal call when a start or cumulative transcript arrives late', async () => {
    const { callId, orgId } = await seed();
    await post(ended('call_synthetic_wh_01'));
    await post({
      event: 'call_started',
      call: {
        call_id: 'call_synthetic_wh_01',
        agent_id: 'agent_synthetic',
        direction: 'outbound',
        to_number: '+12025550101',
        start_timestamp: START,
      },
    });
    const partial = {
      event: 'transcript_updated',
      call: {
        call_id: 'call_synthetic_wh_01',
        direction: 'outbound',
        transcript: 'Agent: Synthetic test.',
      },
    };
    expect((await post(partial)).statusCode).toBe(200);
    expect((await post(partial)).json()).toMatchObject({ replayed: true });
    expect(
      (await prisma.call.findFirstOrThrow({ where: { id: callId, organizationId: orgId } })).status,
    ).toBe('COMPLETED');
    expect(
      await prisma.callEvent.count({
        where: { callId, eventType: 'webhook.call.transcript_snapshot' },
      }),
    ).toBe(1);
  });

  it('records actual provider timing after cancellation while preserving the operator outcome', async () => {
    const { callId, orgId } = await seed();
    await prisma.call.updateMany({
      where: { id: callId, organizationId: orgId },
      data: {
        status: 'FAILED',
        dlqReason: 'CANCELLED_BY_OPERATOR',
        endedAt: new Date(START + 10_000),
        cancelRequestedAt: new Date(START + 10_000),
      },
    });
    expect((await post(ended('call_synthetic_wh_01'))).statusCode).toBe(200);
    const call = await prisma.call.findFirstOrThrow({
      where: { id: callId, organizationId: orgId },
    });
    expect(call).toMatchObject({
      status: 'FAILED',
      dlqReason: 'CANCELLED_BY_OPERATOR',
      durationSeconds: 30,
    });
    expect(call.endedAt?.getTime()).toBe(START + 30_123);
    expect(call.startedAt?.getTime()).toBe(START);
  });

  it('rejects changed lifecycle evidence instead of silently overwriting the first terminal receipt', async () => {
    await seed();
    await post(ended('call_synthetic_wh_01'));
    const response = await post(
      JSON.stringify(ended('call_synthetic_wh_01')).replace('agent_hangup', 'dial_busy'),
    );
    expect(response.statusCode).toBe(409);
    expect(await prisma.callEvent.count()).toBe(1);
  });

  it('acknowledges unsupported analysis without retaining or executing hidden model output', async () => {
    const response = await post({
      event: 'call_analyzed',
      call: { call_id: 'unknown', call_analysis: { text: 'PHI sentinel' } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ignored: 'unsupported_event' });
    expect(await prisma.callEvent.count()).toBe(0);
    expect(JSON.stringify(await prisma.retellWebhookEvent.findMany())).not.toContain(
      'PHI sentinel',
    );
  });
});

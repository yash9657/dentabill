import { randomUUID } from 'node:crypto';

import { prisma, type UserRole } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import { FakeClaude } from '@dentabill/summarizer';
import {
  createSummaryJobHandler,
  dispatchReviewNotification,
  loadSummaryWorkerEnv,
} from '@dentabill/summary-worker';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';

const logger = createLogger({ level: 'fatal', pretty: false });

async function scope(role: UserRole = 'OWNER') {
  const unique = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: 'Synthetic notification operations', clerkOrgId: `notification-org-${unique}` },
  });
  const actor = await prisma.user.create({
    data: {
      organizationId: organization.id,
      clerkUserId: `notification-user-${unique}`,
      email: 'recipient-private@example.test',
      role,
    },
  });
  return { organization, actor, headers: { 'x-test-user-id': actor.clerkUserId } };
}
type Scope = Awaited<ReturnType<typeof scope>>;

async function notification(s: Scope) {
  const unique = randomUUID();
  const claim = await prisma.claim.create({
    data: {
      organizationId: s.organization.id,
      claimNumber: 'PRIVATE-NOTIFICATION-SOURCE',
      patientDOBHash: 'synthetic',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date('2026-10-01'),
      claimAmount: '100.00',
      status: 'COMPLETED',
    },
  });
  const call = await prisma.call.create({
    data: {
      organizationId: s.organization.id,
      claimId: claim.id,
      retellCallId: `notification-call-${unique}`,
      status: 'COMPLETED',
      endedAt: new Date(),
    },
  });
  await prisma.callEvent.create({
    data: {
      callId: call.id,
      eventType: 'call.transcript',
      data: { role: 'representative', text: 'PRIVATE-NOTIFICATION-SOURCE needs review.' },
    },
  });
  const summarizer = new FakeClaude();
  summarizer.setDefault('DELTA_DENTAL_PPO', {
    claimStatus: 'unknown',
    denialReason: null,
    denialCode: null,
    nextAction: 'MANUAL_REVIEW',
    confidence: 0.5,
    repName: null,
    referenceNumber: null,
    callbackDate: null,
    amountApprovedCents: null,
    notes: 'PRIVATE-NOTIFICATION-SOURCE',
  });
  await createSummaryJobHandler({
    prisma,
    logger,
    summarizer,
    env: loadSummaryWorkerEnv({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL,
      REDIS_URL: 'redis://127.0.0.1:6379/15',
    }),
  })({
    id: unique,
    data: {
      organizationId: s.organization.id,
      callId: call.id,
      promptVersion: 'v1',
      idempotencyKey: `notification-${unique}`,
    },
  });
  const intent = await prisma.reviewNotificationIntent.findFirstOrThrow({
    where: { organizationId: s.organization.id, callId: call.id },
    include: { delivery: true },
  });
  return { claim, call, intent };
}

interface Row {
  id: string;
  state: string;
  recipientBinding: string;
  reason: string | null;
  attemptCount: number;
}
interface Page {
  items: Row[];
  hasMore: boolean;
  nextCursor: string | null;
  counts: Record<string, number>;
}

describe('audited review notification operations', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    await prisma.$connect();
  });
  beforeEach(async () => {
    app = await buildServer({ logger: false, callRecoveryProvider: null });
  });
  afterEach(async () => {
    await app.close();
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS notification_operations_fail_audit ON "AuditLog"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS notification_operations_fail_audit()');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(['OWNER', 'ADMIN'] as const)(
    'shows %s only safe scoped metadata and audits both reads',
    async (role) => {
      const s = await scope(role);
      const n = await notification(s);
      await notification(await scope());
      const list = await app.inject({
        method: 'GET',
        url: '/v1/operations/notifications',
        headers: s.headers,
      });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toMatchObject({
        deliveryMode: 'DISABLED',
        items: [
          {
            id: n.intent.id,
            state: 'PENDING',
            recipientBinding: 'BOUND',
            claimId: n.claim.id,
            callId: n.call.id,
            generation: 1,
            ambiguous: false,
            attemptCount: 0,
          },
        ],
        counts: { pending: 1, simulated: 0, accepted: 0, blocked: 0 },
      });
      const detail = await app.inject({
        method: 'GET',
        url: `/v1/operations/notifications/${n.intent.id}`,
        headers: s.headers,
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({
        deliveryMode: 'DISABLED',
        notification: { id: n.intent.id },
        attempts: [],
      });
      for (const response of [list.body, detail.body]) {
        for (const marker of [
          'PRIVATE-NOTIFICATION-SOURCE',
          'recipient-private@example.test',
          n.intent.deliveryKey,
          n.intent.sourceHash,
          n.intent.requestHash,
          n.intent.payloadHash ?? '',
          'payload',
          'recipientEmail',
          'deliveredAt',
        ])
          if (marker) expect(response).not.toContain(marker);
      }
      expect(
        await prisma.auditLog.count({
          where: {
            organizationId: s.organization.id,
            userId: s.actor.id,
            action: 'notification.operations_read',
          },
        }),
      ).toBe(2);
      expect(
        await prisma.reviewNotificationAttempt.count({
          where: { organizationId: s.organization.id },
        }),
      ).toBe(0);
    },
  );

  it('returns an empty page without creating work or historical notifications', async () => {
    const s = await scope();
    const list = await app.inject({
      method: 'GET',
      url: '/v1/operations/notifications',
      headers: s.headers,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      deliveryMode: 'DISABLED',
      items: [],
      hasMore: false,
      nextCursor: null,
      counts: {
        pending: 0,
        sending: 0,
        blocked: 0,
        quarantined: 0,
        simulated: 0,
        accepted: 0,
        suppressed: 0,
        agedPending: 0,
      },
    });
  });

  it('enforces authentication, stored roles and tenant scope for both paths', async () => {
    const a = await scope();
    const b = await scope();
    const staff = await scope('BILLING_STAFF');
    const n = await notification(a);
    for (const url of [
      '/v1/operations/notifications',
      `/v1/operations/notifications/${n.intent.id}`,
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url, headers: staff.headers })).statusCode).toBe(
        403,
      );
      expect(
        (
          await app.inject({
            method: 'GET',
            url,
            headers: { 'x-test-user-id': a.actor.id, 'x-test-org-id': b.organization.id },
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/operations/notifications/${n.intent.id}`,
          headers: b.headers,
        })
      ).statusCode,
    ).toBe(404);
    await prisma.user.update({
      where: { id: a.actor.id, organizationId: a.organization.id },
      data: { role: 'BILLING_STAFF' },
    });
    expect(
      (await app.inject({ method: 'GET', url: '/v1/operations/notifications', headers: a.headers }))
        .statusCode,
    ).toBe(403);
  });

  it('pages without duplicates and binds cursors to tenant and filter', async () => {
    const s = await scope();
    const first = await notification(s);
    const second = await notification(s);
    const other = await scope();
    const page1 = await app.inject({
      method: 'GET',
      url: '/v1/operations/notifications?limit=1',
      headers: s.headers,
    });
    expect(page1.statusCode).toBe(200);
    const one = page1.json<Page>();
    expect(one).toMatchObject({
      items: [{ id: first.intent.id }],
      hasMore: true,
      counts: { pending: 2 },
    });
    const cursor = encodeURIComponent(one.nextCursor ?? '');
    const page2 = await app.inject({
      method: 'GET',
      url: `/v1/operations/notifications?limit=1&cursor=${cursor}`,
      headers: s.headers,
    });
    expect(page2.statusCode).toBe(200);
    expect(page2.json<Page>()).toMatchObject({
      items: [{ id: second.intent.id }],
      hasMore: false,
      nextCursor: null,
    });
    for (const [headers, state] of [
      [s.headers, 'PENDING'],
      [other.headers, 'ALL'],
    ] as const)
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/operations/notifications?state=${state}&cursor=${cursor}`,
            headers,
          })
        ).statusCode,
      ).toBe(400);
  });

  it.each(['?limit=0', '?limit=51', '?state=DELIVERED', '?cursor=invalid', '?unexpected=true'])(
    'rejects invalid query %s',
    async (query) => {
      const s = await scope();
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/operations/notifications${query}`,
            headers: s.headers,
          })
        ).statusCode,
      ).toBe(400);
    },
  );

  it('distinguishes missing and changed immutable recipient bindings without retargeting', async () => {
    const missing = await scope('BILLING_STAFF');
    const m = await notification(missing);
    await prisma.user.update({
      where: { id: missing.actor.id, organizationId: missing.organization.id },
      data: { role: 'OWNER' },
    });
    const missingPage = await app.inject({
      method: 'GET',
      url: '/v1/operations/notifications?state=BLOCKED',
      headers: missing.headers,
    });
    expect(missingPage.json<Page>()).toMatchObject({
      items: [
        {
          id: m.intent.id,
          state: 'BLOCKED',
          reason: 'MISSING_RECIPIENT',
          recipientBinding: 'MISSING',
        },
      ],
      counts: { blocked: 1 },
    });
    const changed = await scope();
    const c = await notification(changed);
    await prisma.user.update({
      where: { id: changed.actor.id, organizationId: changed.organization.id },
      data: { email: 'changed@example.test' },
    });
    const detail = await app.inject({
      method: 'GET',
      url: `/v1/operations/notifications/${c.intent.id}`,
      headers: changed.headers,
    });
    expect(detail.json()).toMatchObject({
      notification: { recipientBinding: 'CHANGED', state: 'PENDING' },
    });
    expect(detail.body).not.toContain('changed@example.test');
    expect(
      (
        await prisma.reviewNotificationIntent.findFirstOrThrow({
          where: { organizationId: changed.organization.id, id: c.intent.id },
        })
      ).recipientEmail,
    ).toBe('recipient-private@example.test');
  });

  it('shows simulation receipts separately from acceptance or delivered mail and exposes no provider receipt', async () => {
    const s = await scope();
    const n = await notification(s);
    const result = await dispatchReviewNotification({
      prisma,
      organizationId: s.organization.id,
      notificationId: n.intent.id,
      transport: {
        kind: 'SYNTHETIC',
        async submit() {
          return Promise.resolve({
            kind: 'SIMULATED',
            receiptId: 'simulated-private-receipt',
            acceptedAt: new Date().toISOString(),
          });
        },
      },
    });
    expect(result).toMatchObject({ state: 'SIMULATED' });
    const list = await app.inject({
      method: 'GET',
      url: '/v1/operations/notifications?state=SIMULATED',
      headers: s.headers,
    });
    expect(list.json<Page>()).toMatchObject({
      counts: { simulated: 1, accepted: 0, pending: 0 },
      items: [{ state: 'SIMULATED', attemptCount: 1 }],
    });
    const detail = await app.inject({
      method: 'GET',
      url: `/v1/operations/notifications/${n.intent.id}`,
      headers: s.headers,
    });
    expect(detail.json()).toMatchObject({
      attempts: [
        { attemptNumber: 1, mode: 'SYNTHETIC', receipt: { outcome: 'SIMULATED', code: null } },
      ],
    });
    expect(detail.body).not.toContain('simulated-private-receipt');
    expect(detail.body).not.toContain('deliveredAt');
  });

  it.each(['LIST', 'DETAIL'] as const)(
    'withholds %s when the mandatory read audit fails',
    async (operation) => {
      const s = await scope();
      const n = await notification(s);
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION notification_operations_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'notification.operations_read' THEN RAISE EXCEPTION 'PRIVATE-NOTIFICATION-SOURCE'; END IF; RETURN NEW; END $$`,
      );
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER notification_operations_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION notification_operations_fail_audit()',
      );
      const url =
        operation === 'LIST'
          ? '/v1/operations/notifications'
          : `/v1/operations/notifications/${n.intent.id}`;
      const result = await app.inject({ method: 'GET', url, headers: s.headers });
      expect(result.statusCode).toBe(500);
      expect(result.body).toContain('Notifications could not be loaded.');
      for (const marker of [
        'PRIVATE-NOTIFICATION-SOURCE',
        'Prisma',
        'SELECT',
        'recipient-private',
        n.intent.id,
      ])
        expect(result.body).not.toContain(marker);
    },
  );

  it('provides no send, retry, or recipient-rebind route', async () => {
    const s = await scope();
    const n = await notification(s);
    for (const action of ['send', 'retry', 'rebind'])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/v1/operations/notifications/${n.intent.id}/${action}`,
            headers: s.headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(404);
    expect(
      await prisma.reviewNotificationAttempt.count({
        where: { organizationId: s.organization.id },
      }),
    ).toBe(0);
  });
});

import { createHash, randomUUID } from 'node:crypto';

import { prisma, type UserRole } from '@dentabill/db';
import {
  CANDIDATE_RELEASES,
  createFireworksTransport,
  releasePolicyHash,
  type GatewayRequest,
  type ModelRelease,
} from '@dentabill/model-gateway';
import {
  createDurableObservationGateway,
  publishStoredObservation,
  type ObservationRegenerationConfig,
} from '@dentabill/summary-worker';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../app.js';

const ARTIFACT = '1'.repeat(64);
const MODEL = 'accounts/synthetic/models/observation';
interface Status {
  id: string;
  state: string;
  canResume: boolean;
  observationId: string | null;
  reasonCode: string | null;
}
interface Preview {
  observationId: string;
  claimId: string;
  callId: string;
  canRegenerate: boolean;
  blockedReason: string | null;
  previewDigest: string | null;
  dataClass: string;
  source: { id: string; version: string; text: string } | null;
  release: { tokenAllowance: number; maxAttempts: number; deadlineMs: number } | null;
  activeAuthorization: Status | null;
}
interface WireInput {
  claim: { id: string; version: string };
  sources: { id: string; version: string; text: string }[];
}

function release(organizationId: string): ModelRelease {
  const candidate = CANDIDATE_RELEASES[0];
  if (!candidate) throw new Error('SYNTHETIC_RELEASE_UNAVAILABLE');
  const policy: ModelRelease['policy'] = {
    ...structuredClone(candidate.policy),
    id: 'synthetic-api-regeneration.v1',
    state: 'SYNTHETIC_EVALUATION',
    organizations: [organizationId],
    responseModels: [MODEL],
    implementationArtifactSha256: ARTIFACT,
    limits: { ...candidate.policy.limits, maxAttempts: 1, deadlineMs: 5000 },
    evidence: {
      publisherArtifactRevision: 'synthetic-publisher',
      licenseSha256: '2'.repeat(64),
      servingRevision: 'synthetic-serving',
      regionPolicyEvidenceId: 'synthetic-region',
      retentionPolicyEvidenceId: 'synthetic-retention',
      priceSnapshotId: 'synthetic-price',
      protectedDataApprovalId: null,
    },
  };
  return {
    policy,
    approval: {
      policySha256: releasePolicyHash(policy),
      reviewerId: 'synthetic-reviewer',
      evaluationId: 'synthetic-evaluation',
      runAuthorizationId: 'synthetic-local-only',
      reviewedAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2100-01-01T00:00:00.000Z',
    },
  };
}

async function seed(role: UserRole = 'OWNER') {
  const organization = await prisma.organization.create({
    data: { name: 'Synthetic regeneration practice', clerkOrgId: randomUUID() },
  });
  const actor = await prisma.user.create({
    data: {
      organizationId: organization.id,
      clerkUserId: randomUUID(),
      role,
      email: 'synthetic@example.test',
    },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: organization.id,
      claimNumber: 'SYNTHETIC-REGENERATION',
      patientDOBHash: 'synthetic',
      claimAmount: '100.00',
      payerCode: 'CIGNA_DENTAL',
      serviceDate: new Date('2026-10-01'),
      status: 'MANUAL_REVIEW',
    },
  });
  const call = await prisma.call.create({
    data: {
      organizationId: organization.id,
      claimId: claim.id,
      retellCallId: randomUUID(),
      status: 'COMPLETED',
      endedAt: new Date(),
    },
  });
  const text = 'Payer: The claim is pending review.';
  const event = await prisma.callEvent.create({
    data: {
      callId: call.id,
      eventType: 'webhook.call.ended',
      data: { transcript: { text, turns: null } },
    },
  });
  const chosen = release(organization.id);
  const request: GatewayRequest = {
    organizationId: organization.id,
    invocationId: `observation.${call.id}.g1`,
    releaseId: chosen.policy.id,
    task: 'claim-observation.v1',
    dataClass: 'SYNTHETIC',
    claim: {
      id: claim.id,
      organizationId: organization.id,
      version: claim.updatedAt.toISOString(),
      billedMinorUnits: 10000,
      currency: 'USD',
    },
    sources: [
      {
        id: `transcript.${event.id}`,
        organizationId: organization.id,
        claimId: claim.id,
        claimVersion: claim.updatedAt.toISOString(),
        version: createHash('sha256').update(text).digest('hex'),
        kind: 'FINAL_CALL_TRANSCRIPT',
        text,
      },
    ],
  };
  let failSend = false;
  const sent: WireInput[] = [];
  const observedAuthorizationIds: string[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    if (typeof init?.body !== 'string') throw new Error('SYNTHETIC_EXPECTED_NATIVE_BODY');
    const wire = JSON.parse(init.body) as { messages: { role: string; content: string }[] };
    const content = wire.messages.find((entry) => entry.role === 'user')?.content;
    if (!content) throw new Error('SYNTHETIC_EXPECTED_NATIVE_INPUT');
    const input = JSON.parse(content) as WireInput;
    sent.push(input);
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: organization.id, callId: call.id },
      orderBy: { generation: 'desc' },
    });
    expect(run.state).toBe('SUBMITTING');
    expect(
      await prisma.inferenceAttempt.count({
        where: { organizationId: organization.id, runId: run.id },
      }),
    ).toBe(1);
    if (run.generation > 1) {
      const authorization = await prisma.observationRegeneration.findFirstOrThrow({
        where: { id: run.regenerationId ?? '', organizationId: organization.id },
      });
      expect(authorization.generation).toBe(run.generation);
      expect(authorization.createdByUserId).toBe(actor.id);
      observedAuthorizationIds.push(authorization.id);
    }
    if (failSend) throw new Error('SYNTHETIC_PROVIDER_ACCEPTANCE_UNKNOWN');
    const source = input.sources[0];
    if (!source) throw new Error('SYNTHETIC_EXPECTED_SOURCE');
    const output = {
      disposition: 'OBSERVED',
      claimId: input.claim.id,
      claimVersion: input.claim.version,
      status: {
        value: 'PENDING_REPORTED',
        evidence: [
          {
            sourceId: source.id,
            sourceVersion: source.version,
            start: 0,
            end: source.text.length,
            quote: source.text,
          },
        ],
      },
      payerReportedPayment: null,
      denialCodes: [],
      proposedAction: 'FOLLOW_UP',
      abstentionReason: null,
    };
    return new Response(
      JSON.stringify({
        id: 'synthetic-response',
        model: MODEL,
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: JSON.stringify(output) },
          },
        ],
        usage: { prompt_tokens: 19, completion_tokens: 12, total_tokens: 31 },
      }),
      { status: 200 },
    );
  });
  const transport = createFireworksTransport({ fetch });
  const config: ObservationRegenerationConfig = {
    apiKey: 'synthetic-local-only',
    implementationArtifactSha256: ARTIFACT,
    dailyTokenLimit: 1_000_000,
    releases: [chosen],
    transport,
  };
  const gateway = createDurableObservationGateway({
    prisma,
    callId: call.id,
    apiKey: config.apiKey ?? '',
    implementationArtifactSha256: ARTIFACT,
    dailyTokenLimit: config.dailyTokenLimit,
    releases: [chosen],
    transport,
  });
  const result = await gateway.generate(request);
  expect(result.status).toBe('VALIDATED');
  const run = await prisma.inferenceRun.findFirstOrThrow({
    where: { organizationId: organization.id, callId: call.id, generation: 1 },
  });
  const publication = await publishStoredObservation({
    prisma,
    organizationId: organization.id,
    runId: run.id,
  });
  sent.length = 0;
  fetch.mockClear();
  return {
    organization,
    actor,
    claim,
    call,
    request,
    event,
    observation: publication.observation,
    config,
    fetch,
    sent,
    observedAuthorizationIds,
    headers: { 'x-test-user-id': actor.clerkUserId },
    failSend: (): void => {
      failSend = true;
    },
  };
}
type Seed = Awaited<ReturnType<typeof seed>>;

describe('reviewed observation regeneration API with real Postgres and injected native fetch', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    await prisma.$connect();
  });
  beforeEach(async () => {
    app = await buildServer({
      logger: false,
      callRecoveryProvider: null,
      observationRegenerationConfig: null,
    });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_EXTERNAL_REQUEST'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS reject_regeneration_audit ON "AuditLog"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_regeneration_audit()');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  async function configure(
    s: Seed,
    config: ObservationRegenerationConfig | null = s.config,
  ): Promise<void> {
    await app.close();
    app = await buildServer({
      logger: false,
      callRecoveryProvider: null,
      observationRegenerationConfig: config,
    });
  }
  async function preview(s: Seed): Promise<Preview> {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/observations/${s.observation.id}/regeneration-preview`,
      headers: s.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Preview>();
  }
  function regenerate(
    s: Seed,
    expectedPreviewDigest: string,
    idempotencyKey = randomUUID(),
    extra: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: `/v1/observations/${s.observation.id}/regenerate`,
      headers: s.headers,
      payload: {
        expectedPreviewDigest,
        idempotencyKey,
        reason: 'Synthetic corrected finding review.',
        ...extra,
      },
    });
  }
  function resume(s: Seed, id: string, payload: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: `/v1/observation-regenerations/${id}/resume`,
      headers: s.headers,
      payload,
    });
  }

  it.each(['OWNER', 'ADMIN'] as const)(
    'allows stored %s to authorize exactly one bounded generation and replay it after reload',
    async (role) => {
      const s = await seed(role);
      await configure(s);
      const reviewed = await preview(s);
      expect(reviewed).toMatchObject({
        canRegenerate: true,
        blockedReason: null,
        dataClass: 'SYNTHETIC',
        source: { text: s.request.sources[0]?.text },
        release: { maxAttempts: 1, deadlineMs: 5000 },
      });
      expect(reviewed.release?.tokenAllowance).toBeGreaterThan(0);
      expect(s.fetch).not.toHaveBeenCalled();
      const key = randomUUID();
      const digest = reviewed.previewDigest ?? '';
      const result = await regenerate(s, digest, key);
      expect(result.statusCode, result.body).toBe(200);
      const status = result.json<Status>();
      expect(status).toMatchObject({ state: 'PUBLISHED', canResume: false, reasonCode: null });
      expect(s.observedAuthorizationIds).toEqual([status.id]);
      expect(s.fetch).toHaveBeenCalledTimes(1);
      expect(
        await prisma.claim.findFirst({
          where: { id: s.claim.id, organizationId: s.organization.id },
        }),
      ).toEqual(s.claim);
      expect(
        await prisma.claimObservation.findFirst({
          where: { id: s.observation.id, organizationId: s.organization.id },
        }),
      ).toEqual(s.observation);
      expect(
        await prisma.claimObservation.count({ where: { organizationId: s.organization.id } }),
      ).toBe(2);
      expect((await preview(s)).activeAuthorization).toMatchObject({
        id: status.id,
        state: 'PUBLISHED',
      });
      expect((await regenerate(s, digest, key)).json()).toEqual(status);
      expect((await resume(s, status.id)).json()).toEqual(status);
      expect(s.fetch).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
    20_000,
  );

  it('rejects billing staff spending even with a spoofed role and keeps other tenants undiscoverable', async () => {
    const owner = await seed();
    const staff = await seed('BILLING_STAFF');
    await configure(owner);
    const p = await preview(owner);
    const statusResponse = await regenerate(owner, p.previewDigest ?? '');
    const status = statusResponse.json<Status>();
    for (const [method, url, payload] of [
      ['GET', `/v1/observations/${owner.observation.id}/regeneration-preview`, undefined],
      [
        'POST',
        `/v1/observations/${owner.observation.id}/regenerate`,
        {
          expectedPreviewDigest: p.previewDigest,
          idempotencyKey: randomUUID(),
          reason: 'Synthetic',
        },
      ],
      ['POST', `/v1/observation-regenerations/${status.id}/resume`, {}],
    ] as const) {
      const forbidden = await app.inject({
        method,
        url,
        headers: { ...staff.headers, 'x-role': 'OWNER' },
        ...(payload ? { payload } : {}),
      });
      expect(forbidden.statusCode).toBe(403);
    }
    const other = await seed();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/observations/${owner.observation.id}/regeneration-preview`,
          headers: other.headers,
        })
      ).statusCode,
    ).toBe(404);
    expect((await resume(other, status.id)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/observations/${owner.observation.id}/regeneration-preview`,
        })
      ).statusCode,
    ).toBe(401);
  });

  it('keeps credentials and artifact settings from promoting candidate releases', async () => {
    const s = await seed();
    await configure(s, {
      apiKey: 'synthetic-candidate-key',
      implementationArtifactSha256: ARTIFACT,
      dailyTokenLimit: 1_000_000,
    });
    expect(await preview(s)).toMatchObject({
      canRegenerate: false,
      blockedReason: 'RELEASE_UNAVAILABLE',
    });
    expect((await regenerate(s, 'a'.repeat(64))).statusCode).toBe(503);
    expect(
      await prisma.observationRegeneration.count({ where: { organizationId: s.organization.id } }),
    ).toBe(0);
    expect(s.fetch).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a stale preview before any authorization or send, then permits review of the corrected source', async () => {
    const s = await seed();
    await configure(s);
    const before = await preview(s);
    await prisma.callEvent.create({
      data: {
        callId: s.call.id,
        eventType: 'webhook.call.ended',
        timestamp: new Date(Date.now() + 1000),
        data: { transcript: { text: 'Payer: The claim is still pending review.', turns: null } },
      },
    });
    expect((await regenerate(s, before.previewDigest ?? '')).statusCode).toBe(409);
    expect(
      await prisma.observationRegeneration.count({ where: { organizationId: s.organization.id } }),
    ).toBe(0);
    const corrected = await preview(s);
    expect(corrected.canRegenerate).toBe(true);
    expect(corrected.previewDigest).not.toBe(before.previewDigest);
    expect((await regenerate(s, corrected.previewDigest ?? '')).statusCode).toBe(200);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it('holds an ambiguous send for review and never resubmits it through key replay or resume', async () => {
    const s = await seed();
    await configure(s);
    const p = await preview(s);
    s.failSend();
    const key = randomUUID();
    const first = await regenerate(s, p.previewDigest ?? '', key);
    expect(first.statusCode, first.body).toBe(200);
    const status = first.json<Status>();
    expect(status.state).toBe('REVIEW_REQUIRED');
    expect((await preview(s)).activeAuthorization).toMatchObject({
      id: status.id,
      state: 'REVIEW_REQUIRED',
    });
    expect((await regenerate(s, p.previewDigest ?? '', key)).json<Status>().id).toBe(status.id);
    expect((await resume(s, status.id)).json<Status>().state).toBe('REVIEW_REQUIRED');
    expect(s.fetch).toHaveBeenCalledTimes(1);
    expect(
      await prisma.inferenceRun.count({
        where: { organizationId: s.organization.id, callId: s.call.id },
      }),
    ).toBe(2);
  });

  it('requires exact same-key payload and rejects caller-selected provider or execution controls', async () => {
    const s = await seed();
    await configure(s);
    const p = await preview(s);
    const key = randomUUID();
    const completed = await regenerate(s, p.previewDigest ?? '', key);
    expect(completed.statusCode).toBe(200);
    const status = completed.json<Status>();
    expect(
      (
        await regenerate(s, p.previewDigest ?? '', key, {
          reason: 'Different authorization reason.',
        })
      ).statusCode,
    ).toBe(409);
    for (const extra of [
      { releaseId: 'caller' },
      { model: MODEL },
      { source: 'caller' },
      { dataClass: 'PROTECTED' },
      { generation: 3 },
      { reason: ' ' },
      { reason: 'x'.repeat(1001) },
      { idempotencyKey: 'https://caller' },
    ])
      expect((await regenerate(s, p.previewDigest ?? '', randomUUID(), extra)).statusCode).toBe(
        400,
      );
    expect((await resume(s, status.id, { generation: 99 })).statusCode).toBe(400);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it('rolls authorization back when its audit fails and returns no evidence if read auditing fails', async () => {
    const s = await seed();
    await configure(s);
    const p = await preview(s);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_regeneration_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC-PRIVATE-AUDIT-FAILURE'; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_regeneration_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_regeneration_audit()',
    );
    const response = await regenerate(s, p.previewDigest ?? '');
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('SYNTHETIC-PRIVATE-AUDIT-FAILURE');
    expect(
      await prisma.observationRegeneration.count({ where: { organizationId: s.organization.id } }),
    ).toBe(0);
    expect(s.fetch).not.toHaveBeenCalled();
    const read = await app.inject({
      method: 'GET',
      url: `/v1/observations/${s.observation.id}/regeneration-preview`,
      headers: s.headers,
    });
    expect(read.statusCode).toBe(500);
    expect(read.body).not.toContain(s.request.sources[0]?.text);
  });

  it('audits preview and execution reads without transcript, operator reason, key, or request body', async () => {
    const s = await seed();
    await configure(s);
    const p = await preview(s);
    const result = await regenerate(s, p.previewDigest ?? '', randomUUID(), {
      reason: 'SYNTHETIC-PRIVATE-REASON',
    });
    expect(result.statusCode).toBe(200);
    const reads = await prisma.auditLog.findMany({
      where: { organizationId: s.organization.id, action: 'observationRegeneration.accessed' },
    });
    expect(reads).toHaveLength(2);
    for (const row of reads) {
      expect(row.userId).toBe(s.actor.id);
      expect(Object.keys(row.metadata as object)).toEqual(['operation']);
    }
    expect(JSON.stringify(reads)).not.toContain(s.request.sources[0]?.text);
    expect(JSON.stringify(reads)).not.toContain('SYNTHETIC-PRIVATE-REASON');
    expect(JSON.stringify(reads)).not.toContain('synthetic-local-only');
    expect(JSON.stringify(reads)).not.toContain('requestPayload');
  });

  it('concurrent same-key requests share one authorization and one native send', async () => {
    const s = await seed();
    await configure(s);
    const p = await preview(s);
    const key = randomUUID();
    const results = await Promise.all([
      regenerate(s, p.previewDigest ?? '', key),
      regenerate(s, p.previewDigest ?? '', key),
    ]);
    expect(results.map((result) => result.statusCode)).toEqual([200, 200]);
    expect(results[0].json<Status>().id).toBe(results[1].json<Status>().id);
    expect(
      await prisma.observationRegeneration.count({ where: { organizationId: s.organization.id } }),
    ).toBe(1);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it('bounds the HTTP response while database admission is blocked and never sends after the late commit', async () => {
    const s = await seed();
    await configure(s);
    const p = await preview(s);
    const originalSetTimeout = globalThis.setTimeout;
    let fireDeadline: (() => void) | undefined;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, ms, ...args) => {
      if (ms === 30_000)
        fireDeadline = () => {
          callback(...args);
        };
      return originalSetTimeout(callback, ms, ...args);
    });
    let unlock: (() => void) | undefined;
    const unlocked = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    let markLocked: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${s.organization.id} FOR NO KEY UPDATE`;
        markLocked?.();
        await unlocked;
      },
      { timeout: 20_000 },
    );
    await locked;
    try {
      const pending = regenerate(s, p.previewDigest ?? '').then((response) => response);
      await vi.waitFor(async () => {
        const waiting = await prisma.$queryRaw<{ count: bigint }[]>`
          SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%FOR NO KEY UPDATE%'
        `;
        expect(waiting[0]?.count).toBeGreaterThan(0n);
        expect(fireDeadline).toBeTypeOf('function');
      });
      fireDeadline?.();
      const timedOut = await pending;
      expect(timedOut.statusCode).toBe(503);
      expect(timedOut.body).toContain('Check its saved status');
      expect(s.fetch).not.toHaveBeenCalled();
    } finally {
      unlock?.();
      await blocker;
    }
    await vi.waitFor(async () => {
      const saved = await prisma.observationRegeneration.findFirst({
        where: { organizationId: s.organization.id },
      });
      expect(saved).not.toBeNull();
      expect((await preview(s)).activeAuthorization).toMatchObject({
        id: saved?.id,
        state: 'READY',
      });
    });
    expect(s.fetch).not.toHaveBeenCalled();
    expect(await prisma.inferenceRun.count({ where: { organizationId: s.organization.id } })).toBe(
      1,
    );
  }, 20_000);

  it('recovers the same completed authorization after response auditing fails without sending again', async () => {
    const s = await seed();
    await configure(s);
    const p = await preview(s);
    const key = randomUUID();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_regeneration_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'observationRegeneration.accessed' AND NEW.metadata->>'operation' = 'REGENERATE' THEN RAISE EXCEPTION 'SYNTHETIC-PRIVATE-RESPONSE-FAILURE'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_regeneration_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_regeneration_audit()',
    );
    const lost = await regenerate(s, p.previewDigest ?? '', key);
    expect(lost.statusCode).toBe(500);
    expect(lost.body).not.toContain('SYNTHETIC-PRIVATE-RESPONSE-FAILURE');
    const discovered = await preview(s);
    expect(discovered.activeAuthorization?.state).toBe('PUBLISHED');
    await prisma.$executeRawUnsafe('DROP TRIGGER reject_regeneration_audit ON "AuditLog"');
    const retried = await regenerate(s, p.previewDigest ?? '', key);
    expect(retried.statusCode).toBe(200);
    expect(retried.json<Status>().id).toBe(discovered.activeAuthorization?.id);
    expect(s.fetch).toHaveBeenCalledTimes(1);
    expect(
      await prisma.claimObservation.count({ where: { organizationId: s.organization.id } }),
    ).toBe(2);
  });
});

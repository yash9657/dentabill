import { createHash, randomUUID } from 'node:crypto';

import {
  beginFireworksAttempt,
  finalizeFireworksInference,
  finishFireworksAttempt,
  prisma,
  recordFireworksResponse,
  reserveFireworksInferenceRun,
  type Claim,
  type Prisma,
  type UserRole,
} from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../app.js';

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
async function seed(role: UserRole = 'OWNER') {
  const unique = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: 'Synthetic observation practice', clerkOrgId: `org_${unique}` },
  });
  const actor = await prisma.user.create({
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
      claimNumber: 'SYNTHETIC-OBSERVATION',
      patientDOBHash: 'synthetic',
      payerCode: 'CIGNA_DENTAL',
      claimAmount: '100.00',
      serviceDate: new Date('2026-10-01'),
      status: 'MANUAL_REVIEW',
    },
  });
  const native = await receipt(claim);
  return {
    organization,
    actor,
    claim,
    ...native,
    headers: { 'x-test-user-id': actor.clerkUserId },
  };
}
async function receipt(claim: Claim, createdAt = new Date(), invalidEvidence = false) {
  const call = await prisma.call.create({
    data: {
      organizationId: claim.organizationId,
      claimId: claim.id,
      retellCallId: `synthetic_${randomUUID()}`,
      status: 'COMPLETED',
      createdAt,
      endedAt: createdAt,
    },
  });
  const text = 'Payer: The claim is pending review.';
  const finalEvent = await prisma.callEvent.create({
    data: {
      callId: call.id,
      eventType: 'webhook.call.ended',
      data: { transcript: { text, turns: null } },
    },
  });
  const source = {
    id: `transcript.${finalEvent.id}`,
    organizationId: claim.organizationId,
    claimId: claim.id,
    claimVersion: claim.updatedAt.toISOString(),
    version: createHash('sha256').update(text).digest('hex'),
    kind: 'FINAL_CALL_TRANSCRIPT',
    text,
  };
  const request = {
    organizationId: claim.organizationId,
    invocationId: `observation.${call.id}`,
    releaseId: 'synthetic-api-observation.v1',
    task: 'claim-observation.v1',
    dataClass: 'SYNTHETIC',
    claim: {
      id: claim.id,
      organizationId: claim.organizationId,
      version: claim.updatedAt.toISOString(),
      billedMinorUnits: 10000,
      currency: 'USD',
    },
    sources: [source],
  };
  const usage = { inputTokens: 19, outputTokens: 12, totalTokens: 31, cachedInputTokens: null };
  const attempt = {
    index: 1,
    httpStatus: 200,
    outcome: 'COMPLETED' as const,
    acceptance: 'RESPONDED' as const,
    elapsedMs: 1.5,
    usage,
  };
  const result = {
    status: 'VALIDATED',
    output: {
      disposition: 'OBSERVED',
      claimId: claim.id,
      claimVersion: claim.updatedAt.toISOString(),
      status: {
        value: 'PENDING_REPORTED',
        evidence: [
          {
            sourceId: source.id,
            sourceVersion: source.version,
            start: 0,
            end: source.text.length,
            quote: invalidEvidence ? 'Synthetic invented evidence.' : source.text,
          },
        ],
      },
      payerReportedPayment: null,
      denialCodes: [],
      proposedAction: 'FOLLOW_UP',
      abstentionReason: null,
    },
    requiresHumanReview: true,
    provenance: {
      kind: 'FIREWORKS',
      releaseId: request.releaseId,
      task: request.task,
      promptVersion: 'claim-observation-prompt.v1',
      schemaVersion: 'claim-observation-schema.v1',
      responseId: 'synthetic-response',
      model: 'synthetic-model',
      attempts: [attempt],
      usage,
      elapsedMs: 2,
    },
  };
  const reserved = await reserveFireworksInferenceRun(prisma, {
    organizationId: claim.organizationId,
    callId: call.id,
    claimId: claim.id,
    claimVersion: claim.updatedAt,
    sourceHash: hash(request.sources),
    requestHash: hash(request),
    releasePolicyHash: 'a'.repeat(64),
    wireRequestHash: 'b'.repeat(64),
    releaseId: request.releaseId,
    promptVersion: result.provenance.promptVersion,
    requestPayload: request,
    reservationTokens: 1000,
    dailyTokenLimit: 100_000,
    maxAttempts: 1,
    executionDeadlineAt: new Date(Date.now() + 30_000),
  });
  if (reserved.kind !== 'OWNED') throw new Error('SYNTHETIC_EXPECTED_OWNED_RUN');
  const ownership = {
    organizationId: claim.organizationId,
    runId: reserved.run.id,
    leaseToken: reserved.leaseToken,
  };
  await beginFireworksAttempt(prisma, {
    ...ownership,
    attemptNumber: 1,
    wireRequestHash: 'b'.repeat(64),
  });
  await recordFireworksResponse(prisma, {
    ...ownership,
    attemptNumber: 1,
    response: { status: 200, body: JSON.stringify(result), retryDelayMs: 0 },
  });
  await finishFireworksAttempt(prisma, { ...ownership, attempt, errorCode: null });
  const run = await finalizeFireworksInference(prisma, {
    ...ownership,
    status: 'VALIDATED',
    resultPayload: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
    errorCode: null,
  });
  return { call, run, request, result };
}
interface Observation {
  id: string;
  callId: string;
  digest: string;
  claimVersion: string;
  version: number;
  dataClass: string;
  canReview: boolean;
  isCurrent: boolean;
  staleReason: string | null;
  review: { decision: string; note: string | null; reviewedByUserId: string } | null;
  output: { payerReportedPayment: unknown; status: { value: string } };
  sources: { id: string; text: string }[];
  provenance: { kind: string; usage: { cachedInputTokens: number | null } };
}
interface Page {
  items: Observation[];
  nextCursor: string | null;
  hasMore: boolean;
  publishableCalls: { callId: string }[];
}
type Seed = Awaited<ReturnType<typeof seed>>;

describe('claim observations API with real Postgres', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    await prisma.$connect();
  });
  beforeEach(async () => {
    app = await buildServer({ logger: false, callRecoveryProvider: null });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('UNEXPECTED_SYNTHETIC_NETWORK_REQUEST'),
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS reject_observation_review_audit ON "AuditLog"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_observation_review_audit()');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  async function publish(s: Seed, callId = s.call.id): Promise<Observation> {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/calls/${callId}/observations/publish`,
      headers: s.headers,
      payload: {},
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<Observation>();
  }
  async function list(s: Seed, suffix = ''): Promise<Page> {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/claims/${s.claim.id}/observations${suffix}`,
      headers: s.headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Page>();
  }
  function review(s: Seed, row: Observation, extra: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: `/v1/observations/${row.id}/review`,
      headers: s.headers,
      payload: {
        expectedDigest: row.digest,
        expectedClaimVersion: row.claimVersion,
        decision: 'ACKNOWLEDGED',
        ...extra,
      },
    });
  }

  it.each(['OWNER', 'ADMIN', 'BILLING_STAFF'] as const)(
    'allows stored %s role to publish and acknowledge without financial or work-state changes',
    async (role) => {
      const s = await seed(role);
      const legacy = await prisma.callSummary.create({
        data: {
          organizationId: s.organization.id,
          callId: s.call.id,
          claimStatus: 'pending',
          nextAction: 'MANUAL_REVIEW',
          amountApproved: null,
          rawTranscript: 'Synthetic legacy transcript',
          claudeSummary: 'Synthetic legacy summary',
        },
      });
      expect((await list(s)).publishableCalls).toEqual([
        { callId: s.call.id, createdAt: expect.any(String) },
      ]);
      const row = await publish(s);
      expect(row).toMatchObject({
        canReview: true,
        isCurrent: true,
        staleReason: null,
        dataClass: 'SYNTHETIC',
        provenance: { kind: 'FIREWORKS', usage: { cachedInputTokens: null } },
        output: { payerReportedPayment: null },
        review: null,
      });
      const acknowledged = await review(s, row);
      expect(acknowledged.statusCode, acknowledged.body).toBe(200);
      expect(acknowledged.json()).toMatchObject({
        canReview: false,
        staleReason: 'ALREADY_REVIEWED',
        review: { decision: 'ACKNOWLEDGED', note: null, reviewedByUserId: s.actor.id },
      });
      expect(
        await prisma.claim.findFirst({
          where: { id: s.claim.id, organizationId: s.organization.id },
        }),
      ).toEqual(s.claim);
      expect(
        await prisma.callSummary.findFirst({
          where: { id: legacy.id, organizationId: s.organization.id },
        }),
      ).toEqual(legacy);
      expect((await list(s)).publishableCalls).toEqual([]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );

  it('keeps publication and identical concurrent review idempotent', async () => {
    const s = await seed();
    const publications = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/v1/calls/${s.call.id}/observations/publish`,
        headers: s.headers,
      }),
      app.inject({
        method: 'POST',
        url: `/v1/calls/${s.call.id}/observations/publish`,
        headers: s.headers,
      }),
    ]);
    expect(publications.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    const row = publications[0].json<Observation>();
    const responses = await Promise.all([review(s, row), review(s, row)]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(
      await prisma.claimObservation.count({ where: { organizationId: s.organization.id } }),
    ).toBe(1);
    expect(
      await prisma.claimObservationReview.count({ where: { organizationId: s.organization.id } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: s.organization.id, action: 'claimObservation.reviewed' },
      }),
    ).toBe(1);
  });

  it('returns no other tenant history, saved result, or review', async () => {
    const s = await seed();
    const other = await seed();
    const row = await publish(s);
    for (const [method, url, payload] of [
      ['GET', `/v1/claims/${s.claim.id}/observations`, undefined],
      ['POST', `/v1/calls/${s.call.id}/observations/publish`, {}],
      [
        'POST',
        `/v1/observations/${row.id}/review`,
        {
          expectedDigest: row.digest,
          expectedClaimVersion: row.claimVersion,
          decision: 'ACKNOWLEDGED',
        },
      ],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: other.headers,
        ...(payload ? { payload } : {}),
      });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain(s.request.sources[0]?.text);
    }
    const unauthenticated = await app.inject({
      method: 'GET',
      url: `/v1/claims/${s.claim.id}/observations`,
    });
    expect(unauthenticated.statusCode).toBe(401);
  });

  it('rejects digest/version mismatches and changing a completed review', async () => {
    const s = await seed();
    const row = await publish(s);
    expect((await review(s, row, { expectedDigest: '0'.repeat(64) })).statusCode).toBe(409);
    expect(
      (await review(s, row, { expectedClaimVersion: '2000-01-01T00:00:00.000Z' })).statusCode,
    ).toBe(409);
    expect(
      (await review(s, row, { decision: 'DISMISSED', note: 'Synthetic evidence is incomplete.' }))
        .statusCode,
    ).toBe(200);
    expect((await review(s, row)).statusCode).toBe(409);
    expect((await list(s)).items[0]?.review).toMatchObject({
      decision: 'DISMISSED',
      note: 'Synthetic evidence is incomplete.',
    });
  });

  it('blocks stale claim versions without modifying the newer claim', async () => {
    const s = await seed();
    const row = await publish(s);
    await prisma.claim.updateMany({
      where: { id: s.claim.id, organizationId: s.organization.id },
      data: { status: 'WRITTEN_OFF', updatedAt: new Date(s.claim.updatedAt.getTime() + 1000) },
    });
    expect((await list(s)).items[0]).toMatchObject({
      canReview: false,
      staleReason: 'CLAIM_CHANGED',
    });
    expect((await review(s, row)).statusCode).toBe(409);
    expect(
      await prisma.claim.findFirst({
        where: { id: s.claim.id, organizationId: s.organization.id },
        select: { status: true },
      }),
    ).toEqual({ status: 'WRITTEN_OFF' });
  });

  it('blocks newer-call evidence gaps, and delayed older publication cannot supersede reviewed current evidence', async () => {
    const s = await seed();
    const newer = await receipt(s.claim, new Date(s.call.createdAt.getTime() + 1000));
    const current = await publish(s, newer.call.id);
    expect((await review(s, current)).statusCode).toBe(200);
    const delayed = await publish(s);
    expect(delayed).toMatchObject({
      version: 2,
      isCurrent: false,
      canReview: false,
      staleReason: 'SUPERSEDED',
    });
    expect((await review(s, delayed)).statusCode).toBe(409);
    const page = await list(s, '?limit=1');
    expect(page.items[0]?.id).toBe(delayed.id);
    expect(page.hasMore).toBe(true);
    const next = await list(s, `?limit=1&cursor=${encodeURIComponent(page.nextCursor ?? '')}`);
    expect(next.items[0]).toMatchObject({
      id: current.id,
      isCurrent: true,
      review: { decision: 'ACKNOWLEDGED' },
    });
    expect(next.hasMore).toBe(false);
  });

  it('cannot review while a later call has no published result', async () => {
    const s = await seed();
    const row = await publish(s);
    await receipt(s.claim, new Date(s.call.createdAt.getTime() + 1000));
    expect((await list(s)).items[0]).toMatchObject({ canReview: false, staleReason: 'NEWER_CALL' });
    expect((await review(s, row)).statusCode).toBe(409);
  });

  it('rolls review back if its audit write fails and returns only a fixed safe error', async () => {
    const s = await seed();
    const row = await publish(s);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_observation_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC-PRIVATE-FAILURE'; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_observation_review_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_observation_review_audit()',
    );
    const response = await review(s, row);
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('SYNTHETIC-PRIVATE-FAILURE');
    expect(
      await prisma.claimObservationReview.count({ where: { organizationId: s.organization.id } }),
    ).toBe(0);
    expect(
      await prisma.claim.findFirst({
        where: { id: s.claim.id, organizationId: s.organization.id },
      }),
    ).toEqual(s.claim);
  });

  it('strictly rejects supplied provider data, review extras, oversized notes, empty dismissal, and invalid cursors', async () => {
    const s = await seed();
    const row = await publish(s);
    const rejectedPublish = await app.inject({
      method: 'POST',
      url: `/v1/calls/${s.call.id}/observations/publish`,
      headers: s.headers,
      payload: { result: s.result },
    });
    expect(rejectedPublish.statusCode).toBe(400);
    for (const extra of [
      { decision: 'DISMISSED', note: '   ' },
      { note: 'x'.repeat(1001) },
      { organizationId: s.organization.id },
      { expectedDigest: 'bad' },
    ])
      expect((await review(s, row, extra)).statusCode).toBe(400);
    for (const query of [
      '?limit=21',
      '?cursor=bad',
      `?cursor=${Buffer.from(JSON.stringify({ claimId: 'other', version: 1 })).toString('base64url')}`,
      '?includePayload=true',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/claims/${s.claim.id}/observations${query}`,
        headers: s.headers,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('exposes source evidence and safe provenance while excluding execution payloads and tenant bindings', async () => {
    const s = await seed();
    const row = await publish(s);
    expect(row.sources[0]).toEqual({
      id: s.request.sources[0]?.id,
      version: s.request.sources[0]?.version,
      kind: 'FINAL_CALL_TRANSCRIPT',
      text: s.request.sources[0]?.text,
    });
    const page = await list(s);
    expect(JSON.stringify(page)).not.toContain('requestPayload');
    expect(JSON.stringify(page)).not.toContain('apiKey');
    expect(JSON.stringify(page)).not.toContain(s.organization.id);
    expect(JSON.stringify(page)).not.toContain(s.request.invocationId);
  });

  it('rejects saved output that fails source-bound validation without changing its receipt', async () => {
    const s = await seed();
    const invalid = await receipt(s.claim, new Date(s.call.createdAt.getTime() + 1000), true);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/calls/${invalid.call.id}/observations/publish`,
      headers: s.headers,
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).not.toContain('invented');
    expect(
      await prisma.claimObservation.count({ where: { organizationId: s.organization.id } }),
    ).toBe(0);
    expect(
      await prisma.inferenceRun.findFirst({
        where: { organizationId: s.organization.id, id: invalid.run.id },
      }),
    ).toEqual(invalid.run);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not start inference when an existing call has no saved native finding', async () => {
    const s = await seed();
    const call = await prisma.call.create({
      data: {
        organizationId: s.organization.id,
        claimId: s.claim.id,
        retellCallId: `synthetic_${randomUUID()}`,
        status: 'COMPLETED',
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/calls/${call.id}/observations/publish`,
      headers: s.headers,
    });
    expect(response.statusCode).toBe(409);
    expect(
      await prisma.inferenceRun.count({
        where: { organizationId: s.organization.id, callId: call.id },
      }),
    ).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not publish a saved result after its bound final transcript is missing', async () => {
    const s = await seed();
    await prisma.callEvent.deleteMany({
      where: { callId: s.call.id, eventType: 'webhook.call.ended' },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/calls/${s.call.id}/observations/publish`,
      headers: s.headers,
    });
    expect(response.statusCode).toBe(409);
    expect(
      await prisma.claimObservation.count({ where: { organizationId: s.organization.id } }),
    ).toBe(0);
    expect(
      await prisma.inferenceRun.findFirst({
        where: { organizationId: s.organization.id, id: s.run.id },
      }),
    ).toEqual(s.run);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'marks corrected transcripts stale while retaining immutable history, previously reviewed=%s',
    async (previouslyReviewed) => {
      const s = await seed();
      const row = await publish(s);
      if (previouslyReviewed) expect((await review(s, row)).statusCode).toBe(200);
      await prisma.callEvent.create({
        data: {
          callId: s.call.id,
          eventType: 'webhook.call.ended',
          timestamp: new Date(Date.now() + 1000),
          data: {
            transcript: { text: 'Payer: Corrected transcript, the claim was denied.', turns: null },
          },
        },
      });
      const current = (await list(s)).items[0];
      expect(current).toMatchObject({
        id: row.id,
        digest: row.digest,
        canReview: false,
        staleReason: 'TRANSCRIPT_CHANGED',
        sources: row.sources,
        output: row.output,
      });
      expect(current?.review).toEqual(
        previouslyReviewed
          ? expect.objectContaining({ decision: 'ACKNOWLEDGED', reviewedByUserId: s.actor.id })
          : null,
      );
      const response = await review(
        s,
        row,
        previouslyReviewed ? { decision: 'DISMISSED', note: 'The source changed.' } : {},
      );
      expect(response.statusCode).toBe(409);
      expect(
        await prisma.claimObservationReview.count({ where: { organizationId: s.organization.id } }),
      ).toBe(previouslyReviewed ? 1 : 0);
      expect(
        await prisma.claim.findFirst({
          where: { id: s.claim.id, organizationId: s.organization.id },
        }),
      ).toEqual(s.claim);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );

  it('audits scoped evidence reads with counts only and no source, output, or note', async () => {
    const s = await seed();
    const row = await publish(s);
    expect((await review(s, row, { note: 'SYNTHETIC-PRIVATE-REVIEW-NOTE' })).statusCode).toBe(200);
    await list(s);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: {
        organizationId: s.organization.id,
        action: 'claimObservation.accessed',
        metadata: { path: ['accessKind'], equals: 'HISTORY' },
      },
    });
    expect(log).toMatchObject({
      userId: s.actor.id,
      resourceType: 'Claim',
      resourceId: s.claim.id,
      metadata: {
        accessKind: 'HISTORY',
        returnedCount: 1,
        publishableCallCount: 0,
        hasMore: false,
        cursorProvided: false,
      },
    });
    expect(Object.keys(log.metadata as object).sort()).toEqual([
      'accessKind',
      'cursorProvided',
      'hasMore',
      'publishableCallCount',
      'returnedCount',
    ]);
    expect(JSON.stringify(log)).not.toContain(s.request.sources[0]?.text);
    expect(JSON.stringify(log)).not.toContain('SYNTHETIC-PRIVATE-REVIEW-NOTE');
    expect(JSON.stringify(log)).not.toContain('PENDING_REPORTED');
  });

  it('withholds evidence and returns a safe error when the read audit cannot be persisted', async () => {
    const s = await seed();
    await publish(s);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_observation_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC-PRIVATE-READ-FAILURE'; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_observation_review_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_observation_review_audit()',
    );
    const response = await app.inject({
      method: 'GET',
      url: `/v1/claims/${s.claim.id}/observations`,
      headers: s.headers,
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: true,
      code: 'INTERNAL_ERROR',
      message: 'Observation work could not be completed. Try again shortly.',
    });
    expect(response.body).not.toContain(s.request.sources[0]?.text);
    expect(response.body).not.toContain('SYNTHETIC-PRIVATE-READ-FAILURE');
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: s.organization.id,
          action: 'claimObservation.accessed',
          metadata: { path: ['accessKind'], equals: 'HISTORY' },
        },
      }),
    ).toBe(0);
  });

  it('attributes idempotent publication and review evidence reads and fails closed when their access audit fails', async () => {
    const s = await seed();
    const row = await publish(s);
    expect((await review(s, row)).statusCode).toBe(200);
    const republish = () =>
      app.inject({
        method: 'POST',
        url: `/v1/calls/${s.call.id}/observations/publish`,
        headers: s.headers,
      });
    expect((await republish()).statusCode).toBe(200);
    expect((await review(s, row)).statusCode).toBe(200);
    const reads = await prisma.auditLog.findMany({
      where: { organizationId: s.organization.id, action: 'claimObservation.accessed' },
    });
    expect(reads).toHaveLength(4);
    for (const read of reads) {
      expect(read).toMatchObject({
        userId: s.actor.id,
        resourceType: 'Claim',
        resourceId: s.claim.id,
      });
      expect(read.metadata).toEqual({
        accessKind: expect.stringMatching(/^(PUBLISH|REVIEW)$/),
        observationId: row.id,
      });
    }
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_observation_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'claimObservation.accessed' THEN RAISE EXCEPTION 'SYNTHETIC-PRIVATE-READ-FAILURE'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER reject_observation_review_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_observation_review_audit()',
    );
    for (const response of [await republish(), await review(s, row)]) {
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ error: true, code: 'INTERNAL_ERROR' });
      expect(response.body).not.toContain(s.request.sources[0]?.text);
      expect(response.body).not.toContain('SYNTHETIC-PRIVATE-READ-FAILURE');
    }
    expect(
      await prisma.claimObservation.count({ where: { organizationId: s.organization.id } }),
    ).toBe(1);
    expect(
      await prisma.claimObservationReview.count({ where: { organizationId: s.organization.id } }),
    ).toBe(1);
    expect(
      await prisma.claim.findFirst({
        where: { organizationId: s.organization.id, id: s.claim.id },
      }),
    ).toEqual(s.claim);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

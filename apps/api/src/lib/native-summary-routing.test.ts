import { randomUUID } from 'node:crypto';

import { enqueueJobOutbox, previewJobRecovery, recoverJobOutbox } from '@dentabill/call-worker';
import { prisma, recordFireworksResponse } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import {
  CANDIDATE_RELEASES,
  createFireworksTransport,
  releasePolicyHash,
  type FireworksTransport,
  type ModelRelease,
} from '@dentabill/model-gateway';
import { FakeRetell } from '@dentabill/payer-ivr';
import type { CallJobData, JobDispatcher, SummaryJobData } from '@dentabill/queue';
import type { ObservationJobConfig } from '@dentabill/summary-worker';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../app.js';

import { createInlineJobRuntime } from './inline-jobs.js';

const ARTIFACT = '1'.repeat(64);
const MODEL = 'accounts/synthetic/models/automatic-observation';
const logger = createLogger({ level: 'fatal', pretty: false });
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://unused',
  RETELL_API_KEY: '',
  ANTHROPIC_API_KEY: 'synthetic-unrelated-legacy-key',
  WORKER_OUTBOUND_NUMBER: '+15555550100',
  SUMMARY_ANALYSIS_PROVIDER: 'FIREWORKS',
};
function release(organizationId: string): ModelRelease {
  const candidate = CANDIDATE_RELEASES[0];
  if (!candidate) throw new Error('SYNTHETIC_RELEASE_MISSING');
  const policy: ModelRelease['policy'] = {
    ...structuredClone(candidate.policy),
    id: 'synthetic-automatic-observation.v1',
    state: 'SYNTHETIC_EVALUATION',
    organizations: [organizationId],
    responseModels: [MODEL],
    implementationArtifactSha256: ARTIFACT,
    limits: { ...candidate.policy.limits, maxAttempts: 1, deadlineMs: 10_000 },
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
async function seed() {
  const org = await prisma.organization.create({
    data: { name: 'Synthetic Native Practice', clerkOrgId: randomUUID() },
  });
  const actor = await prisma.user.create({
    data: {
      organizationId: org.id,
      clerkUserId: randomUUID(),
      role: 'OWNER',
      email: 'synthetic@example.test',
    },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      claimNumber: 'SYNTHETIC-AUTOMATIC',
      patientDOBHash: 'synthetic',
      payerCode: 'CIGNA_DENTAL',
      claimAmount: '100.00',
      serviceDate: new Date('2026-10-01'),
      status: 'MANUAL_REVIEW',
    },
  });
  const call = await prisma.call.create({
    data: {
      organizationId: org.id,
      claimId: claim.id,
      retellCallId: randomUUID(),
      status: 'COMPLETED',
      endedAt: new Date(),
    },
  });
  const text = 'Payer: The claim is pending review.';
  await prisma.callEvent.create({
    data: {
      callId: call.id,
      eventType: 'webhook.call.ended',
      data: { transcript: { text, turns: null } },
    },
  });
  const chosen = release(org.id);
  let ambiguous = false;
  let rejected = false;
  let interruptReceipt = false;
  let interruptCompletion = false;
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    if (ambiguous) throw new Error('SYNTHETIC_PRIVATE_ACCEPTANCE_UNKNOWN');
    if (typeof init?.body !== 'string') throw new Error('SYNTHETIC_BODY_MISSING');
    const wire = JSON.parse(init.body) as { messages: { role: string; content: string }[] };
    const user = wire.messages.find((message) => message.role === 'user');
    if (!user) throw new Error('SYNTHETIC_INPUT_MISSING');
    const input = JSON.parse(user.content) as {
      claim: { id: string; version: string };
      sources: { id: string; version: string; text: string }[];
    };
    const source = input.sources[0];
    if (!source) throw new Error('SYNTHETIC_SOURCE_MISSING');
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: org.id, callId: call.id, generation: 1 },
    });
    expect(run).toMatchObject({ state: 'SUBMITTING', provider: 'FIREWORKS' });
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
        id: 'synthetic-native-response',
        model: rejected ? 'synthetic-unapproved-response-model' : MODEL,
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
  const native = createFireworksTransport({ fetch });
  const transport: FireworksTransport = (input) => {
    if ((!interruptReceipt && !interruptCompletion) || !input.journal) return native(input);
    const journal = input.journal;
    return native({
      ...input,
      journal: {
        ...journal,
        recordResponse: async (response) => {
          await journal.recordResponse(response);
          if (interruptReceipt) throw new Error('SYNTHETIC_RECEIPT_COMMITTED_BEFORE_PROCESS_LOSS');
        },
        completeAttempt: async (attempt) => {
          if (interruptCompletion) throw new Error('SYNTHETIC_COMPLETION_WRITE_LOST');
          await journal.completeAttempt(attempt);
        },
      },
    });
  };
  const config: ObservationJobConfig = {
    apiKey: 'synthetic-local-only',
    releaseId: chosen.policy.id,
    implementationArtifactSha256: ARTIFACT,
    dailyTokenLimit: 1_000_000,
    releases: [chosen],
    transport,
    dataClass: 'SYNTHETIC',
  };
  const data: SummaryJobData = {
    organizationId: org.id,
    callId: call.id,
    promptVersion: 'v1',
    idempotencyKey: `call.${call.id}`,
  };
  const dispatcher: JobDispatcher = {
    mode: 'inline',
    dispatchCall: vi.fn(async (value: CallJobData) => value.idempotencyKey),
    dispatchSummary: vi.fn(async (value: SummaryJobData) => value.idempotencyKey),
  };
  const runtime = (overrides: Partial<ObservationJobConfig> = {}, workerEnv = env) =>
    createInlineJobRuntime({
      prisma,
      env: workerEnv,
      logger,
      retellPort: new FakeRetell(),
      redis: null,
      jobDispatcher: dispatcher,
      observationConfig: { ...config, ...overrides },
      sleep: async () => undefined,
    });
  return {
    org,
    actor,
    claim,
    call,
    text,
    config,
    data,
    runtime,
    fetch,
    headers: { 'x-test-user-id': actor.clerkUserId },
    ambiguous: () => {
      ambiguous = true;
    },
    rejected: () => {
      rejected = true;
    },
    interruptReceipt: () => {
      interruptReceipt = true;
    },
    interruptCompletion: () => {
      interruptCompletion = true;
    },
  };
}
type Seed = Awaited<ReturnType<typeof seed>>;
async function quarantine(s: Seed) {
  const row = await enqueueJobOutbox(prisma, {
    organizationId: s.org.id,
    kind: 'SUMMARY_GENERATE',
    data: s.data,
  });
  await prisma.jobOutbox.updateMany({
    where: { id: row.id, organizationId: s.org.id },
    data: { state: 'QUARANTINED', deliveryAttempts: 10, lastErrorCode: 'DELIVERY_EXHAUSTED' },
  });
  return { prisma, organizationId: s.org.id, outboxId: row.id, clerkUserId: s.actor.clerkUserId };
}
async function rejectWrite(table: 'AuditLog' | 'ClaimObservation', condition = 'TRUE') {
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION reject_native_routing_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'SYNTHETIC_PRIVATE_PERSISTENCE_FAILURE'; END IF; RETURN NEW; END $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER reject_native_routing_write BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION reject_native_routing_write()`,
  );
}
async function dropFailure() {
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS reject_native_routing_write ON "AuditLog"',
  );
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS reject_native_routing_write ON "ClaimObservation"',
  );
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_native_routing_write()');
}

describe('native generation1 runtime, processing status and operations recovery', () => {
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
    app.jobDispatcher.dispatchSummary = vi.fn(async (data: SummaryJobData) => data.idempotencyKey);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_EXTERNAL_REQUEST'));
  });
  afterEach(async () => {
    await app.close();
    await dropFailure();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  const status = (s: Seed) =>
    app.inject({ method: 'GET', url: `/v1/calls/${s.call.id}/summary/status`, headers: s.headers });
  const retry = (s: Seed) =>
    app.inject({
      method: 'POST',
      url: `/v1/calls/${s.call.id}/summary/retry`,
      headers: s.headers,
      payload: {},
    });

  it('publishes native generation1 without a legacy summary, then closes its exact quarantined delivery', async () => {
    const s = await seed();
    const options = await quarantine(s);
    const before = await previewJobRecovery(options);
    expect(before).toMatchObject({
      ok: true,
      preview: { action: 'BLOCKED', blockedReason: 'SUMMARY_RETRY_UNSAFE' },
    });
    expect(await s.runtime().runSummaryAttempt(s.data, { attempt: 1, maxAttempts: 3 })).toEqual({
      status: 'completed',
      attempt: 1,
    });
    const observation = await prisma.claimObservation.findFirstOrThrow({
      where: { organizationId: s.org.id, callId: s.call.id },
    });
    expect((await status(s)).json()).toMatchObject({
      provider: 'FIREWORKS',
      observationId: observation.id,
      summaryId: null,
      state: 'APPLIED',
      canRetry: false,
      reviewRequired: false,
    });
    expect(await prisma.callSummary.count({ where: { organizationId: s.org.id } })).toBe(0);
    expect(
      await prisma.claim.findFirst({ where: { id: s.claim.id, organizationId: s.org.id } }),
    ).toEqual(s.claim);
    expect((await retry(s)).statusCode).toBe(409);
    const after = await previewJobRecovery(options);
    expect(after).toMatchObject({ ok: true, preview: { action: 'CLOSE' } });
    if (!before.ok || !after.ok) throw new Error('SYNTHETIC_REVIEW_MISSING');
    expect(
      await recoverJobOutbox({
        ...options,
        action: 'CLOSE',
        reviewVersion: before.preview.reviewVersion,
      }),
    ).toMatchObject({ ok: false, code: 'STALE_REVIEW' });
    expect(
      await recoverJobOutbox({
        ...options,
        action: 'CLOSE',
        reviewVersion: after.preview.reviewVersion,
      }),
    ).toMatchObject({ ok: true });
    await prisma.callEvent.create({
      data: {
        callId: s.call.id,
        eventType: 'webhook.call.ended',
        timestamp: new Date(Date.now() + 1000),
        data: {
          transcript: { text: 'Payer: Corrected evidence now needs another review.', turns: null },
        },
      },
    });
    expect(
      await s.runtime({}, { ...env, SUMMARY_ANALYSIS_PROVIDER: 'SYNTHETIC' }).runSummary(s.data),
    ).toMatchObject({ status: 'completed' });
    const historical = await app.inject({
      method: 'POST',
      url: `/v1/calls/${s.call.id}/observations/publish`,
      headers: s.headers,
      payload: {},
    });
    expect(historical.statusCode).toBe(200);
    expect(historical.json()).toMatchObject({
      id: observation.id,
      canReview: false,
      staleReason: 'TRANSCRIPT_CHANGED',
    });
    expect(s.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('recovers stored final evidence without keys and preserves a coexisting legacy summary', async () => {
    const s = await seed();
    await rejectWrite('ClaimObservation');
    expect(
      await s.runtime().runSummaryAttempt(s.data, { attempt: 3, maxAttempts: 3 }),
    ).toMatchObject({ status: 'retry' });
    await dropFailure();
    const legacy = await prisma.callSummary.create({
      data: {
        organizationId: s.org.id,
        callId: s.call.id,
        claimStatus: 'pending',
        nextAction: 'MANUAL_REVIEW',
        rawTranscript: 'SYNTHETIC_PRIVATE_LEGACY',
        claudeSummary: 'Synthetic historical summary',
      },
    });
    expect((await status(s)).json()).toMatchObject({
      provider: 'FIREWORKS',
      state: 'RESPONDED',
      summaryId: legacy.id,
      observationId: null,
      canRetry: true,
      reviewRequired: false,
    });
    const options = await quarantine(s);
    expect(await previewJobRecovery(options)).toMatchObject({
      ok: true,
      preview: { action: 'BLOCKED', blockedReason: 'SUMMARY_RETRY_UNSAFE' },
    });
    expect((await retry(s)).statusCode).toBe(202);
    expect(
      await s
        .runtime(
          { apiKey: '', releases: [], implementationArtifactSha256: '' },
          { ...env, SUMMARY_ANALYSIS_PROVIDER: 'SYNTHETIC' },
        )
        .runSummaryAttempt(s.data, { attempt: 1, maxAttempts: 3 }),
    ).toMatchObject({ status: 'completed' });
    expect(
      await prisma.callSummary.findFirst({ where: { id: legacy.id, organizationId: s.org.id } }),
    ).toEqual(legacy);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it('offers raw receipt replay only after lease expiry and replays archived evidence without another send', async () => {
    const s = await seed();
    s.interruptReceipt();
    expect(
      await s.runtime().runSummaryAttempt(s.data, { attempt: 3, maxAttempts: 3 }),
    ).toMatchObject({ status: 'retry' });
    expect((await status(s)).json()).toMatchObject({
      state: 'SUBMITTING',
      canRetry: false,
      reviewRequired: false,
    });
    expect((await retry(s)).statusCode).toBe(409);
    await prisma.inferenceRun.updateMany({
      where: { organizationId: s.org.id, callId: s.call.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    expect((await status(s)).json()).toMatchObject({ canRetry: true, reviewRequired: false });
    expect((await retry(s)).statusCode).toBe(202);
    expect(
      await s
        .runtime({ apiKey: '', releases: [] }, { ...env, SUMMARY_ANALYSIS_PROVIDER: 'SYNTHETIC' })
        .runSummaryAttempt(s.data, { attempt: 1, maxAttempts: 3 }),
    ).toMatchObject({ status: 'completed' });
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['UNKNOWN', 'REJECTED'] as const)(
    'settles %s review through owner delivery retry without another inference',
    async (state) => {
      const s = await seed();
      if (state === 'UNKNOWN') s.ambiguous();
      else s.rejected();
      await rejectWrite('AuditLog', "NEW.action = 'observation.inference_review_required'");
      const options = await quarantine(s);
      expect(
        await s.runtime().runSummaryAttempt(s.data, { attempt: 3, maxAttempts: 3 }),
      ).toMatchObject({ status: 'retry' });
      await prisma.inferenceRun.updateMany({
        where: { organizationId: s.org.id, callId: s.call.id },
        data: { leaseExpiresAt: new Date(Date.now() + 60_000) },
      });
      expect((await status(s)).json()).toMatchObject({
        state,
        reviewRequired: true,
        canRetry: false,
      });
      expect((await retry(s)).statusCode).toBe(409);
      await prisma.inferenceRun.updateMany({
        where: { organizationId: s.org.id, callId: s.call.id },
        data: { leaseExpiresAt: new Date(0) },
      });
      expect((await status(s)).json()).toMatchObject({
        provider: 'FIREWORKS',
        state,
        reviewRequired: true,
        canRetry: true,
      });
      expect(await previewJobRecovery(options)).toMatchObject({
        ok: true,
        preview: { action: 'BLOCKED' },
      });
      const delivery = await retry(s);
      expect(delivery.statusCode, delivery.body).toBe(202);
      const { jobId } = delivery.json<{ jobId: string }>();
      await dropFailure();
      expect(
        await s
          .runtime({ apiKey: '', releases: [] }, { ...env, SUMMARY_ANALYSIS_PROVIDER: 'SYNTHETIC' })
          .runSummaryAttempt({ ...s.data, idempotencyKey: jobId }, { attempt: 1, maxAttempts: 3 }),
      ).toMatchObject({ status: 'inference_review_required' });
      expect((await status(s)).json()).toMatchObject({
        state,
        reviewRequired: true,
        canRetry: false,
      });
      expect((await retry(s)).statusCode).toBe(409);
      expect(
        await prisma.inferenceRun.findMany({
          where: { organizationId: s.org.id, callId: s.call.id },
          select: { generation: true, provider: true },
        }),
      ).toEqual([{ generation: 1, provider: 'FIREWORKS' }]);
      const reviewed = await previewJobRecovery(options);
      expect(reviewed).toMatchObject({ ok: true, preview: { action: 'CLOSE' } });
      if (!reviewed.ok) throw new Error('SYNTHETIC_REVIEW_MISSING');
      expect(
        await recoverJobOutbox({
          ...options,
          action: 'RETRY',
          reviewVersion: reviewed.preview.reviewVersion,
        }),
      ).toMatchObject({ ok: false, code: 'RECOVERY_BLOCKED' });
      expect(s.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('invalidates a reviewed closure when a late raw receipt arrives without changing the run row', async () => {
    const s = await seed();
    s.ambiguous();
    s.interruptCompletion();
    const options = await quarantine(s);
    expect(
      await s.runtime().runSummaryAttempt(s.data, { attempt: 3, maxAttempts: 3 }),
    ).toMatchObject({ status: 'retry' });
    expect((await status(s)).json()).toMatchObject({ state: 'SUBMITTING', canRetry: false });
    await prisma.inferenceRun.updateMany({
      where: { organizationId: s.org.id, callId: s.call.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    expect((await status(s)).json()).toMatchObject({
      state: 'SUBMITTING',
      canRetry: true,
      reviewRequired: true,
    });
    const delivery = await retry(s);
    expect(delivery.statusCode, delivery.body).toBe(202);
    const { jobId } = delivery.json<{ jobId: string }>();
    expect(
      await s
        .runtime({ apiKey: '' })
        .runSummaryAttempt({ ...s.data, idempotencyKey: jobId }, { attempt: 1, maxAttempts: 3 }),
    ).toMatchObject({ status: 'inference_review_required' });
    expect((await status(s)).json()).toMatchObject({
      state: 'UNKNOWN',
      canRetry: false,
      reviewRequired: true,
    });
    const reviewed = await previewJobRecovery(options);
    expect(reviewed).toMatchObject({ ok: true, preview: { action: 'CLOSE' } });
    if (!reviewed.ok) throw new Error('SYNTHETIC_REVIEW_MISSING');
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: s.org.id, callId: s.call.id, generation: 1 },
    });
    await recordFireworksResponse(prisma, {
      organizationId: s.org.id,
      runId: run.id,
      leaseToken: run.leaseToken ?? '',
      attemptNumber: 1,
      response: { status: 200, body: '{"late":"SYNTHETIC_PRIVATE_RECEIPT"}', retryDelayMs: null },
    });
    expect(
      await prisma.inferenceRun.findFirst({ where: { id: run.id, organizationId: s.org.id } }),
    ).toEqual(run);
    expect(await previewJobRecovery(options)).toMatchObject({
      ok: true,
      preview: { action: 'BLOCKED', blockedReason: 'SUMMARY_RETRY_UNSAFE' },
    });
    expect(
      await recoverJobOutbox({
        ...options,
        action: 'CLOSE',
        reviewVersion: reviewed.preview.reviewVersion,
      }),
    ).toMatchObject({ ok: false, code: 'STALE_REVIEW' });
    expect((await status(s)).json()).toMatchObject({
      state: 'UNKNOWN',
      canRetry: true,
      reviewRequired: false,
    });
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it('gates protected automatic work and incomplete release configuration without acknowledging or sending', async () => {
    const s = await seed();
    const { dataClass: _synthetic, ...protectedConfig } = s.config;
    const protectedRuntime = createInlineJobRuntime({
      prisma,
      env,
      logger,
      retellPort: new FakeRetell(),
      redis: null,
      jobDispatcher: {
        mode: 'inline',
        dispatchCall: async (d) => d.idempotencyKey,
        dispatchSummary: async (d) => d.idempotencyKey,
      },
      observationConfig: protectedConfig,
    });
    expect(
      await protectedRuntime.runSummaryAttempt(s.data, { attempt: 3, maxAttempts: 3 }),
    ).toMatchObject({ status: 'retry' });
    expect(
      await s
        .runtime({ releaseId: '', apiKey: '' })
        .runSummaryAttempt(s.data, { attempt: 3, maxAttempts: 3 }),
    ).toMatchObject({ status: 'retry' });
    expect(await prisma.inferenceRun.count({ where: { organizationId: s.org.id } })).toBe(0);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('exposes safe status to billers, retains owner-only retry, audits reads and rejects cross-tenant access', async () => {
    const s = await seed();
    const owner = await status(s);
    expect(owner.json()).toMatchObject({ provider: null, observationId: null, canRetry: true });
    await prisma.user.updateMany({
      where: { id: s.actor.id, organizationId: s.org.id },
      data: { role: 'BILLING_STAFF' },
    });
    const staff = await status(s);
    expect(staff.statusCode).toBe(200);
    expect(staff.json()).toMatchObject({ canRetry: false });
    expect((await retry(s)).statusCode).toBe(403);
    expect(staff.body).not.toContain(s.text);
    const other = await seed();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/calls/${s.call.id}/summary/status`,
          headers: other.headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: s.org.id, userId: s.actor.id, action: 'callSummary.status.read' },
      }),
    ).toBe(2);
    await rejectWrite('AuditLog');
    const failed = await status(s);
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain('SYNTHETIC_PRIVATE');
  });
});

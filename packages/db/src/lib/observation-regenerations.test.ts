import { createHash, randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { prisma } from '../client.js';

import { getClaimObservationEligibility, publishClaimObservation } from './claim-observations.js';
import { MissingOrgScopeError } from './errors.js';
import {
  beginFireworksAttempt,
  finalizeFireworksInference,
  finishFireworksAttempt,
  recordFireworksResponse,
  reserveFireworksInferenceRun,
  type ReserveFireworksInferenceInput,
} from './fireworks-inference.js';
import {
  authorizeObservationRegeneration,
  previewObservationRegeneration,
  type PreviewObservationRegenerationInput,
} from './observation-regenerations.js';
import { getOrgScopedDb } from './with-org.js';

const HASH = 'a'.repeat(64);
const ARTIFACT = 'c'.repeat(64);
const TEXT = 'Synthetic payer transcript.';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function own(input: ReserveFireworksInferenceInput) {
  const reservation = await reserveFireworksInferenceRun(prisma, input);
  if (reservation.kind !== 'OWNED' && reservation.kind !== 'REPLAY')
    throw new Error('TEST_EXPECTED_OWNER');
  return {
    organizationId: input.organizationId,
    runId: reservation.run.id,
    leaseToken: reservation.leaseToken,
    now: input.now ?? new Date(),
  };
}
type Ownership = Awaited<ReturnType<typeof own>>;
function result(input: ReserveFireworksInferenceInput, status = 200) {
  const usage =
    status === 200
      ? { inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: 0 }
      : { inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null };
  const attempt = {
    index: 1,
    httpStatus: status,
    outcome: status === 200 ? ('COMPLETED' as const) : ('HTTP_ERROR' as const),
    acceptance: 'RESPONDED' as const,
    elapsedMs: 0.5,
    usage,
  };
  const payload =
    status === 200
      ? {
          status: 'ABSTAINED',
          output: {
            disposition: 'ABSTAIN',
            claimId: input.claimId,
            claimVersion: input.claimVersion.toISOString(),
            status: { value: 'UNKNOWN', evidence: [] },
            payerReportedPayment: null,
            denialCodes: [],
            proposedAction: 'MANUAL_REVIEW',
            abstentionReason: 'INSUFFICIENT_EVIDENCE',
          },
          requiresHumanReview: true,
          provenance: {
            kind: 'FIREWORKS',
            releaseId: input.releaseId,
            task: 'claim-observation.v1',
            promptVersion: 'claim-observation-prompt.v1',
            schemaVersion: 'claim-observation-schema.v1',
            responseId: 'synthetic',
            model: 'synthetic-model',
            attempts: [attempt],
            usage,
            elapsedMs: 1,
          },
        }
      : { status: 'FAILED', code: 'HTTP_ERROR', attempts: [attempt], elapsedMs: 1 };
  return { attempt, payload: json(payload) };
}
async function submit(input: ReserveFireworksInferenceInput) {
  const owner = await own(input);
  expect(
    await beginFireworksAttempt(prisma, {
      ...owner,
      attemptNumber: 1,
      wireRequestHash: input.wireRequestHash,
      ...(input.implementationArtifactSha256
        ? { implementationArtifactSha256: input.implementationArtifactSha256 }
        : {}),
    }),
  ).toMatchObject({ kind: 'ADMITTED' });
  return owner;
}
async function respond(input: ReserveFireworksInferenceInput, owner: Ownership, status = 200) {
  const receipt = result(input, status);
  await recordFireworksResponse(prisma, {
    ...owner,
    attemptNumber: 1,
    response: { status, body: JSON.stringify({ synthetic: true }), retryDelayMs: 0 },
  });
  await finishFireworksAttempt(prisma, {
    ...owner,
    attempt: receipt.attempt,
    errorCode: status === 200 ? null : 'HTTP_ERROR',
  });
  await finalizeFireworksInference(prisma, {
    ...owner,
    status: status === 200 ? 'ABSTAINED' : 'FAILED',
    resultPayload: receipt.payload,
    errorCode: status === 200 ? null : 'HTTP_ERROR',
  });
  return receipt.payload;
}
async function fixture() {
  const now = new Date();
  const organization = await prisma.organization.create({
    data: { name: 'Synthetic regeneration', clerkOrgId: randomUUID() },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      clerkUserId: randomUUID(),
      email: 'owner@synthetic.invalid',
      role: 'OWNER',
    },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: organization.id,
      claimNumber: randomUUID(),
      patientDOBHash: 'synthetic',
      cdtCodes: ['D0150'],
      claimAmount: '100.00',
      payerCode: 'CIGNA_DENTAL',
      serviceDate: now,
      status: 'COMPLETED',
    },
  });
  const call = await prisma.call.create({
    data: {
      organizationId: organization.id,
      claimId: claim.id,
      retellCallId: randomUUID(),
      status: 'COMPLETED',
    },
  });
  const event = await prisma.callEvent.create({
    data: {
      callId: call.id,
      eventType: 'webhook.call.ended',
      data: { transcript: { text: TEXT, turns: null } },
    },
  });
  const sources = [
    {
      id: `transcript.${event.id}`,
      organizationId: organization.id,
      claimId: claim.id,
      claimVersion: claim.updatedAt.toISOString(),
      version: sha(TEXT),
      kind: 'FINAL_CALL_TRANSCRIPT',
      text: TEXT,
    },
  ];
  const request = {
    organizationId: organization.id,
    invocationId: `observation.${call.id}.g1`,
    releaseId: 'synthetic-release',
    task: 'claim-observation.v1',
    dataClass: 'SYNTHETIC',
    claim: {
      id: claim.id,
      organizationId: organization.id,
      version: claim.updatedAt.toISOString(),
      billedMinorUnits: 10000,
      currency: 'USD',
    },
    sources,
  };
  const policy = {
    id: request.releaseId,
    state: 'SYNTHETIC_EVALUATION',
    endpoint: 'https://us.api.fireworks.ai/inference/v1/chat/completions',
    requestModel: 'synthetic-model',
    responseModels: ['synthetic-model'],
    task: 'claim-observation.v1',
    promptVersion: 'claim-observation-prompt.v1',
    schemaVersion: 'claim-observation-schema.v1',
    fingerprints: { prompt: HASH, schema: HASH, validator: HASH },
    implementationArtifactSha256: ARTIFACT,
    organizations: [organization.id],
    limits: {
      requestBytes: 131072,
      responseBytes: 131072,
      outputTokens: 1000,
      deadlineMs: 30000,
      maxAttempts: 2,
    },
    evidence: { protectedDataApprovalId: null },
  };
  const releasePolicyHash = sha(JSON.stringify(policy));
  const releaseSnapshot = JSON.stringify({
    policy,
    approval: {
      policySha256: releasePolicyHash,
      reviewerId: 'synthetic',
      evaluationId: 'synthetic',
      runAuthorizationId: 'synthetic',
      reviewedAt: new Date(now.getTime() - 1000).toISOString(),
      expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
    },
  });
  const input: ReserveFireworksInferenceInput = {
    organizationId: organization.id,
    callId: call.id,
    claimId: claim.id,
    claimVersion: claim.updatedAt,
    sourceHash: sha(JSON.stringify(sources)),
    requestHash: sha(JSON.stringify(request)),
    releasePolicyHash,
    wireRequestHash: HASH,
    releaseId: request.releaseId,
    promptVersion: 'claim-observation-prompt.v1',
    requestPayload: request,
    reservationTokens: 100,
    dailyTokenLimit: 10000,
    maxAttempts: 2,
    executionDeadlineAt: new Date(now.getTime() + 30000),
    now,
  };
  const owner = await submit(input);
  const payload = await respond(input, owner);
  const observation = (
    await publishClaimObservation(prisma, {
      organizationId: organization.id,
      runId: owner.runId,
      validatedResult: payload,
    })
  ).observation;
  return {
    now,
    organization,
    user,
    claim,
    call,
    event,
    request,
    releaseSnapshot,
    input,
    observation,
    owner,
    payload,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function previewInput(
  base: Fixture,
  generation = 2,
  now = base.now,
): PreviewObservationRegenerationInput {
  const request = {
    ...base.request,
    invocationId: `observation.${base.call.id}.g${String(generation)}`,
  };
  return {
    organizationId: base.organization.id,
    clerkUserId: base.user.clerkUserId,
    observationId: base.observation.id,
    callId: base.call.id,
    claimVersion: base.claim.updatedAt,
    requestPayload: request,
    requestHash: sha(JSON.stringify(request)),
    sourceHash: base.input.sourceHash,
    releaseId: base.input.releaseId,
    releasePolicyHash: base.input.releasePolicyHash,
    implementationArtifactSha256: ARTIFACT,
    releaseSnapshot: base.releaseSnapshot,
    now,
  };
}
async function approve(base: Fixture, generation = 2, now = base.now) {
  const input = previewInput(base, generation, now);
  const preview = await previewObservationRegeneration(prisma, input);
  const command = {
    ...input,
    expectedPreviewDigest: preview.previewDigest,
    idempotencyKey: randomUUID(),
    reason: 'Synthetic reviewed regeneration',
  };
  const authorization = (await authorizeObservationRegeneration(prisma, command)).authorization;
  return {
    command,
    authorization,
    input: {
      ...base.input,
      requestPayload: authorization.requestPayload as Prisma.InputJsonValue,
      requestHash: authorization.requestHash,
      sourceHash: authorization.sourceHash,
      regenerationId: authorization.id,
      implementationArtifactSha256: ARTIFACT,
      executionDeadlineAt: new Date(now.getTime() + 30000),
      now,
    },
  };
}

describe('audited observation regeneration authorization', () => {
  it('serializes duplicate approval, binds generation two, and publishes an explicit supersession without changing legacy state', async () => {
    const base = await fixture();
    const input = previewInput(base);
    const preview = await previewObservationRegeneration(prisma, input);
    expect(preview).toMatchObject({ canAuthorize: true, previousGeneration: 1, nextGeneration: 2 });
    const command = {
      ...input,
      expectedPreviewDigest: preview.previewDigest,
      idempotencyKey: randomUUID(),
      reason: 'Synthetic reason',
    };
    const approvals = await Promise.all([
      authorizeObservationRegeneration(prisma, command),
      authorizeObservationRegeneration(prisma, command),
    ]);
    expect(approvals.map((value) => value.kind).sort()).toEqual([
      'ALREADY_AUTHORIZED',
      'AUTHORIZED',
    ]);
    const authorization = approvals[0].authorization;
    expect(
      await getClaimObservationEligibility(prisma, {
        organizationId: base.organization.id,
        observationId: base.observation.id,
      }),
    ).toMatchObject({ staleReason: 'NEWER_GENERATION', canReview: false });
    const native = {
      ...base.input,
      requestPayload: authorization.requestPayload as Prisma.InputJsonValue,
      requestHash: authorization.requestHash,
      regenerationId: authorization.id,
      implementationArtifactSha256: ARTIFACT,
    };
    const owner = await submit(native);
    const payload = await respond(native, owner);
    const published = await publishClaimObservation(prisma, {
      organizationId: base.organization.id,
      runId: owner.runId,
      validatedResult: payload,
    });
    expect(published.observation).toMatchObject({
      version: 2,
      supersedesObservationId: base.observation.id,
      previousObservationId: base.observation.id,
    });
    expect(
      await prisma.inferenceRun.findFirst({
        where: { organizationId: base.organization.id, id: owner.runId },
      }),
    ).toMatchObject({ generation: 2, regenerationId: authorization.id, state: 'APPLIED' });
    expect(
      (
        await publishClaimObservation(prisma, {
          organizationId: base.organization.id,
          runId: base.owner.runId,
          validatedResult: base.payload,
        })
      ).kind,
    ).toBe('ALREADY_PUBLISHED');
    expect(
      await getClaimObservationEligibility(prisma, {
        organizationId: base.organization.id,
        observationId: published.observation.id,
      }),
    ).toMatchObject({ isCurrent: true, canReview: true });
    expect(
      await prisma.claim.findFirst({
        where: { organizationId: base.organization.id, id: base.claim.id },
      }),
    ).toEqual(base.claim);
    expect(
      await prisma.callSummary.count({ where: { organizationId: base.organization.id } }),
    ).toBe(0);
    expect(
      await prisma.inferenceBudget.findFirst({ where: { organizationId: base.organization.id } }),
    ).toMatchObject({ knownTokens: 24n, reservedTokens: 0n });
  });

  it('resolves an exact approval retry before current source checks and rejects changed reason or actor', async () => {
    const base = await fixture();
    const approved = await approve(base);
    await prisma.callEvent.create({
      data: {
        callId: base.call.id,
        eventType: 'call.ended',
        timestamp: new Date(base.event.timestamp.getTime() + 1),
        data: { transcript: { text: 'Corrected', turns: null } },
      },
    });
    const retried = await authorizeObservationRegeneration(prisma, {
      ...approved.command,
      requestHash: HASH,
      requestPayload: {},
    });
    expect(retried).toMatchObject({
      kind: 'ALREADY_AUTHORIZED',
      authorization: { id: approved.authorization.id, generation: 2 },
    });
    await expect(
      authorizeObservationRegeneration(prisma, { ...approved.command, reason: 'Changed' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const admin = await prisma.user.create({
      data: {
        organizationId: base.organization.id,
        clerkUserId: randomUUID(),
        email: 'admin@synthetic.invalid',
        role: 'ADMIN',
      },
    });
    await expect(
      authorizeObservationRegeneration(prisma, {
        ...approved.command,
        clerkUserId: admin.clerkUserId,
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await reserveFireworksInferenceRun(prisma, approved.input)).toMatchObject({
      kind: 'AUTHORIZATION_DENIED',
    });
    expect(
      await prisma.inferenceBudget.findFirst({ where: { organizationId: base.organization.id } }),
    ).toMatchObject({ knownTokens: 12n, reservedTokens: 0n });
  });

  it('blocks pending approval and skips an expired unused generation without reusing its authorization', async () => {
    const base = await fixture();
    const second = await approve(base);
    expect(await previewObservationRegeneration(prisma, previewInput(base, 3))).toMatchObject({
      blockedReason: 'AUTHORIZATION_PENDING',
    });
    const later = new Date(base.now.getTime() + 16 * 60000);
    expect(
      await reserveFireworksInferenceRun(prisma, {
        ...second.input,
        now: later,
        executionDeadlineAt: new Date(later.getTime() + 30000),
      }),
    ).toMatchObject({ kind: 'AUTHORIZATION_DENIED' });
    const third = await approve(base, 3, later);
    expect(third.authorization).toMatchObject({ generation: 3, previousGeneration: 1 });
    expect(
      (await authorizeObservationRegeneration(prisma, { ...second.command, now: later }))
        .authorization.id,
    ).toBe(second.authorization.id);
    expect(await reserveFireworksInferenceRun(prisma, third.input)).toMatchObject({
      kind: 'OWNED',
      run: { generation: 3 },
    });
  });

  it.each(['claim', 'source', 'role', 'artifact', 'expiry'] as const)(
    'rechecks %s before attempt admission and retains saved work without sending',
    async (change) => {
      const base = await fixture();
      const approved = await approve(base);
      const reservationTime =
        change === 'expiry' ? new Date(base.now.getTime() + 14 * 60000 + 59000) : base.now;
      const owner = await own({
        ...approved.input,
        now: reservationTime,
        executionDeadlineAt: new Date(reservationTime.getTime() + 30000),
      });
      if (change === 'claim')
        await prisma.claim.update({
          where: { organizationId: base.organization.id, id: base.claim.id },
          data: { updatedAt: new Date(base.claim.updatedAt.getTime() + 1) },
        });
      if (change === 'source')
        await prisma.callEvent.update({
          where: { id: base.event.id },
          data: { data: { transcript: { text: 'Changed', turns: null } } },
        });
      if (change === 'role')
        await prisma.user.update({
          where: { organizationId: base.organization.id, id: base.user.id },
          data: { role: 'BILLING_STAFF' },
        });
      const now = change === 'expiry' ? new Date(base.now.getTime() + 15 * 60000 + 1000) : base.now;
      const outcome = await beginFireworksAttempt(prisma, {
        ...owner,
        now,
        attemptNumber: 1,
        wireRequestHash: HASH,
        implementationArtifactSha256: change === 'artifact' ? HASH : ARTIFACT,
      });
      expect(outcome.kind).toBe('BLOCKED');
      expect(
        await prisma.inferenceAttempt.count({
          where: { organizationId: base.organization.id, runId: owner.runId },
        }),
      ).toBe(0);
      expect(
        await prisma.inferenceBudget.findFirst({ where: { organizationId: base.organization.id } }),
      ).toMatchObject({ knownTokens: 12n, reservedTokens: 100n });
    },
  );

  it('rechecks authorization on retry two while replaying a durable receipt after expiry without new admission', async () => {
    const base = await fixture();
    const approved = await approve(base);
    const owner = await submit(approved.input);
    const receipt = result(approved.input, 503);
    await recordFireworksResponse(prisma, {
      ...owner,
      attemptNumber: 1,
      response: { status: 503, body: '{}', retryDelayMs: 0 },
    });
    await finishFireworksAttempt(prisma, {
      ...owner,
      attempt: receipt.attempt,
      errorCode: 'HTTP_ERROR',
    });
    await prisma.user.update({
      where: { organizationId: base.organization.id, id: base.user.id },
      data: { role: 'BILLING_STAFF' },
    });
    expect(
      await beginFireworksAttempt(prisma, {
        ...owner,
        attemptNumber: 2,
        wireRequestHash: HASH,
        implementationArtifactSha256: ARTIFACT,
      }),
    ).toMatchObject({ kind: 'BLOCKED' });
    const later = new Date(base.now.getTime() + 16 * 60000);
    const replay = await reserveFireworksInferenceRun(prisma, { ...approved.input, now: later });
    expect(replay).toMatchObject({ kind: 'REPLAY', run: { generation: 2, reservedTokens: 100n } });
    if (replay.kind !== 'REPLAY') throw new Error('TEST_EXPECTED_REPLAY');
    expect(
      await beginFireworksAttempt(prisma, {
        organizationId: base.organization.id,
        runId: replay.run.id,
        leaseToken: replay.leaseToken,
        now: later,
        attemptNumber: 1,
        wireRequestHash: HASH,
      }),
    ).toMatchObject({ kind: 'REPLAY' });
    expect(
      await prisma.inferenceAttempt.count({
        where: { organizationId: base.organization.id, runId: owner.runId },
      }),
    ).toBe(1);
  });

  it('blocks unresolved prior execution but allows explicit regeneration after definite rejected evidence without erasing unknown usage', async () => {
    const base = await fixture();
    const approved = await approve(base);
    const owner = await submit(approved.input);
    expect(await previewObservationRegeneration(prisma, previewInput(base, 3))).toMatchObject({
      blockedReason: 'PRIOR_RUN_UNRESOLVED',
    });
    await respond(approved.input, owner, 503);
    const third = await approve(base, 3);
    expect(third.authorization).toMatchObject({
      previousRunId: owner.runId,
      previousGeneration: 2,
      generation: 3,
    });
    expect(
      await prisma.inferenceBudget.findFirst({ where: { organizationId: base.organization.id } }),
    ).toMatchObject({ knownTokens: 12n, reservedTokens: 100n });
    expect(await reserveFireworksInferenceRun(prisma, third.input)).toMatchObject({
      kind: 'OWNED',
    });
    expect(
      await prisma.inferenceBudget.findFirst({ where: { organizationId: base.organization.id } }),
    ).toMatchObject({ knownTokens: 12n, reservedTokens: 200n });
  });

  it('rejects stale preview, non-admin and cross-tenant approval, and rolls audit failure back', async () => {
    const base = await fixture();
    const input = previewInput(base);
    const preview = await previewObservationRegeneration(prisma, input);
    const command = {
      ...input,
      expectedPreviewDigest: preview.previewDigest,
      reason: 'Synthetic reason',
      idempotencyKey: randomUUID(),
    };
    await expect(
      authorizeObservationRegeneration(prisma, { ...command, expectedPreviewDigest: HASH }),
    ).rejects.toMatchObject({ code: 'STALE_PREVIEW' });
    await prisma.user.update({
      where: { id: base.user.id, organizationId: base.organization.id },
      data: { role: 'BILLING_STAFF' },
    });
    await expect(authorizeObservationRegeneration(prisma, command)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await prisma.user.update({
      where: { id: base.user.id, organizationId: base.organization.id },
      data: { role: 'ADMIN' },
    });
    const foreign = await fixture();
    await expect(
      authorizeObservationRegeneration(prisma, {
        ...command,
        organizationId: foreign.organization.id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION regeneration_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'claimObservation.regeneration_authorized' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER regeneration_test_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION regeneration_test_fail_audit()',
    );
    try {
      await expect(authorizeObservationRegeneration(prisma, command)).rejects.toThrow();
      expect(
        await prisma.observationRegeneration.count({
          where: { organizationId: base.organization.id },
        }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER regeneration_test_fail_audit ON "AuditLog"');
      await prisma.$executeRawUnsafe('DROP FUNCTION regeneration_test_fail_audit()');
    }
    const authorization = (await authorizeObservationRegeneration(prisma, command)).authorization;
    expect(
      await getOrgScopedDb(foreign.organization.id).observationRegeneration.findFirst({
        where: { id: authorization.id },
      }),
    ).toBeNull();
    await expect(
      prisma.observationRegeneration.updateMany({
        where: { id: authorization.id },
        data: { reason: 'Changed' },
      }),
    ).rejects.toThrow(MissingOrgScopeError);
    await expect(
      prisma.observationRegeneration.update({
        where: { id: authorization.id, organizationId: base.organization.id },
        data: { reason: 'Changed' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.observationRegeneration.delete({
        where: { id: authorization.id, organizationId: base.organization.id },
      }),
    ).rejects.toThrow();
    const audits = await prisma.auditLog.findMany({
      where: {
        organizationId: base.organization.id,
        action: 'claimObservation.regeneration_authorized',
      },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(command.reason);
  });

  it('rejects release snapshot tampering and generation without a matching scoped authorization', async () => {
    const base = await fixture();
    expect(
      await previewObservationRegeneration(prisma, {
        ...previewInput(base),
        releaseSnapshot: '{}',
      }),
    ).toMatchObject({ blockedReason: 'AUTHORIZATION_INVALID' });
    const approved = await approve(base);
    expect(
      await reserveFireworksInferenceRun(prisma, {
        ...approved.input,
        implementationArtifactSha256: HASH,
      }),
    ).toMatchObject({ kind: 'AUTHORIZATION_DENIED' });
    const { regenerationId: _regenerationId, ...withoutAuthorization } = approved.input;
    await expect(reserveFireworksInferenceRun(prisma, withoutAuthorization)).rejects.toThrow(
      'FIREWORKS_INFERENCE_CONFLICT',
    );
    const original = await prisma.inferenceRun.findFirstOrThrow({
      where: { id: base.owner.runId, organizationId: base.organization.id },
    });
    await expect(
      prisma.inferenceRun.update({
        where: { id: original.id, organizationId: base.organization.id },
        data: { regenerationId: approved.authorization.id, generation: 2 },
      }),
    ).rejects.toThrow();
  });

  it('permits a fresh explicit generation after an audited proven-unsent deadline refund', async () => {
    const base = await fixture();
    const second = await approve(base);
    const owner = await own(second.input);
    const later = new Date(base.now.getTime() + 31000);
    expect(
      await reserveFireworksInferenceRun(prisma, { ...second.input, now: later }),
    ).toMatchObject({
      kind: 'DEADLINE_EXCEEDED',
      run: { state: 'REJECTED', reservedTokens: 0n, totalTokens: 0n },
    });
    expect(
      await prisma.inferenceAttempt.count({
        where: { organizationId: base.organization.id, runId: owner.runId },
      }),
    ).toBe(0);
    const third = await approve(base, 3, later);
    expect(third.authorization).toMatchObject({
      generation: 3,
      previousGeneration: 2,
      previousRunId: owner.runId,
    });
    expect(await reserveFireworksInferenceRun(prisma, third.input)).toMatchObject({
      kind: 'OWNED',
      run: { generation: 3 },
    });
    expect(
      await prisma.inferenceBudget.findFirst({ where: { organizationId: base.organization.id } }),
    ).toMatchObject({ knownTokens: 12n, reservedTokens: 100n });
  });

  it('permits a fresh approval after a source change blocks admission and a saved zero-attempt failure refunds the reservation', async () => {
    const base = await fixture();
    const second = await approve(base);
    const owner = await own(second.input);
    const correctedText = 'Corrected synthetic payer transcript.';
    await prisma.callEvent.update({
      where: { id: base.event.id },
      data: { data: { transcript: { text: correctedText, turns: null } } },
    });
    expect(
      await beginFireworksAttempt(prisma, {
        ...owner,
        attemptNumber: 1,
        wireRequestHash: HASH,
        implementationArtifactSha256: ARTIFACT,
      }),
    ).toMatchObject({ kind: 'BLOCKED' });
    const sources = base.request.sources.map((source) => ({
      ...source,
      text: correctedText,
      version: sha(correctedText),
    }));
    const correctedBase = {
      ...base,
      request: { ...base.request, sources },
      input: { ...base.input, sourceHash: sha(JSON.stringify(sources)) },
    };
    expect(
      await previewObservationRegeneration(prisma, previewInput(correctedBase, 3)),
    ).toMatchObject({ blockedReason: 'PRIOR_RUN_UNRESOLVED' });
    expect(
      await finalizeFireworksInference(prisma, {
        ...owner,
        status: 'FAILED',
        resultPayload: { status: 'FAILED', code: 'ADMISSION_DENIED', attempts: [], elapsedMs: 1 },
        errorCode: 'ADMISSION_DENIED',
      }),
    ).toMatchObject({ state: 'REJECTED', reservedTokens: 0n, totalTokens: 0n });
    expect(
      await prisma.inferenceAttempt.count({
        where: { organizationId: base.organization.id, runId: owner.runId },
      }),
    ).toBe(0);
    const third = await approve(correctedBase, 3);
    expect(third.authorization).toMatchObject({
      generation: 3,
      previousGeneration: 2,
      previousRunId: owner.runId,
      sourceHash: correctedBase.input.sourceHash,
    });
    await submit(third.input);
    expect(
      await prisma.inferenceBudget.findFirst({ where: { organizationId: base.organization.id } }),
    ).toMatchObject({ knownTokens: 12n, reservedTokens: 100n });
  });

  it.each(['audit', 'receipt'] as const)(
    'rejects a zero-attempt refunded failure without its exact %s proof',
    async (missingProof) => {
      const base = await fixture();
      const second = await approve(base);
      const owner = await own(second.input);
      await finalizeFireworksInference(prisma, {
        ...owner,
        status: 'FAILED',
        resultPayload: { status: 'FAILED', code: 'ADMISSION_DENIED', attempts: [], elapsedMs: 1 },
        errorCode: 'ADMISSION_DENIED',
      });
      if (missingProof === 'audit')
        await prisma.auditLog.deleteMany({
          where: {
            organizationId: base.organization.id,
            resourceType: 'InferenceRun',
            resourceId: owner.runId,
            action: 'inference.native_finalized',
          },
        });
      else
        await prisma.inferenceRun.update({
          where: { organizationId: base.organization.id, id: owner.runId },
          data: { receiptHash: HASH },
        });
      expect(await previewObservationRegeneration(prisma, previewInput(base, 3))).toMatchObject({
        blockedReason: 'PRIOR_RUN_UNRESOLVED',
      });
    },
  );
});

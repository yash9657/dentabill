import { createHash, randomUUID } from 'node:crypto';

import type { Claim, ClaimObservation, Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { prisma } from '../client.js';

import {
  getClaimObservationEligibility,
  publishClaimObservation,
  reviewClaimObservation,
} from './claim-observations.js';
import { MissingOrgScopeError } from './errors.js';
import {
  beginFireworksAttempt,
  finalizeFireworksInference,
  finishFireworksAttempt,
  recordFireworksResponse,
  reserveFireworksInferenceRun,
} from './fireworks-inference.js';
import { getOrgScopedDb } from './with-org.js';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const TEXT = 'Payer reports payment $45.';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function fixture(existingClaim?: Claim, createdAt = NOW) {
  const organizationId =
    existingClaim?.organizationId ??
    (
      await prisma.organization.create({
        data: { name: 'Synthetic observation test', clerkOrgId: randomUUID() },
      })
    ).id;
  const user = await prisma.user.create({
    data: {
      organizationId,
      clerkUserId: randomUUID(),
      email: `${randomUUID()}@synthetic.invalid`,
      role: 'BILLING_STAFF',
    },
  });
  const claim =
    existingClaim ??
    (await prisma.claim.create({
      data: {
        organizationId,
        claimNumber: randomUUID(),
        patientDOBHash: 'synthetic',
        cdtCodes: ['D0150'],
        claimAmount: '100.00',
        payerCode: 'CIGNA_DENTAL',
        serviceDate: NOW,
        status: 'COMPLETED',
      },
    }));
  const call = await prisma.call.create({
    data: {
      organizationId,
      claimId: claim.id,
      retellCallId: randomUUID(),
      status: 'COMPLETED',
      createdAt,
    },
  });
  const event = await prisma.callEvent.create({
    data: {
      callId: call.id,
      eventType: 'webhook.call.ended',
      data: { transcript: { text: TEXT, turns: null } },
    },
  });
  const sourceVersion = createHash('sha256').update(TEXT).digest('hex');
  const sources = [
    {
      id: `transcript.${event.id}`,
      organizationId,
      claimId: claim.id,
      claimVersion: claim.updatedAt.toISOString(),
      version: sourceVersion,
      kind: 'FINAL_CALL_TRANSCRIPT',
      text: TEXT,
    },
  ];
  const request = {
    organizationId,
    invocationId: `observation.${call.id}`,
    releaseId: 'synthetic-native-release',
    task: 'claim-observation.v1',
    dataClass: 'SYNTHETIC',
    claim: {
      id: claim.id,
      organizationId,
      version: claim.updatedAt.toISOString(),
      billedMinorUnits: 10000,
      currency: 'USD',
    },
    sources,
  };
  const reservation = await reserveFireworksInferenceRun(prisma, {
    organizationId,
    callId: call.id,
    claimId: claim.id,
    claimVersion: claim.updatedAt,
    sourceHash: hash(sources),
    requestHash: hash(request),
    releasePolicyHash: 'c'.repeat(64),
    wireRequestHash: 'd'.repeat(64),
    releaseId: request.releaseId,
    promptVersion: 'claim-observation-prompt.v1',
    requestPayload: request,
    reservationTokens: 100,
    dailyTokenLimit: 10000,
    maxAttempts: 1,
    executionDeadlineAt: new Date(NOW.getTime() + 30_000),
    now: NOW,
  });
  if (reservation.kind !== 'OWNED') throw new Error('TEST_EXPECTED_OWNER');
  const ownership = {
    organizationId,
    runId: reservation.run.id,
    leaseToken: reservation.leaseToken,
    now: NOW,
  };
  await beginFireworksAttempt(prisma, {
    ...ownership,
    attemptNumber: 1,
    wireRequestHash: 'd'.repeat(64),
  });
  const evidence = [
    {
      sourceId: sources[0]!.id,
      sourceVersion,
      start: 0,
      end: TEXT.length,
      quote: TEXT,
    },
  ];
  const output = {
    disposition: 'OBSERVED',
    claimId: claim.id,
    claimVersion: claim.updatedAt.toISOString(),
    status: { value: 'PAID_REPORTED', evidence },
    payerReportedPayment: { amountMinorUnits: 4500, currency: 'USD', evidence },
    denialCodes: [],
    proposedAction: 'REVIEW_PAYMENT',
    abstentionReason: null,
  };
  const usage = { inputTokens: 30, outputTokens: 7, totalTokens: 37, cachedInputTokens: 0 };
  const attempt = {
    index: 1,
    httpStatus: 200,
    outcome: 'COMPLETED' as const,
    acceptance: 'RESPONDED' as const,
    elapsedMs: 0.25,
    usage,
  };
  await recordFireworksResponse(prisma, {
    ...ownership,
    attemptNumber: 1,
    response: { status: 200, body: JSON.stringify({ output }), retryDelayMs: null },
  });
  await finishFireworksAttempt(prisma, { ...ownership, attempt, errorCode: null });
  const result = {
    status: 'VALIDATED',
    output,
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
      elapsedMs: 1,
    },
  };
  await finalizeFireworksInference(prisma, {
    ...ownership,
    status: 'VALIDATED',
    resultPayload: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
    errorCode: null,
  });
  return { organizationId, claim, call, event, user, request, result, runId: reservation.run.id };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function publish(input: Fixture) {
  return publishClaimObservation(prisma, {
    organizationId: input.organizationId,
    runId: input.runId,
    validatedResult: input.result,
    now: NOW,
  });
}
function review(input: Fixture, observation: ClaimObservation) {
  return {
    organizationId: input.organizationId,
    clerkUserId: input.user.clerkUserId,
    observationId: observation.id,
    expectedObservationDigest: observation.digest,
    expectedClaimVersion: observation.claimVersion,
    decision: 'ACKNOWLEDGED' as const,
    now: NOW,
  };
}
async function rejectAudit(action: 'claimObservation.published' | 'claimObservation.reviewed') {
  // Static test-owned trigger; only the enumerated action changes the synthetic fault.
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION observation_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION 'synthetic observation audit failure'; END IF; RETURN NEW; END $$`,
  );
  await prisma.$executeRawUnsafe(
    'CREATE TRIGGER observation_test_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION observation_test_fail_audit()',
  );
}
async function restoreAudit() {
  await prisma.$executeRawUnsafe('DROP TRIGGER observation_test_fail_audit ON "AuditLog"');
  await prisma.$executeRawUnsafe('DROP FUNCTION observation_test_fail_audit()');
}

describe('native claim observation publication and review', () => {
  it('publishes one immutable observation under concurrent delivery without changing claims, legacy summaries, or usage', async () => {
    const input = await fixture();
    const results = await Promise.all([publish(input), publish(input), publish(input)]);
    expect(results.map((entry) => entry.kind).sort()).toEqual([
      'ALREADY_PUBLISHED',
      'ALREADY_PUBLISHED',
      'PUBLISHED',
    ]);
    expect(new Set(results.map((entry) => entry.observation.id)).size).toBe(1);
    expect(results[0].observation).toMatchObject({
      version: 1,
      dataClass: 'SYNTHETIC',
      provider: 'FIREWORKS',
      sources: input.request.sources,
      output: input.result.output,
    });
    expect(
      await prisma.claim.findFirst({
        where: { id: input.claim.id, organizationId: input.organizationId },
      }),
    ).toEqual(input.claim);
    expect(
      await prisma.callSummary.count({ where: { organizationId: input.organizationId } }),
    ).toBe(0);
    expect(
      await prisma.inferenceRun.findFirst({
        where: { id: input.runId, organizationId: input.organizationId },
      }),
    ).toMatchObject({ state: 'APPLIED', totalTokens: 37n });
    expect(
      await prisma.inferenceAttempt.count({ where: { organizationId: input.organizationId } }),
    ).toBe(1);
    expect(
      await prisma.inferenceBudget.findFirst({ where: { organizationId: input.organizationId } }),
    ).toMatchObject({ knownTokens: 37n, reservedTokens: 0n });
    const audits = await prisma.auditLog.findMany({
      where: { organizationId: input.organizationId, action: 'claimObservation.published' },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(TEXT);
  });

  it('rolls back publication and APPLIED on audit failure, then retries the frozen result', async () => {
    const input = await fixture();
    await rejectAudit('claimObservation.published');
    try {
      await expect(publish(input)).rejects.toThrow();
      expect(
        await prisma.claimObservation.count({ where: { organizationId: input.organizationId } }),
      ).toBe(0);
      expect(
        await prisma.inferenceRun.findFirst({
          where: { organizationId: input.organizationId, id: input.runId },
        }),
      ).toMatchObject({ state: 'RESPONDED', resultPayload: input.result });
    } finally {
      await restoreAudit();
    }
    expect((await publish(input)).kind).toBe('PUBLISHED');
    expect(
      await prisma.inferenceAttempt.count({ where: { organizationId: input.organizationId } }),
    ).toBe(1);
  });

  it('assigns revisions by publication order but keeps newer source evidence current when an older call arrives late', async () => {
    const first = await fixture();
    const firstObservation = (await publish(first)).observation;
    const newest = await fixture(first.claim, new Date(NOW.getTime() + 2000));
    const newestObservation = (await publish(newest)).observation;
    const late = await fixture(first.claim, new Date(NOW.getTime() + 1000));
    const lateObservation = (await publish(late)).observation;
    expect(newestObservation).toMatchObject({
      version: 2,
      previousObservationId: firstObservation.id,
      supersedesObservationId: firstObservation.id,
    });
    expect(lateObservation).toMatchObject({
      version: 3,
      previousObservationId: newestObservation.id,
      supersedesObservationId: null,
    });
    expect(
      await getClaimObservationEligibility(prisma, {
        organizationId: first.organizationId,
        observationId: newestObservation.id,
      }),
    ).toMatchObject({ isCurrent: true, canReview: true, staleReason: null });
    expect(
      await getClaimObservationEligibility(prisma, {
        organizationId: first.organizationId,
        observationId: lateObservation.id,
      }),
    ).toMatchObject({ isCurrent: false, canReview: false, staleReason: 'SUPERSEDED' });
    await expect(
      reviewClaimObservation(prisma, review(late, lateObservation)),
    ).rejects.toMatchObject({ code: 'OBSERVATION_STALE' });
  });

  it('blocks review after a newer call exists even before it produces an observation', async () => {
    const input = await fixture();
    const observation = (await publish(input)).observation;
    await prisma.call.create({
      data: {
        organizationId: input.organizationId,
        claimId: input.claim.id,
        status: 'INITIATED',
        retellCallId: randomUUID(),
        createdAt: new Date(NOW.getTime() + 1),
      },
    });
    expect(
      await getClaimObservationEligibility(prisma, {
        organizationId: input.organizationId,
        observationId: observation.id,
      }),
    ).toMatchObject({ isCurrent: true, canReview: false, staleReason: 'NEWER_CALL' });
    await expect(reviewClaimObservation(prisma, review(input, observation))).rejects.toMatchObject({
      code: 'OBSERVATION_STALE',
    });
  });

  it('uses the original intent chronology when reconciliation inserts an older call after newer evidence', async () => {
    const newer = await fixture(undefined, new Date(NOW.getTime() + 1000));
    const newerObservation = (await publish(newer)).observation;
    const recovered = await fixture(newer.claim, new Date(NOW.getTime() + 10000));
    await prisma.callIntent.create({
      data: {
        organizationId: recovered.organizationId,
        claimId: recovered.claim.id,
        callId: recovered.call.id,
        idempotencyKey: randomUUID(),
        payerCode: 'CIGNA_DENTAL',
        claimPriority: 0,
        attemptNumber: 1,
        claimVersion: recovered.claim.updatedAt,
        state: 'TERMINAL',
        createdAt: NOW,
      },
    });
    // Even before publication, recovered historical evidence is not a new call.
    expect(
      await getClaimObservationEligibility(prisma, {
        organizationId: newer.organizationId,
        observationId: newerObservation.id,
      }),
    ).toMatchObject({ canReview: true });
    const recoveredObservation = (await publish(recovered)).observation;
    expect(recoveredObservation).toMatchObject({
      version: 2,
      previousObservationId: newerObservation.id,
      supersedesObservationId: null,
    });
    expect(
      await getClaimObservationEligibility(prisma, {
        organizationId: newer.organizationId,
        observationId: newerObservation.id,
      }),
    ).toMatchObject({ isCurrent: true, canReview: true });
    expect(
      await getClaimObservationEligibility(prisma, {
        organizationId: recovered.organizationId,
        observationId: recoveredObservation.id,
      }),
    ).toMatchObject({ isCurrent: false, staleReason: 'SUPERSEDED' });
  });

  it('rejects final evidence changed between worker validation and publication', async () => {
    const input = await fixture();
    await prisma.callEvent.update({
      where: { id: input.event.id },
      data: { data: { transcript: { text: 'Different synthetic evidence', turns: null } } },
    });
    await expect(publish(input)).rejects.toMatchObject({ code: 'INVALID_INFERENCE_RESULT' });
    expect(
      await prisma.claimObservation.count({ where: { organizationId: input.organizationId } }),
    ).toBe(0);
    expect(
      await prisma.inferenceRun.findFirst({
        where: { id: input.runId, organizationId: input.organizationId },
      }),
    ).toMatchObject({ state: 'RESPONDED' });
  });

  it.each([false, true])(
    'marks corrected final evidence stale even when reviewed=%s and preserves exact recorded retries',
    async (alreadyReviewed) => {
      const input = await fixture();
      const observation = (await publish(input)).observation;
      const command = review(input, observation);
      const originalReview = alreadyReviewed
        ? (await reviewClaimObservation(prisma, command)).review
        : null;
      await prisma.callEvent.create({
        data: {
          callId: input.call.id,
          eventType: 'webhook.call.ended',
          timestamp: new Date(input.event.timestamp.getTime() + 1),
          data: { transcript: { text: 'Corrected: payer reports payment $35.', turns: null } },
        },
      });
      expect(
        await getClaimObservationEligibility(prisma, {
          organizationId: input.organizationId,
          observationId: observation.id,
        }),
      ).toMatchObject({
        isCurrent: true,
        canReview: false,
        reviewed: alreadyReviewed,
        staleReason: 'TRANSCRIPT_CHANGED',
      });
      if (originalReview) {
        expect(await reviewClaimObservation(prisma, command)).toEqual({
          kind: 'ALREADY_RECORDED',
          review: originalReview,
        });
        await expect(
          reviewClaimObservation(prisma, {
            ...command,
            decision: 'DISMISSED',
            note: 'Changed decision',
          }),
        ).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' });
      } else {
        await expect(reviewClaimObservation(prisma, command)).rejects.toMatchObject({
          code: 'OBSERVATION_STALE',
        });
      }
      expect(
        await prisma.claim.findFirst({
          where: { id: input.claim.id, organizationId: input.organizationId },
        }),
      ).toEqual(input.claim);
      expect(
        await prisma.claimObservationReview.count({
          where: { organizationId: input.organizationId },
        }),
      ).toBe(alreadyReviewed ? 1 : 0);
    },
  );

  it.each(['changed', 'deleted', 'cleared'] as const)(
    'rejects review when the bound final source is %s',
    async (change) => {
      const input = await fixture();
      const observation = (await publish(input)).observation;
      if (change === 'changed') {
        await prisma.callEvent.update({
          where: { id: input.event.id },
          data: {
            data: { transcript: { text: 'Changed synthetic source', turns: null } },
          },
        });
      } else if (change === 'deleted') {
        await prisma.callEvent.delete({ where: { id: input.event.id } });
      } else {
        await prisma.callEvent.create({
          data: {
            callId: input.call.id,
            eventType: 'call.ended',
            timestamp: new Date(input.event.timestamp.getTime() + 1),
            data: { transcript: { text: null, turns: null } },
          },
        });
      }
      expect(
        await getClaimObservationEligibility(prisma, {
          organizationId: input.organizationId,
          observationId: observation.id,
        }),
      ).toMatchObject({ canReview: false, staleReason: 'TRANSCRIPT_CHANGED' });
      await expect(
        reviewClaimObservation(prisma, review(input, observation)),
      ).rejects.toMatchObject({ code: 'OBSERVATION_STALE' });
      expect(
        await prisma.claimObservationReview.count({
          where: { organizationId: input.organizationId },
        }),
      ).toBe(0);
    },
  );

  it.each(['OWNER', 'ADMIN', 'BILLING_STAFF'] as const)(
    'allows stored %s review once and makes exact retries idempotent after later claim changes',
    async (role) => {
      const input = await fixture();
      await prisma.user.update({
        where: { organizationId: input.organizationId, id: input.user.id },
        data: { role },
      });
      const observation = (await publish(input)).observation;
      const command = {
        ...review(input, observation),
        decision: 'DISMISSED' as const,
        note: '  Synthetic reviewer note  ',
      };
      const recorded = await reviewClaimObservation(prisma, command);
      expect(recorded).toMatchObject({
        kind: 'RECORDED',
        review: { reviewedByRole: role, note: 'Synthetic reviewer note' },
      });
      expect(
        await getClaimObservationEligibility(prisma, {
          organizationId: input.organizationId,
          observationId: observation.id,
        }),
      ).toMatchObject({ reviewed: true, canReview: false, staleReason: 'ALREADY_REVIEWED' });
      await prisma.claim.update({
        where: { id: input.claim.id, organizationId: input.organizationId },
        data: { updatedAt: new Date(input.claim.updatedAt.getTime() + 1000) },
      });
      expect((await reviewClaimObservation(prisma, command)).kind).toBe('ALREADY_RECORDED');
      await expect(
        reviewClaimObservation(prisma, { ...command, note: 'different' }),
      ).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' });
      expect(
        await prisma.claimObservationReview.count({
          where: { organizationId: input.organizationId },
        }),
      ).toBe(1);
      const audits = await prisma.auditLog.findMany({
        where: { organizationId: input.organizationId, action: 'claimObservation.reviewed' },
      });
      expect(audits).toHaveLength(1);
      expect(JSON.stringify(audits)).not.toContain('Synthetic reviewer note');
    },
  );

  it('rejects stale claim versions, changed digest, and invalid dismissal notes before recording review', async () => {
    const input = await fixture();
    const observation = (await publish(input)).observation;
    const command = review(input, observation);
    await expect(
      reviewClaimObservation(prisma, { ...command, expectedObservationDigest: 'a'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' });
    for (const note of ['', ' ', 'x'.repeat(1001)]) {
      await expect(
        reviewClaimObservation(prisma, { ...command, decision: 'DISMISSED', note }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    await prisma.claim.update({
      where: { id: input.claim.id, organizationId: input.organizationId },
      data: { updatedAt: new Date(input.claim.updatedAt.getTime() + 1000) },
    });
    await expect(reviewClaimObservation(prisma, command)).rejects.toMatchObject({
      code: 'CLAIM_CHANGED',
    });
    expect(
      await prisma.claimObservationReview.count({
        where: { organizationId: input.organizationId },
      }),
    ).toBe(0);
  });

  it('serializes conflicting reviewers and rolls review/audit back together', async () => {
    const input = await fixture();
    const observation = (await publish(input)).observation;
    const command = review(input, observation);
    await rejectAudit('claimObservation.reviewed');
    try {
      await expect(reviewClaimObservation(prisma, command)).rejects.toThrow();
      expect(
        await prisma.claimObservationReview.count({
          where: { organizationId: input.organizationId },
        }),
      ).toBe(0);
    } finally {
      await restoreAudit();
    }
    const concurrent = await Promise.allSettled([
      reviewClaimObservation(prisma, command),
      reviewClaimObservation(prisma, {
        ...command,
        decision: 'DISMISSED',
        note: 'Synthetic disagreement',
      }),
    ]);
    expect(concurrent.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter((entry) => entry.status === 'rejected')).toHaveLength(1);
    expect(
      await prisma.claimObservationReview.count({
        where: { organizationId: input.organizationId },
      }),
    ).toBe(1);
    expect(
      await prisma.claim.findFirst({
        where: { organizationId: input.organizationId, id: input.claim.id },
      }),
    ).toEqual(input.claim);
  });

  it('isolates scoped observation/review reads, actor permissions, publication, and unscoped writes', async () => {
    const input = await fixture();
    const other = await fixture();
    const observation = (await publish(input)).observation;
    await reviewClaimObservation(prisma, review(input, observation));
    const foreign = (await publish(other)).observation;
    expect(await getOrgScopedDb(other.organizationId).claimObservation.count()).toBe(1);
    expect(
      await getOrgScopedDb(other.organizationId).claimObservation.findFirst({
        where: { id: observation.id },
      }),
    ).toBeNull();
    expect(await getOrgScopedDb(other.organizationId).claimObservationReview.count()).toBe(0);
    await expect(
      getClaimObservationEligibility(prisma, {
        organizationId: other.organizationId,
        observationId: observation.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      reviewClaimObservation(prisma, {
        ...review(other, foreign),
        clerkUserId: input.user.clerkUserId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      publishClaimObservation(prisma, {
        organizationId: other.organizationId,
        runId: input.runId,
        validatedResult: input.result,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      prisma.claimObservation.updateMany({
        where: { id: observation.id },
        data: { digest: 'f'.repeat(64) },
      }),
    ).rejects.toThrow(MissingOrgScopeError);
    await expect(
      prisma.claimObservationReview.deleteMany({ where: { observationId: observation.id } }),
    ).rejects.toThrow(MissingOrgScopeError);
  });

  it('rejects forged result envelopes and a mismatched frozen request binding', async () => {
    const input = await fixture();
    await expect(
      publishClaimObservation(prisma, {
        organizationId: input.organizationId,
        runId: input.runId,
        validatedResult: {
          ...input.result,
          output: { ...input.result.output, claimId: 'different' },
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INFERENCE_RESULT' });
    // The native ledger permits opaque request payloads; publication additionally enforces the v1 envelope.
    const invalidCall = await prisma.call.create({
      data: {
        organizationId: input.organizationId,
        claimId: input.claim.id,
        retellCallId: randomUUID(),
        status: 'COMPLETED',
      },
    });
    const invalidRun = await prisma.inferenceRun.create({
      data: {
        organizationId: input.organizationId,
        callId: invalidCall.id,
        claimId: input.claim.id,
        claimVersion: input.claim.updatedAt,
        generation: 1,
        provider: 'FIREWORKS',
        releaseId: input.request.releaseId,
        promptVersion: 'claim-observation-prompt.v1',
        requestPayload: { ...input.request, organizationId: 'different' },
        sourceHash: hash(input.request.sources),
        requestHash: 'a'.repeat(64),
        resultPayload: input.result,
        tokenAllowance: 100,
        reservedTokens: 0,
        billingDay: '2026-10-13',
        state: 'RESPONDED',
      },
    });
    await expect(
      publishClaimObservation(prisma, {
        organizationId: input.organizationId,
        runId: invalidRun.id,
        validatedResult: input.result,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INFERENCE_RESULT' });
    expect(
      await prisma.claimObservation.count({ where: { organizationId: input.organizationId } }),
    ).toBe(0);
  });

  it('enforces database immutability and compound tenant/claim/run references', async () => {
    const input = await fixture();
    const observation = (await publish(input)).observation;
    const recorded = (await reviewClaimObservation(prisma, review(input, observation))).review;
    await expect(
      prisma.claimObservation.update({
        where: { organizationId: input.organizationId, id: observation.id },
        data: { output: {} },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.claimObservation.delete({
        where: { organizationId: input.organizationId, id: observation.id },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.claimObservationReview.update({
        where: { organizationId: input.organizationId, id: recorded.id },
        data: { note: 'Changed' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.claimObservationReview.delete({
        where: { organizationId: input.organizationId, id: recorded.id },
      }),
    ).rejects.toThrow();
    const other = await fixture();
    const { id: _id, ...snapshot } = observation;
    await expect(
      prisma.claimObservation.create({
        data: {
          ...snapshot,
          organizationId: other.organizationId,
          inferenceRunId: other.runId,
          version: 2,
          output: snapshot.output as Prisma.InputJsonValue,
          sources: snapshot.sources as Prisma.InputJsonValue,
          provenance: snapshot.provenance as Prisma.InputJsonValue,
        },
      }),
    ).rejects.toThrow();
  });
});

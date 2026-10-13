import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { prisma } from '../client.js';

import {
  beginFireworksAttempt,
  finalizeFireworksInference,
  finishFireworksAttempt,
  getFireworksAttemptReceipt,
  parseFireworksRawResponse,
  recordFireworksResponse,
  reserveFireworksInferenceRun,
  type FireworksAttemptReceipt,
  type ReserveFireworksInferenceInput,
} from './fireworks-inference.js';
import { beginInferenceAttempt, reserveInferenceRun, saveInferenceReceipt } from './inference.js';

const NOW = new Date('2026-10-13T23:59:59.000Z');
const NEXT_DAY = new Date('2026-10-14T00:00:01.000Z');
const EXPIRED = new Date('2026-10-14T00:02:00.000Z');
const UNKNOWN = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  cachedInputTokens: null,
};

async function fixture(organizationId?: string): Promise<ReserveFireworksInferenceInput> {
  const organization =
    organizationId ??
    (
      await prisma.organization.create({
        data: { name: 'Synthetic native ledger', clerkOrgId: randomUUID() },
      })
    ).id;
  const claim = await prisma.claim.create({
    data: {
      organizationId: organization,
      claimNumber: randomUUID(),
      patientDOBHash: 'synthetic',
      cdtCodes: ['D0150'],
      claimAmount: '100.00',
      payerCode: 'CIGNA_DENTAL',
      serviceDate: NOW,
      status: 'COMPLETED',
    },
  });
  const call = await prisma.call.create({
    data: {
      organizationId: organization,
      claimId: claim.id,
      retellCallId: randomUUID(),
      status: 'COMPLETED',
    },
  });
  return {
    organizationId: organization,
    callId: call.id,
    claimId: claim.id,
    claimVersion: claim.updatedAt,
    sourceHash: 'a'.repeat(64),
    requestHash: 'b'.repeat(64),
    releasePolicyHash: 'c'.repeat(64),
    wireRequestHash: 'd'.repeat(64),
    releaseId: 'synthetic-native-release',
    promptVersion: 'claim-observation-prompt.v1',
    requestPayload: { synthetic: true },
    reservationTokens: 100,
    dailyTokenLimit: 500,
    maxAttempts: 2,
    executionDeadlineAt: new Date(NOW.getTime() + 30_000),
    now: NOW,
  };
}
async function owned(input: ReserveFireworksInferenceInput) {
  const reservation = await reserveFireworksInferenceRun(prisma, input);
  if (!['OWNED', 'REPLAY', 'RESUME'].includes(reservation.kind) || !('leaseToken' in reservation))
    throw new Error('TEST_EXPECTED_OWNER');
  return {
    ...reservation,
    ownership: {
      organizationId: input.organizationId,
      runId: reservation.run.id,
      leaseToken: reservation.leaseToken,
      now: input.now ?? NOW,
    },
  };
}
function completed(
  index = 1,
  httpStatus = 200,
  totalTokens: number | null = 37,
): FireworksAttemptReceipt {
  return {
    index,
    httpStatus,
    outcome: httpStatus === 200 ? 'COMPLETED' : 'HTTP_ERROR',
    acceptance: 'RESPONDED',
    elapsedMs: 20,
    usage:
      totalTokens === null
        ? UNKNOWN
        : { inputTokens: totalTokens - 7, outputTokens: 7, totalTokens, cachedInputTokens: 0 },
  };
}
async function submit(input: ReserveFireworksInferenceInput) {
  const owner = await owned(input);
  expect(
    await beginFireworksAttempt(prisma, {
      ...owner.ownership,
      attemptNumber: 1,
      wireRequestHash: input.wireRequestHash,
    }),
  ).toMatchObject({ kind: 'ADMITTED' });
  return owner;
}
async function response(
  owner: Awaited<ReturnType<typeof owned>>,
  status = 200,
  attemptNumber: 1 | 2 = 1,
  now = NOW,
) {
  return recordFireworksResponse(prisma, {
    ...owner.ownership,
    now,
    attemptNumber,
    response: { status, body: '{"synthetic":true}', retryDelayMs: null },
  });
}
function result(input: ReserveFireworksInferenceInput, attempts: FireworksAttemptReceipt[]) {
  return {
    status: 'VALIDATED',
    output: { synthetic: true },
    requiresHumanReview: true,
    provenance: {
      kind: 'FIREWORKS',
      releaseId: input.releaseId,
      attempts: attempts.map((attempt) => ({ ...attempt, usage: { ...attempt.usage } })),
    },
  };
}
async function budget(organizationId: string, billingDay = '2026-10-13') {
  return prisma.inferenceBudget.findFirstOrThrow({ where: { organizationId, billingDay } });
}

describe('native Fireworks durable attempt journal', () => {
  it('stores raw evidence before completion and replays after the original deadline without another admission', async () => {
    const input = await fixture();
    const owner = await submit(input);
    const raw = await response(owner);
    expect(raw).toMatchObject({
      responsePayload: { status: 200, body: '{"synthetic":true}', retryDelayMs: null },
      completionHash: null,
    });
    expect(parseFireworksRawResponse(raw.responsePayload)?.status).toBe(200);
    expect(getFireworksAttemptReceipt(raw)).toBeNull();
    const restarted = await owned({
      ...input,
      now: EXPIRED,
      executionDeadlineAt: new Date('2099-01-01'),
    });
    expect(restarted.kind).toBe('REPLAY');
    expect(restarted.run.executionDeadlineAt).toEqual(input.executionDeadlineAt);
    expect(
      await beginFireworksAttempt(prisma, {
        ...restarted.ownership,
        attemptNumber: 1,
        wireRequestHash: input.wireRequestHash,
      }),
    ).toMatchObject({ kind: 'REPLAY' });
    await expect(
      recordFireworksResponse(prisma, {
        ...owner.ownership,
        attemptNumber: 1,
        response: { status: 200, body: 'stale sender', retryDelayMs: null },
      }),
    ).rejects.toThrow('FIREWORKS_INFERENCE_CONFLICT');
    const finished = await finishFireworksAttempt(prisma, {
      ...restarted.ownership,
      attempt: completed(),
      errorCode: null,
    });
    expect(getFireworksAttemptReceipt(finished)).toEqual(completed());
    const stored = await finalizeFireworksInference(prisma, {
      ...restarted.ownership,
      status: 'VALIDATED',
      resultPayload: result(input, [completed()]),
      errorCode: null,
    });
    expect(stored).toMatchObject({ state: 'RESPONDED', totalTokens: 37n, reservedTokens: 0n });
    expect(
      (
        await finalizeFireworksInference(prisma, {
          ...restarted.ownership,
          status: 'VALIDATED',
          resultPayload: result(input, [completed()]),
          errorCode: null,
        })
      ).id,
    ).toBe(stored.id);
    expect(await budget(input.organizationId)).toMatchObject({
      knownTokens: 37n,
      reservedTokens: 0n,
    });
    expect((await owned({ ...input, now: EXPIRED })).kind).toBe('RESUME');
    expect((await owned({ ...input, now: EXPIRED })).kind).toBe('RESUME');
    expect(
      await prisma.inferenceAttempt.count({ where: { organizationId: input.organizationId } }),
    ).toBe(1);
  });

  it('preserves prior unknown liability when a separately admitted retry succeeds across UTC midnight', async () => {
    const input = await fixture();
    const owner = await submit(input);
    await response(owner, 503);
    await finishFireworksAttempt(prisma, {
      ...owner.ownership,
      attempt: completed(1, 503, null),
      errorCode: 'HTTP_ERROR',
    });
    expect(
      await beginFireworksAttempt(prisma, {
        ...owner.ownership,
        now: NEXT_DAY,
        attemptNumber: 2,
        wireRequestHash: input.wireRequestHash,
      }),
    ).toMatchObject({
      kind: 'ADMITTED',
      attempt: { billingDay: '2026-10-14', reservedTokens: 100n },
    });
    expect(await budget(input.organizationId)).toMatchObject({
      knownTokens: 0n,
      reservedTokens: 100n,
    });
    expect(await budget(input.organizationId, '2026-10-14')).toMatchObject({
      knownTokens: 0n,
      reservedTokens: 100n,
    });
    await response(owner, 200, 2, NEXT_DAY);
    await finishFireworksAttempt(prisma, {
      ...owner.ownership,
      now: NEXT_DAY,
      attempt: completed(2),
      errorCode: null,
    });
    const stored = await finalizeFireworksInference(prisma, {
      ...owner.ownership,
      now: NEXT_DAY,
      status: 'VALIDATED',
      resultPayload: result(input, [completed(1, 503, null), completed(2)]),
      errorCode: null,
    });
    expect(stored).toMatchObject({ totalTokens: null, reservedTokens: 100n, state: 'RESPONDED' });
    expect(await budget(input.organizationId)).toMatchObject({
      knownTokens: 0n,
      reservedTokens: 100n,
    });
    expect(await budget(input.organizationId, '2026-10-14')).toMatchObject({
      knownTokens: 37n,
      reservedTokens: 0n,
    });
    const other = await fixture(input.organizationId);
    expect(
      await reserveFireworksInferenceRun(prisma, {
        ...other,
        now: NEXT_DAY,
        reservationTokens: 400,
      }),
    ).toMatchObject({ kind: 'BUDGET_EXCEEDED' });
  });

  it('requires a complete retryable error receipt and full additional allocation before concurrent attempt-two admission', async () => {
    const input = await fixture();
    const owner = await submit(input);
    await response(owner, 429);
    const next = {
      ...owner.ownership,
      attemptNumber: 2 as const,
      wireRequestHash: input.wireRequestHash,
    };
    expect(await beginFireworksAttempt(prisma, next)).toMatchObject({ kind: 'BLOCKED' });
    await finishFireworksAttempt(prisma, {
      ...owner.ownership,
      attempt: completed(1, 429, null),
      errorCode: 'HTTP_ERROR',
    });
    const attempts = await Promise.all([
      beginFireworksAttempt(prisma, next),
      beginFireworksAttempt(prisma, next),
    ]);
    expect(attempts.map((entry) => entry.kind).sort()).toEqual(['ADMITTED', 'REPLAY']);
    expect(await budget(input.organizationId)).toMatchObject({ reservedTokens: 200n });
    expect(
      await prisma.inferenceAttempt.count({ where: { organizationId: input.organizationId } }),
    ).toBe(2);
  });

  it('blocks a retry when the previous unknown reservation plus new full allocation exceeds the budget', async () => {
    const input = { ...(await fixture()), dailyTokenLimit: 150 };
    const owner = await submit(input);
    await response(owner, 503);
    await finishFireworksAttempt(prisma, {
      ...owner.ownership,
      attempt: completed(1, 503, null),
      errorCode: 'HTTP_ERROR',
    });
    expect(
      await beginFireworksAttempt(prisma, {
        ...owner.ownership,
        attemptNumber: 2,
        wireRequestHash: input.wireRequestHash,
      }),
    ).toMatchObject({ kind: 'BUDGET_EXCEEDED' });
    expect(await budget(input.organizationId)).toMatchObject({ reservedTokens: 100n });
  });

  it('refunds an expired proven-unsent reservation across days, fences its old owner, and repeats the same disposition', async () => {
    const input = await fixture();
    const owner = await owned(input);
    const deadline = new Date(input.executionDeadlineAt.getTime() + 1);
    expect(owner.run.leaseExpiresAt?.getTime()).toBeGreaterThan(deadline.getTime());
    expect(await reserveFireworksInferenceRun(prisma, { ...input, now: deadline })).toMatchObject({
      kind: 'DEADLINE_EXCEEDED',
      run: { state: 'REJECTED', reservedTokens: 0n, totalTokens: 0n, leaseToken: null },
    });
    expect(await budget(input.organizationId)).toMatchObject({
      reservedTokens: 0n,
      knownTokens: 0n,
    });
    expect(await reserveFireworksInferenceRun(prisma, { ...input, now: EXPIRED })).toMatchObject({
      kind: 'DEADLINE_EXCEEDED',
    });
    await expect(
      beginFireworksAttempt(prisma, {
        ...owner.ownership,
        attemptNumber: 1,
        wireRequestHash: input.wireRequestHash,
      }),
    ).rejects.toThrow('FIREWORKS_INFERENCE_CONFLICT');
    expect(
      await prisma.inferenceAttempt.count({ where: { organizationId: input.organizationId } }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: input.organizationId, action: 'inference.native_unsent_deadline' },
      }),
    ).toBe(1);
  });

  it('never resends ambiguous submission after lease expiry or permits retry after the fixed deadline', async () => {
    const input = await fixture();
    const owner = await submit(input);
    expect(await reserveFireworksInferenceRun(prisma, { ...input, now: EXPIRED })).toMatchObject({
      kind: 'REVIEW_REQUIRED',
      run: { state: 'UNKNOWN', reservedTokens: 100n },
    });
    expect(
      await beginFireworksAttempt(prisma, {
        ...owner.ownership,
        now: EXPIRED,
        attemptNumber: 1,
        wireRequestHash: input.wireRequestHash,
      }),
    ).toMatchObject({ kind: 'REPLAY' });
    await response(owner, 503, 1, EXPIRED);
    const replay = await owned({ ...input, now: EXPIRED });
    await finishFireworksAttempt(prisma, {
      ...replay.ownership,
      attempt: completed(1, 503, null),
      errorCode: 'HTTP_ERROR',
    });
    expect(
      await beginFireworksAttempt(prisma, {
        ...replay.ownership,
        attemptNumber: 2,
        wireRequestHash: input.wireRequestHash,
      }),
    ).toMatchObject({ kind: 'DEADLINE_EXCEEDED' });
    expect(
      await prisma.inferenceAttempt.count({ where: { organizationId: input.organizationId } }),
    ).toBe(1);
  });

  it('settles known usage independently of schema failure and handles replay elapsed time without double charging', async () => {
    const input = await fixture();
    const owner = await submit(input);
    await response(owner);
    const first = await finishFireworksAttempt(prisma, {
      ...owner.ownership,
      attempt: completed(),
      errorCode: null,
    });
    const replay = { ...completed(), elapsedMs: 1 };
    const second = await finishFireworksAttempt(prisma, {
      ...owner.ownership,
      attempt: replay,
      errorCode: null,
    });
    expect(second.id).toBe(first.id);
    expect(second.elapsedMs).toBe(20);
    const stored = await finalizeFireworksInference(prisma, {
      ...owner.ownership,
      status: 'FAILED',
      resultPayload: {
        status: 'FAILED',
        code: 'OUTPUT_SCHEMA_INVALID',
        attempts: [{ ...replay, usage: { ...replay.usage } }],
        elapsedMs: 1,
      },
      errorCode: 'OUTPUT_SCHEMA_INVALID',
    });
    expect(stored).toMatchObject({ state: 'REJECTED', totalTokens: 37n, reservedTokens: 0n });
    expect(await budget(input.organizationId)).toMatchObject({
      knownTokens: 37n,
      reservedTokens: 0n,
    });
  });

  it.each([200, 503])(
    'refines interrupted parsing only from immutable raw HTTP %i evidence and retains original completion history',
    async (status) => {
      const input = await fixture();
      const owner = await submit(input);
      const raw = await response(owner, status);
      const interrupted: FireworksAttemptReceipt = {
        ...completed(1, status, null),
        outcome: 'CANCELLED',
        elapsedMs: 1.25,
      };
      const old = await finishFireworksAttempt(prisma, {
        ...owner.ownership,
        attempt: interrupted,
        errorCode: 'CANCELLED',
      });
      const restarted = await owned({ ...input, now: EXPIRED });
      expect(restarted.kind).toBe('REPLAY');
      const interpreted = { ...completed(1, status, status === 200 ? 37 : null), elapsedMs: 0.125 };
      const refined = await finishFireworksAttempt(prisma, {
        ...restarted.ownership,
        attempt: interpreted,
        errorCode: status === 200 ? null : 'HTTP_ERROR',
      });
      expect(refined.responseHash).toBe(raw.responseHash);
      expect(refined.completionHistory).toEqual([
        {
          completionHash: old.completionHash,
          attempt: interrupted,
          errorCode: 'CANCELLED',
          completedAt: NOW.toISOString(),
        },
      ]);
      expect(refined.elapsedMs).toBe(0.125);
      await finishFireworksAttempt(prisma, {
        ...restarted.ownership,
        attempt: interpreted,
        errorCode: status === 200 ? null : 'HTTP_ERROR',
      });
      expect(await budget(input.organizationId)).toMatchObject({
        knownTokens: status === 200 ? 37n : 0n,
        reservedTokens: status === 200 ? 0n : 100n,
      });
      if (status === 200) {
        await expect(
          finishFireworksAttempt(prisma, {
            ...restarted.ownership,
            attempt: completed(1, 200, 38),
            errorCode: null,
          }),
        ).rejects.toThrow('FIREWORKS_INFERENCE_CONFLICT');
      } else {
        expect(
          await beginFireworksAttempt(prisma, {
            ...restarted.ownership,
            attemptNumber: 2,
            wireRequestHash: input.wireRequestHash,
          }),
        ).toMatchObject({ kind: 'DEADLINE_EXCEEDED' });
      }
    },
  );

  it.each([
    { inputTokens: 10_000, outputTokens: 100, totalTokens: 0, cachedInputTokens: 0 },
    { inputTokens: null, outputTokens: 8, totalTokens: 7, cachedInputTokens: null },
    { inputTokens: 10, outputTokens: 7, totalTokens: 17, cachedInputTokens: 11 },
  ])('retains the reservation for contradictory reported usage %j', async (usage) => {
    const input = await fixture();
    const owner = await submit(input);
    await response(owner);
    await expect(
      finishFireworksAttempt(prisma, {
        ...owner.ownership,
        attempt: { ...completed(), usage },
        errorCode: null,
      }),
    ).rejects.toThrow('FIREWORKS_INFERENCE_CONFLICT');
    expect(await budget(input.organizationId)).toMatchObject({
      knownTokens: 0n,
      reservedTokens: 100n,
    });
    expect(
      await prisma.inferenceAttempt.findFirstOrThrow({
        where: { organizationId: input.organizationId },
      }),
    ).toMatchObject({
      completionHash: null,
      totalTokens: null,
      responseRecordedAt: expect.any(Date),
    });
  });

  it('rolls back completion and its accounting if the audit transaction fails, retaining the raw response', async () => {
    const input = await fixture();
    const owner = await submit(input);
    await response(owner);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION native_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'inference.native_attempt_finished' THEN RAISE EXCEPTION 'synthetic journal failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER native_test_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION native_test_fail_audit()`,
    );
    try {
      await expect(
        finishFireworksAttempt(prisma, {
          ...owner.ownership,
          attempt: completed(),
          errorCode: null,
        }),
      ).rejects.toThrow();
      expect(
        await prisma.inferenceAttempt.findFirstOrThrow({
          where: { organizationId: input.organizationId },
        }),
      ).toMatchObject({ completionHash: null, responseRecordedAt: expect.any(Date) });
      expect(await budget(input.organizationId)).toMatchObject({
        knownTokens: 0n,
        reservedTokens: 100n,
      });
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER native_test_fail_audit ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION native_test_fail_audit()`);
    }
    await finishFireworksAttempt(prisma, {
      ...owner.ownership,
      attempt: completed(),
      errorCode: null,
    });
    expect(await budget(input.organizationId)).toMatchObject({
      knownTokens: 37n,
      reservedTokens: 0n,
    });
  });

  it('rejects mutated raw evidence, mismatched final attempts, and invented success without a response', async () => {
    const input = await fixture();
    const owner = await submit(input);
    await expect(
      finishFireworksAttempt(prisma, { ...owner.ownership, attempt: completed(), errorCode: null }),
    ).rejects.toThrow('FIREWORKS_INFERENCE_CONFLICT');
    const raw = await response(owner);
    expect((await response(owner)).responseHash).toBe(raw.responseHash);
    await expect(
      recordFireworksResponse(prisma, {
        ...owner.ownership,
        attemptNumber: 1,
        response: { status: 200, body: 'changed', retryDelayMs: null },
      }),
    ).rejects.toThrow('FIREWORKS_INFERENCE_CONFLICT');
    await expect(
      prisma.inferenceAttempt.update({
        where: { id: raw.id, organizationId: input.organizationId },
        data: { responsePayload: {} },
      }),
    ).rejects.toThrow();
    await finishFireworksAttempt(prisma, {
      ...owner.ownership,
      attempt: completed(),
      errorCode: null,
    });
    await expect(
      finalizeFireworksInference(prisma, {
        ...owner.ownership,
        status: 'VALIDATED',
        resultPayload: result(input, []),
        errorCode: null,
      }),
    ).rejects.toThrow('FIREWORKS_INFERENCE_CONFLICT');
    expect(await budget(input.organizationId)).toMatchObject({ knownTokens: 37n });
  });

  it('releases only proven-unsent cancellation and refuses zero-attempt results after admission', async () => {
    const input = await fixture();
    const owner = await owned(input);
    const cancellation = {
      status: 'FAILED' as const,
      resultPayload: { status: 'FAILED', code: 'CANCELLED', attempts: [], elapsedMs: 0 },
      errorCode: 'CANCELLED' as const,
    };
    expect(
      await finalizeFireworksInference(prisma, { ...owner.ownership, ...cancellation }),
    ).toMatchObject({ state: 'REJECTED', reservedTokens: 0n, totalTokens: 0n });
    expect(await budget(input.organizationId)).toMatchObject({ reservedTokens: 0n });
    const secondInput = await fixture(input.organizationId);
    const second = await submit(secondInput);
    await expect(
      finalizeFireworksInference(prisma, { ...second.ownership, ...cancellation }),
    ).rejects.toThrow('FIREWORKS_INFERENCE_CONFLICT');
    expect(await budget(input.organizationId)).toMatchObject({ reservedTokens: 100n });
  });

  it('enforces exact frozen binding and tenant scope even when a final result already exists', async () => {
    const input = await fixture();
    const owner = await submit(input);
    await response(owner);
    await finishFireworksAttempt(prisma, {
      ...owner.ownership,
      attempt: completed(),
      errorCode: null,
    });
    await finalizeFireworksInference(prisma, {
      ...owner.ownership,
      status: 'VALIDATED',
      resultPayload: result(input, [completed()]),
      errorCode: null,
    });
    await expect(
      reserveFireworksInferenceRun(prisma, { ...input, requestHash: 'f'.repeat(64) }),
    ).rejects.toThrow('FIREWORKS_INFERENCE_CONFLICT');
    const other = await fixture();
    await expect(
      recordFireworksResponse(prisma, {
        ...owner.ownership,
        organizationId: other.organizationId,
        attemptNumber: 1,
        response: { status: 200, body: '{}', retryDelayMs: null },
      }),
    ).rejects.toThrow('FIREWORKS_INFERENCE_CONFLICT');
    expect(
      await reserveFireworksInferenceRun(prisma, {
        ...input,
        organizationId: other.organizationId,
      }),
    ).toMatchObject({ kind: 'NOT_FOUND' });
  });

  it('keeps legacy single-attempt helpers from sending or settling native runs', async () => {
    const input = await fixture();
    const owner = await owned(input);
    expect(await beginInferenceAttempt(prisma, owner.ownership)).toBe(false);
    await expect(reserveInferenceRun(prisma, { ...input, provider: 'SYNTHETIC' })).rejects.toThrow(
      'INFERENCE_LEDGER_CONFLICT',
    );
    await expect(
      saveInferenceReceipt(prisma, {
        ...owner.ownership,
        outcome: 'VALIDATED',
        resultPayload: {},
        tokensUsed: 1,
        errorCode: null,
      }),
    ).rejects.toThrow('INFERENCE_LEDGER_CONFLICT');
    expect(
      await prisma.inferenceAttempt.count({ where: { organizationId: input.organizationId } }),
    ).toBe(0);
  });
});

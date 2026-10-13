import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { prisma } from '../client.js';

import { MissingOrgScopeError } from './errors.js';
import {
  reserveInferenceRun,
  beginInferenceAttempt,
  saveInferenceReceipt,
  markInferenceApplied,
  markInferenceReviewed,
  type ReserveInferenceInput,
} from './inference.js';
import { getOrgScopedDb } from './with-org.js';

const NOW = new Date('2026-10-13T23:59:00Z');
const LATER = new Date('2026-10-14T00:01:00Z');

async function fixture(organizationId?: string): Promise<ReserveInferenceInput> {
  const orgId =
    organizationId ??
    (
      await prisma.organization.create({
        data: {
          name: 'Synthetic test',
          clerkOrgId: randomUUID(),
        },
      })
    ).id;
  const claim = await prisma.claim.create({
    data: {
      organizationId: orgId,
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
      organizationId: orgId,
      claimId: claim.id,
      retellCallId: randomUUID(),
      status: 'COMPLETED',
    },
  });
  return {
    organizationId: orgId,
    callId: call.id,
    claimId: claim.id,
    claimVersion: claim.updatedAt,
    sourceHash: 'a'.repeat(64),
    requestHash: 'b'.repeat(64),
    provider: 'SYNTHETIC',
    releaseId: 'synthetic-summary.v1',
    promptVersion: 'v1',
    requestPayload: { synthetic: true },
    reservationTokens: 100,
    dailyTokenLimit: 500,
    now: NOW,
  };
}

async function owned(input: ReserveInferenceInput) {
  const result = await reserveInferenceRun(prisma, input);
  if (result.kind !== 'OWNED' && result.kind !== 'RESUME') throw new Error('TEST_EXPECTED_OWNER');
  return result;
}

async function submitted(input: ReserveInferenceInput) {
  const result = await owned(input);
  const ownership = {
    organizationId: input.organizationId,
    runId: result.run.id,
    leaseToken: result.leaseToken,
    now: input.now ?? NOW,
  };
  expect(await beginInferenceAttempt(prisma, ownership)).toBe(true);
  return { ...result, ownership };
}

async function budget(organizationId: string, billingDay = '2026-10-13') {
  return prisma.inferenceBudget.findFirstOrThrow({ where: { organizationId, billingDay } });
}

describe('durable inference admission and receipt accounting', () => {
  it('keeps review effects retryable when their transaction rolls back', async () => {
    const input = await fixture();
    const original = await submitted(input);
    await saveInferenceReceipt(prisma, {
      ...original.ownership,
      outcome: 'REJECTED',
      resultPayload: null,
      tokensUsed: 12,
      errorCode: 'OUTPUT_SCHEMA_INVALID',
    });
    const review = { organizationId: input.organizationId, runId: original.run.id, now: NOW };
    await expect(
      prisma.$transaction(async (tx) => {
        expect(await markInferenceReviewed(tx, review)).toBe(true);
        throw new Error('TEST_REVIEW_ROLLBACK');
      }),
    ).rejects.toThrow('TEST_REVIEW_ROLLBACK');
    expect(
      await prisma.inferenceRun.findFirst({
        where: { id: original.run.id, organizationId: input.organizationId },
      }),
    ).toMatchObject({ reviewAppliedAt: null, totalTokens: 12n, state: 'REJECTED' });
    expect(await prisma.$transaction((tx) => markInferenceReviewed(tx, review))).toBe(true);
    expect(await prisma.$transaction((tx) => markInferenceReviewed(tx, review))).toBe(false);
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: input.organizationId,
          resourceId: original.run.id,
          action: 'inference.review_applied',
        },
      }),
    ).toBe(1);
    expect((await budget(input.organizationId)).knownTokens).toBe(12n);
  });

  it('never discards large reported usage to fit the operational admission limit', async () => {
    const input = await fixture();
    const original = await submitted(input);
    const tokensUsed = 3_000_000_001;
    await saveInferenceReceipt(prisma, {
      ...original.ownership,
      outcome: 'REJECTED',
      resultPayload: null,
      tokensUsed,
      errorCode: 'TOKEN_BOUND_EXCEEDED',
    });
    expect((await budget(input.organizationId)).knownTokens).toBe(BigInt(tokensUsed));
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId } }))
        .summaryTokensUsed,
    ).toBe(2_147_483_647);
  });

  it('admits one owner and one attempt despite concurrent transport deliveries', async () => {
    const input = await fixture();
    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () => reserveInferenceRun(prisma, input)),
    );
    expect(outcomes.filter((r) => r.kind === 'OWNED')).toHaveLength(1);
    expect(outcomes.filter((r) => r.kind === 'BUSY')).toHaveLength(3);
    const owner = outcomes.find((r) => r.kind === 'OWNED');
    if (owner?.kind !== 'OWNED') throw new Error('TEST_EXPECTED_OWNER');
    const attempt = {
      organizationId: input.organizationId,
      runId: owner.run.id,
      leaseToken: owner.leaseToken,
      now: NOW,
    };
    expect(
      (
        await Promise.all([
          beginInferenceAttempt(prisma, attempt),
          beginInferenceAttempt(prisma, attempt),
        ])
      ).sort(),
    ).toEqual([false, true]);
    expect(
      await prisma.inferenceAttempt.count({ where: { organizationId: input.organizationId } }),
    ).toBe(1);
    expect(await budget(input.organizationId)).toMatchObject({
      reservedTokens: 100n,
      knownTokens: 0n,
    });
  });

  it('serializes organization admission across different calls', async () => {
    const first = await fixture();
    const second = await fixture(first.organizationId);
    const outcomes = await Promise.all(
      [first, second].map((input) =>
        reserveInferenceRun(prisma, { ...input, reservationTokens: 300 }),
      ),
    );
    expect(outcomes.map((r) => r.kind).sort()).toEqual(['BUDGET_EXCEEDED', 'OWNED']);
    expect((await budget(first.organizationId)).reservedTokens).toBe(300n);
  });

  it('reclaims only a proven unsent reservation and fences its old owner', async () => {
    const input = await fixture();
    const old = await owned(input);
    const fresh = await owned({ ...input, now: LATER });
    expect(fresh.run.id).toBe(old.run.id);
    expect(fresh.leaseToken).not.toBe(old.leaseToken);
    expect(
      await beginInferenceAttempt(prisma, {
        organizationId: input.organizationId,
        runId: old.run.id,
        leaseToken: old.leaseToken,
        now: LATER,
      }),
    ).toBe(false);
    expect(
      await beginInferenceAttempt(prisma, {
        organizationId: input.organizationId,
        runId: fresh.run.id,
        leaseToken: fresh.leaseToken,
        now: LATER,
      }),
    ).toBe(true);
    expect((await budget(input.organizationId)).reservedTokens).toBe(100n);
  });

  it('retains ambiguous liability across midnight and never re-admits a submitted request', async () => {
    const input = await fixture();
    const original = await submitted({ ...input, reservationTokens: 400 });
    const expired = await reserveInferenceRun(prisma, { ...input, now: LATER });
    expect(expired).toMatchObject({
      kind: 'REVIEW_REQUIRED',
      run: { state: 'UNKNOWN', reservedTokens: 400n },
    });
    expect(await beginInferenceAttempt(prisma, { ...original.ownership, now: LATER })).toBe(false);
    const nextCall = await fixture(input.organizationId);
    expect(
      await reserveInferenceRun(prisma, { ...nextCall, reservationTokens: 101, now: LATER }),
    ).toMatchObject({ kind: 'BUDGET_EXCEEDED' });
    expect((await budget(input.organizationId)).reservedTokens).toBe(400n);
  });

  it('allows a late positive receipt only from the original owner after ambiguous expiry', async () => {
    const input = await fixture();
    const original = await submitted(input);
    await reserveInferenceRun(prisma, { ...input, now: LATER });
    const receipt = {
      ...original.ownership,
      outcome: 'VALIDATED' as const,
      resultPayload: { value: 'synthetic' },
      tokensUsed: 75,
      errorCode: null,
      now: LATER,
    };
    await expect(
      saveInferenceReceipt(prisma, { ...receipt, leaseToken: 'wrong-owner' }),
    ).rejects.toThrow('INFERENCE_LEDGER_CONFLICT');
    expect(await saveInferenceReceipt(prisma, receipt)).toMatchObject({
      state: 'RESPONDED',
      totalTokens: 75n,
      reservedTokens: 0n,
    });
    expect(await budget(input.organizationId)).toMatchObject({
      reservedTokens: 0n,
      knownTokens: 75n,
    });
    // Previous-day settlement never overwrites today's display bucket.
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId } }))
        .summaryTokensUsed,
    ).toBe(0);
  });

  it('settles schema-rejected responses once and forbids another generation', async () => {
    const input = await fixture();
    const original = await submitted(input);
    const receipt = {
      ...original.ownership,
      outcome: 'REJECTED' as const,
      resultPayload: null,
      tokensUsed: 55,
      errorCode: 'OUTPUT_SCHEMA_INVALID' as const,
    };
    await saveInferenceReceipt(prisma, receipt);
    await saveInferenceReceipt(prisma, receipt);
    expect(await reserveInferenceRun(prisma, input)).toMatchObject({
      kind: 'REVIEW_REQUIRED',
      run: { state: 'REJECTED' },
    });
    expect(await budget(input.organizationId)).toMatchObject({
      knownTokens: 55n,
      reservedTokens: 0n,
    });
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId } }))
        .summaryTokensUsed,
    ).toBe(55);
    await expect(
      prisma.inferenceRun.update({
        where: { id: original.run.id, organizationId: input.organizationId },
        data: { generation: 2 },
      }),
    ).rejects.toThrow();
  });

  it('preserves a valid response with unknown usage without releasing its allocation', async () => {
    const input = await fixture();
    const original = await submitted(input);
    await saveInferenceReceipt(prisma, {
      ...original.ownership,
      outcome: 'VALIDATED',
      resultPayload: { value: 'synthetic' },
      tokensUsed: null,
      errorCode: null,
    });
    expect(await owned(input)).toMatchObject({
      kind: 'RESUME',
      run: { totalTokens: null, reservedTokens: 100n },
    });
    expect(await budget(input.organizationId)).toMatchObject({
      knownTokens: 0n,
      reservedTokens: 100n,
    });
  });

  it('records allocation overruns in full and blocks further admission', async () => {
    const input = await fixture();
    const original = await submitted(input);
    await saveInferenceReceipt(prisma, {
      ...original.ownership,
      outcome: 'VALIDATED',
      resultPayload: { value: 'synthetic' },
      tokensUsed: 600,
      errorCode: null,
    });
    expect(await budget(input.organizationId)).toMatchObject({
      knownTokens: 600n,
      reservedTokens: 0n,
    });
    expect(
      await prisma.inferenceRun.findFirst({
        where: { id: original.run.id, organizationId: input.organizationId },
      }),
    ).toMatchObject({ lastErrorCode: 'TOKEN_BOUND_EXCEEDED', totalTokens: 600n });
    expect(await reserveInferenceRun(prisma, await fixture(input.organizationId))).toMatchObject({
      kind: 'BUDGET_EXCEEDED',
    });
  });

  it('imports legacy daily usage once and never raises a tightened budget through a stale worker', async () => {
    const input = await fixture();
    await prisma.organization.update({
      where: { id: input.organizationId },
      data: { summaryTokensUsed: 200, summaryTokensResetAt: NOW },
    });
    await owned(input);
    const second = await fixture(input.organizationId);
    expect(await reserveInferenceRun(prisma, { ...second, dailyTokenLimit: 350 })).toMatchObject({
      kind: 'BUDGET_EXCEEDED',
    });
    expect(await reserveInferenceRun(prisma, { ...second, dailyTokenLimit: 1000 })).toMatchObject({
      kind: 'BUDGET_EXCEEDED',
    });
    expect(await budget(input.organizationId)).toMatchObject({
      baselineTokens: 200n,
      knownTokens: 200n,
      reservedTokens: 100n,
      tokenLimit: 350n,
    });
  });

  it('fences a changed unsent binding and releases only that unsubmitted allocation', async () => {
    const input = await fixture();
    const original = await owned(input);
    expect(
      await reserveInferenceRun(prisma, { ...input, requestPayload: { synthetic: false } }),
    ).toMatchObject({
      kind: 'REVIEW_REQUIRED',
      run: { state: 'REJECTED', lastErrorCode: 'REQUEST_BINDING_CHANGED' },
    });
    expect(
      await beginInferenceAttempt(prisma, {
        organizationId: input.organizationId,
        runId: original.run.id,
        leaseToken: original.leaseToken,
        now: NOW,
      }),
    ).toBe(false);
    expect((await budget(input.organizationId)).reservedTokens).toBe(0n);
  });

  it('keeps receipts after application rollback, resumes frozen evidence, and marks application atomically', async () => {
    const input = await fixture();
    const original = await submitted(input);
    const receipt = {
      ...original.ownership,
      outcome: 'VALIDATED' as const,
      resultPayload: { value: 'synthetic' },
      tokensUsed: 70,
      errorCode: null,
    };
    await saveInferenceReceipt(prisma, receipt);
    const resume = await owned({
      ...input,
      requestPayload: { changed: true },
      requestHash: 'c'.repeat(64),
    });
    expect(resume.run.requestPayload).toEqual(input.requestPayload);
    const apply = async (rollback: boolean): Promise<void> => {
      await prisma.$transaction(async (tx) => {
        const summary = await tx.callSummary.create({
          data: {
            organizationId: input.organizationId,
            callId: input.callId,
            claimStatus: 'pending',
            nextAction: 'MANUAL_REVIEW',
            rawTranscript: 'synthetic',
            claudeSummary: 'synthetic',
          },
        });
        await markInferenceApplied(tx, {
          organizationId: input.organizationId,
          runId: original.run.id,
          leaseToken: resume.leaseToken,
          summaryId: summary.id,
          now: NOW,
        });
        if (rollback) throw new Error('TEST_APPLICATION_ROLLBACK');
      });
    };
    await expect(apply(true)).rejects.toThrow('TEST_APPLICATION_ROLLBACK');
    expect(
      await prisma.callSummary.count({ where: { organizationId: input.organizationId } }),
    ).toBe(0);
    expect(await budget(input.organizationId)).toMatchObject({
      knownTokens: 70n,
      reservedTokens: 0n,
    });
    await apply(false);
    expect(await reserveInferenceRun(prisma, input)).toMatchObject({ kind: 'ALREADY_APPLIED' });
    await saveInferenceReceipt(prisma, receipt);
    expect((await budget(input.organizationId)).knownTokens).toBe(70n);
    expect(
      await prisma.inferenceAttempt.count({ where: { organizationId: input.organizationId } }),
    ).toBe(1);
  });

  it('rejects stale or foreign application ownership and nonmatching summary IDs', async () => {
    const input = await fixture();
    const original = await submitted(input);
    await saveInferenceReceipt(prisma, {
      ...original.ownership,
      outcome: 'VALIDATED',
      resultPayload: {},
      tokensUsed: 1,
      errorCode: null,
    });
    const resume = await owned(input);
    await expect(
      prisma.$transaction((tx) =>
        markInferenceApplied(tx, {
          organizationId: input.organizationId,
          runId: original.run.id,
          leaseToken: resume.leaseToken,
          summaryId: 'missing',
          now: NOW,
        }),
      ),
    ).rejects.toThrow('INFERENCE_LEDGER_CONFLICT');
    await expect(
      prisma.$transaction((tx) =>
        markInferenceApplied(tx, {
          organizationId: input.organizationId,
          runId: original.run.id,
          leaseToken: 'wrong-owner',
          summaryId: 'missing',
          now: NOW,
        }),
      ),
    ).rejects.toThrow('INFERENCE_LEDGER_CONFLICT');
  });

  it('scopes all new read/write models and receipt foreign keys to the owning organization', async () => {
    const input = await fixture();
    const other = await fixture();
    const original = await submitted(input);
    await submitted(other);
    const scoped = getOrgScopedDb(other.organizationId);
    expect(await scoped.inferenceRun.findFirst({ where: { id: original.run.id } })).toBeNull();
    expect(await scoped.inferenceRun.count()).toBe(1);
    expect(await scoped.inferenceBudget.count()).toBe(1);
    expect(await scoped.inferenceAttempt.count()).toBe(1);
    await expect(
      saveInferenceReceipt(prisma, {
        ...original.ownership,
        organizationId: other.organizationId,
        outcome: 'UNKNOWN',
        resultPayload: null,
        tokensUsed: null,
        errorCode: 'PROVIDER_ERROR',
      }),
    ).rejects.toThrow('INFERENCE_LEDGER_CONFLICT');
    await expect(
      prisma.inferenceRun.updateMany({
        where: { id: original.run.id },
        data: { state: 'UNKNOWN' },
      }),
    ).rejects.toThrow(MissingOrgScopeError);
    await expect(
      prisma.inferenceBudget.updateMany({
        where: { billingDay: '2026-10-13' },
        data: { tokenLimit: 1 },
      }),
    ).rejects.toThrow(MissingOrgScopeError);
    await expect(
      prisma.inferenceAttempt.updateMany({
        where: { runId: original.run.id },
        data: { state: 'UNKNOWN' },
      }),
    ).rejects.toThrow(MissingOrgScopeError);
    await expect(
      prisma.inferenceAttempt.create({
        data: {
          organizationId: other.organizationId,
          runId: original.run.id,
          tokenAllowance: 10,
          reservedTokens: 10,
        },
      }),
    ).rejects.toThrow();
    expect(
      await reserveInferenceRun(prisma, { ...input, organizationId: other.organizationId }),
    ).toMatchObject({ kind: 'NOT_FOUND' });
  });

  it('prevents mutation of the evidence snapshot at the database boundary', async () => {
    const input = await fixture();
    const original = await owned(input);
    await expect(
      prisma.inferenceRun.update({
        where: { organizationId: input.organizationId, id: original.run.id },
        data: { requestPayload: { altered: true } },
      }),
    ).rejects.toThrow();
    expect(
      (
        await prisma.inferenceRun.findFirstOrThrow({
          where: { organizationId: input.organizationId, id: original.run.id },
        })
      ).requestPayload,
    ).toEqual(input.requestPayload);
  });

  it('rejects invalid caps and unbounded payloads before creating liability', async () => {
    const input = await fixture();
    await expect(reserveInferenceRun(prisma, { ...input, reservationTokens: -1 })).rejects.toThrow(
      'INFERENCE_LEDGER_CONFLICT',
    );
    await expect(
      reserveInferenceRun(prisma, { ...input, requestPayload: { text: 'x'.repeat(1_048_577) } }),
    ).rejects.toThrow('INFERENCE_LEDGER_CONFLICT');
    expect(
      await prisma.inferenceRun.count({ where: { organizationId: input.organizationId } }),
    ).toBe(0);
  });
});

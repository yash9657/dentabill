import { createHash } from 'node:crypto';

import {
  audit,
  type Prisma,
  type Call,
  getOrgScopedDb,
  type PayerCode,
  type prisma as defaultPrisma,
} from '@dentabill/db';
import type { Logger } from '@dentabill/logger';
import {
  type AgentPrompt,
  type CallIdentity,
  getAgentPrompt,
  getIvrMap,
  type MissingCallIdentityField,
  type PayerIvrMap,
  type RetellPort,
  createRetellReconciliationClient,
  DemoAutopilot,
  FakeRetell,
  type RetellReconciliationClient,
  type StartCallInput,
  validateCallIdentity,
} from '@dentabill/payer-ivr';
import {
  CallJobDataSchema,
  type CallJobResult,
  type CallsProcessor,
  type JobDispatcher,
} from '@dentabill/queue';
import { UnrecoverableError } from 'bullmq';

import { observeAcceptedCall } from './call-observer.js';
import type { WorkerEnv } from './env.js';
import { relayJobOutbox } from './job-outbox.js';

/**
 * Concrete type of the singleton `prisma` exported by `@dentabill/db`.
 * This is the org-scope-write-extended client, NOT the raw
 * `@prisma/client` `PrismaClient` — the two diverge on `$on`/`$extends`
 * and tests will fail to typecheck if we use the raw type here.
 */
export type DbClient = typeof defaultPrisma;

export class MissingCallIdentityError extends UnrecoverableError {
  public readonly code = 'MISSING_CALL_IDENTITY';
  public readonly missingFields: readonly MissingCallIdentityField[];

  public constructor(missingFields: readonly MissingCallIdentityField[]) {
    super(`Outbound call blocked: required identity is missing (${missingFields.join(', ')}).`);
    this.name = 'MissingCallIdentityError';
    this.missingFields = missingFields;
  }
}

/** Drives only a persisted call intent; queue delivery is not submission ownership. */
export interface CallJobHandlerDeps {
  readonly logger: Logger;
  readonly prisma: DbClient;
  readonly retellPort: RetellPort;
  readonly env: WorkerEnv;
  /** Override the clock (testing seam). */
  readonly clock?: () => Date;
  readonly reconciliationProvider?: RetellReconciliationClient | null;
  readonly observationWindowMs?: number;
  /** Outbound caller number in E.164 (the worker's own dial-out line). */
  readonly outboundNumberE164: string;
  /** Optional immediate delivery; the summary obligation is always saved transactionally. */
  readonly jobDispatcher?: Pick<JobDispatcher, 'dispatchCall' | 'dispatchSummary'>;
}

export function createCallJobHandler(deps: CallJobHandlerDeps): CallsProcessor {
  const clock = deps.clock ?? ((): Date => new Date());
  return async (job) => {
    const validation = await CallJobDataSchema.safeParseAsync(job.data);
    if (!validation.success) throw validation.error;
    const data = validation.data;

    const foundIntent = await deps.prisma.callIntent.findFirst({
      where: {
        organizationId: data.organizationId,
        ...(data.resume ? { id: data.resume.intentId } : { idempotencyKey: data.idempotencyKey }),
      },
    });
    if (
      foundIntent?.claimId !== data.claimId ||
      foundIntent.payerCode !== data.payerCode ||
      foundIntent.attemptNumber !== data.attemptNumber ||
      foundIntent.claimPriority !== data.claimPriority
    )
      return noCallResult('BLOCKED');
    if (
      data.resume &&
      (data.idempotencyKey !== `call.resume.${foundIntent.id}` ||
        data.resume.callId !== foundIntent.callId ||
        !['ACCEPTED', 'TERMINAL'].includes(foundIntent.state))
    ) {
      return noCallResult('BLOCKED');
    }
    let intent = foundIntent;
    let startedThisInvocation = false;
    if (intent.state === 'SUBMITTING' || intent.state === 'UNKNOWN') {
      return noCallResult('RECONCILIATION_REQUIRED');
    }
    if (intent.state === 'CANCELLED' || intent.state === 'TERMINAL') {
      return noCallResult('ALREADY_PROCESSED');
    }
    let call: Call | null =
      intent.callId === null
        ? null
        : await deps.prisma.call.findFirst({
            where: {
              id: intent.callId,
              organizationId: data.organizationId,
              claimId: data.claimId,
            },
          });
    if (intent.state === 'ACCEPTED' && call === null) {
      throw new Error('Accepted call intent has no matching call.');
    }
    const orgScoped = getOrgScopedDb(data.organizationId);

    // ── 2. Load claim + org ────────────────────────────────────────────
    // `getOrgScopedDb` does not intercept `findUnique` (see with-org.ts);
    // use `findFirst` so the `organizationId = orgId` predicate is added
    // automatically and a poisoned job pointing at a foreign claim id
    // returns null rather than the foreign row.
    const claim = await orgScoped.claim.findFirst({ where: { id: data.claimId } });
    if (claim === null) {
      throw new Error(
        `call-worker: claim ${data.claimId} not found in organization ${data.organizationId}`,
      );
    }
    if (intent.state === 'READY') {
      const org = await deps.prisma.organization.findUnique({
        where: { id: data.organizationId },
      });
      if (org === null) {
        throw new Error(`call-worker: organization ${data.organizationId} not found`);
      }

      // ── 3. Resolve IVR + agent ─────────────────────────────────────────
      const ivrMap = getIvrMap(claim.payerCode);
      const agentPrompt = getAgentPrompt(claim.payerCode);
      if (ivrMap === undefined || agentPrompt === undefined) {
        throw new Error(
          `call-worker: Phase 3 has no IVR map / agent for payer ${claim.payerCode} — API enqueue should have rejected this job`,
        );
      }

      const payerConfig = await deps.prisma.payerConfig.findUnique({
        where: {
          organizationId_payerCode: {
            organizationId: data.organizationId,
            payerCode: claim.payerCode,
          },
        },
      });
      const providerNpi = payerConfig?.providerNpi ?? org.npi;
      const identity = validateCallIdentity({ subscriberId: claim.subscriberId, providerNpi });
      if (!identity.ok) {
        await deps.prisma.$transaction(async (tx) => {
          const owned = await tx.callIntent.updateMany({
            where: { id: intent.id, organizationId: data.organizationId, state: 'READY' },
            data: { state: 'CANCELLED', completedAt: clock(), lastErrorCode: identity.code },
          });
          if (owned.count === 0) return;
          const blocked = await tx.claim.updateMany({
            where: {
              id: claim.id,
              organizationId: data.organizationId,
              status: 'IN_QUEUE',
              updatedAt: intent.claimVersion,
            },
            data: { status: 'NEEDS_INFO' },
          });
          if (blocked.count > 0) {
            await audit(
              {
                action: 'call.blocked',
                resourceType: 'Claim',
                resourceId: claim.id,
                organizationId: data.organizationId,
                metadata: {
                  jobId: job.id ?? null,
                  reason: identity.code,
                  missingFields: identity.missingFields,
                },
              },
              tx,
            );
          }
        });
        throw new MissingCallIdentityError(identity.missingFields);
      }

      const startInput = buildStartCallInput({
        data: { idempotencyKey: intent.id },
        claim,
        org,
        ivrMap,
        agentPrompt,
        identity: identity.identity,
        outboundNumberE164: deps.outboundNumberE164,
        env: deps.env,
      });
      const requestJson = JSON.stringify(startInput);
      const submittedAt = clock();
      const reserved = await deps.prisma.$transaction(async (tx) => {
        const owned = await tx.callIntent.updateMany({
          where: { id: intent.id, organizationId: data.organizationId, state: 'READY' },
          data: {
            state: 'SUBMITTING',
            submittedAt,
            callDeadlineAt: new Date(submittedAt.getTime() + deps.env.MAX_CALL_DURATION_MS),
            requestPayload: JSON.parse(requestJson) as Prisma.InputJsonValue,
            requestHash: createHash('sha256').update(requestJson).digest('hex'),
          },
        });
        if (owned.count === 0) return null;
        const transitioned = await tx.claim.updateMany({
          where: {
            id: claim.id,
            organizationId: data.organizationId,
            status: 'IN_QUEUE',
            updatedAt: intent.claimVersion,
          },
          data: { status: 'CALLING', lastCallAt: clock() },
        });
        if (transitioned.count === 0) {
          await tx.callIntent.updateMany({
            where: { id: intent.id, organizationId: data.organizationId, state: 'SUBMITTING' },
            data: { state: 'CANCELLED', completedAt: clock(), lastErrorCode: 'STALE_CLAIM' },
          });
          await audit(
            {
              action: 'call.intent.cancelled',
              resourceType: 'CallIntent',
              resourceId: intent.id,
              organizationId: data.organizationId,
              metadata: { reason: 'STALE_CLAIM' },
            },
            tx,
          );
          return null;
        }
        const current = await tx.claim.findFirstOrThrow({
          where: { id: claim.id, organizationId: data.organizationId },
        });
        await tx.callIntent.updateMany({
          where: { id: intent.id, organizationId: data.organizationId },
          data: { claimVersion: current.updatedAt },
        });
        await audit(
          {
            action: 'call.intent.submitting',
            resourceType: 'CallIntent',
            resourceId: intent.id,
            organizationId: data.organizationId,
            metadata: { claimId: claim.id },
          },
          tx,
        );
        return { ...intent, claimVersion: current.updatedAt };
      });
      if (reserved === null) return noCallResult('BLOCKED');
      intent = reserved;

      let startResult;
      try {
        startResult = await deps.retellPort.startCall(startInput);
      } catch {
        // Any rejection can follow acceptance. Never infer permission to redial.
        await deps.prisma.$transaction(async (tx) => {
          const changed = await tx.callIntent.updateMany({
            where: { id: intent.id, organizationId: data.organizationId, state: 'SUBMITTING' },
            data: { state: 'UNKNOWN', lastErrorCode: 'PROVIDER_ACCEPTANCE_UNKNOWN' },
          });
          if (changed.count === 0) return;
          const review = await tx.claim.updateMany({
            where: {
              id: claim.id,
              organizationId: data.organizationId,
              status: 'CALLING',
              updatedAt: intent.claimVersion,
            },
            data: { status: 'MANUAL_REVIEW' },
          });
          await audit(
            {
              action: 'call.intent.unknown',
              resourceType: 'CallIntent',
              resourceId: intent.id,
              organizationId: data.organizationId,
              metadata: {
                reason: 'PROVIDER_ACCEPTANCE_UNKNOWN',
                claimTransitionApplied: review.count === 1,
              },
            },
            tx,
          );
        });
        return noCallResult('RECONCILIATION_REQUIRED');
      }

      call = await deps.prisma.$transaction(async (tx) => {
        const owned = await tx.callIntent.updateMany({
          where: { id: intent.id, organizationId: data.organizationId, state: 'SUBMITTING' },
          data: { state: 'ACCEPTED', nextObservationAt: new Date(clock().getTime() + 30_000) },
        });
        if (owned.count !== 1) {
          const recovered = await tx.callIntent.findFirst({
            where: {
              id: intent.id,
              organizationId: data.organizationId,
              state: { in: ['ACCEPTED', 'TERMINAL'] },
              call: { retellCallId: startResult.retellCallId },
            },
            include: { call: true },
          });
          if (recovered?.call) return recovered.call;
          throw new Error('Call submission ownership changed.');
        }
        const created = await tx.call.create({
          data: {
            organizationId: data.organizationId,
            claimId: claim.id,
            retellCallId: startResult.retellCallId,
            retellAgentId: startInput.agentId,
            status: 'INITIATED',
            attemptNumber: data.attemptNumber,
            startedAt: new Date(startResult.queuedAt),
          },
        });
        await tx.callIntent.updateMany({
          where: { id: intent.id, organizationId: data.organizationId },
          data: { callId: created.id },
        });
        await audit(
          {
            action: 'call.start',
            resourceType: 'Call',
            resourceId: created.id,
            organizationId: data.organizationId,
            metadata: {
              intentId: intent.id,
              claimId: claim.id,
              jobId: job.id ?? null,
              attemptNumber: data.attemptNumber,
              payerCode: claim.payerCode,
            },
          },
          tx,
        );
        return created;
      });
      startedThisInvocation = true;
    }
    if (call === null) throw new Error('Call intent has no accepted call.');

    const observed = await observeAcceptedCall({
      prisma: deps.prisma,
      organizationId: data.organizationId,
      intentId: intent.id,
      retellPort: deps.retellPort,
      provider:
        deps.reconciliationProvider !== undefined
          ? deps.reconciliationProvider
          : deps.env.RETELL_API_KEY
            ? createRetellReconciliationClient({ apiKey: deps.env.RETELL_API_KEY })
            : null,
      clock,
      waitMs:
        deps.observationWindowMs ??
        (deps.env.DEMO_AUTOPILOT === 'true' && !deps.env.RETELL_API_KEY ? 90_000 : 1_000),
      allowSyntheticStop:
        startedThisInvocation &&
        (deps.retellPort instanceof FakeRetell || deps.retellPort instanceof DemoAutopilot),
    });

    if (deps.jobDispatcher) {
      try {
        await relayJobOutbox({
          prisma: deps.prisma,
          jobDispatcher: deps.jobDispatcher,
          organizationId: data.organizationId,
          idempotencyKey: `call.${call.id}`,
          limit: 1,
          budgetMs: 5_000,
        });
      } catch {
        deps.logger.error('Summary delivery remains pending in the durable outbox.');
      }
    }

    return observed;
  };
}

function noCallResult(
  outcome: 'BLOCKED' | 'RECONCILIATION_REQUIRED' | 'ALREADY_PROCESSED',
): CallJobResult {
  return { callId: null, retellCallId: null, outcome, durationSeconds: null };
}

interface BuildStartCallInputArgs {
  readonly data: { readonly idempotencyKey: string };
  readonly claim: {
    readonly serviceDate: Date;
    readonly payerCode: PayerCode;
  };
  readonly org: { readonly name: string };
  readonly ivrMap: PayerIvrMap;
  readonly agentPrompt: AgentPrompt;
  readonly identity: CallIdentity;
  readonly outboundNumberE164: string;
  readonly env: WorkerEnv;
}

function buildStartCallInput(args: BuildStartCallInputArgs): StartCallInput {
  const overrideAgentId = perPayerAgentIdFromEnv(args.claim.payerCode, args.env);
  return {
    payerCode: args.claim.payerCode,
    agentId: overrideAgentId.length > 0 ? overrideAgentId : args.agentPrompt.agentId,
    fromNumberE164: args.outboundNumberE164,
    toNumberE164: providerLineToE164(args.ivrMap.providerLine),
    agentMetadata: {
      practiceName: args.org.name,
      providerNpi: args.identity.providerNpi,
      subscriberId: args.identity.subscriberId,
      dateOfService: args.claim.serviceDate.toISOString().slice(0, 10),
    },
    idempotencyKey: args.data.idempotencyKey,
    maxDurationMs: args.env.MAX_CALL_DURATION_MS,
  };
}

function perPayerAgentIdFromEnv(payer: PayerCode, env: WorkerEnv): string {
  switch (payer) {
    case 'DELTA_DENTAL_PPO':
      return env.RETELL_AGENT_ID_DELTA_DENTAL_PPO;
    case 'CIGNA_DENTAL':
      return env.RETELL_AGENT_ID_CIGNA_DENTAL;
    case 'METLIFE_DENTAL':
      return env.RETELL_AGENT_ID_METLIFE_DENTAL;
    default:
      return '';
  }
}

/**
 * Convert a payer's display-format provider line ("1-800-765-6003")
 * to E.164 ("+18007656003"). Strips every non-digit and prepends `+1`
 * if the result is 10 digits. Currently US-only — Phase 3 payers all
 * dial US numbers; international support is a Phase 4+ concern.
 */
export function providerLineToE164(displayLine: string): string {
  const digits = displayLine.replace(/\D+/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.startsWith('+')) return digits;
  throw new Error(`Cannot canonicalise provider line "${displayLine}" to E.164`);
}

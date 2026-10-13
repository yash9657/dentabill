import { createHash } from 'node:crypto';

import {
  audit,
  type Prisma,
  type Call,
  type ClaimStatus,
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
  type RetellCallEndedEvent,
  type RetellPort,
  RetellCallEndReason,
  RetellEventSchema,
  reconcileRetellWebhookInbox,
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

import type { WorkerEnv } from './env.js';
import { enqueueJobOutbox, relayJobOutbox } from './job-outbox.js';

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
      where: { organizationId: data.organizationId, idempotencyKey: data.idempotencyKey },
    });
    if (
      foundIntent?.claimId !== data.claimId ||
      foundIntent.payerCode !== data.payerCode ||
      foundIntent.attemptNumber !== data.attemptNumber ||
      foundIntent.claimPriority !== data.claimPriority
    )
      return noCallResult('BLOCKED');
    let intent = foundIntent;
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
      const reserved = await deps.prisma.$transaction(async (tx) => {
        const owned = await tx.callIntent.updateMany({
          where: { id: intent.id, organizationId: data.organizationId, state: 'READY' },
          data: {
            state: 'SUBMITTING',
            submittedAt: clock(),
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
          data: { state: 'ACCEPTED' },
        });
        if (owned.count !== 1) throw new Error('Call submission ownership changed.');
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
    }
    if (call === null) throw new Error('Call intent has no accepted call.');

    // ── 5. Subscribe + persist events; resolve when call.ended ───────
    const ended = await waitForCallEnd({
      retellPort: deps.retellPort,
      retellCallId: call.retellCallId,
      callId: call.id,
      organizationId: data.organizationId,
      prisma: deps.prisma,
      logger: deps.logger,
    });

    // ── 6. Update Call + Claim with final state ───────────────────────
    const finalCallStatus = endReasonToCallStatus(ended.endReason);
    const finalClaimStatus = endReasonToClaimStatus(ended);
    const finalized = await deps.prisma.$transaction(async (tx) => {
      const owned = await tx.callIntent.updateMany({
        where: {
          id: intent.id,
          organizationId: data.organizationId,
          state: 'ACCEPTED',
          callId: call.id,
        },
        data: { state: 'TERMINAL', completedAt: clock() },
      });
      if (owned.count === 0) return false;
      await tx.call.updateMany({
        where: {
          id: call.id,
          organizationId: data.organizationId,
          status: { notIn: ['COMPLETED', 'FAILED', 'VOICEMAIL'] },
        },
        data: {
          status: finalCallStatus,
          endedAt: ended.endedAt === null ? null : new Date(ended.endedAt),
          durationSeconds: ended.durationSeconds,
        },
      });
      const claimTransition = await tx.claim.updateMany({
        where: {
          id: claim.id,
          organizationId: data.organizationId,
          status: 'CALLING',
          updatedAt: intent.claimVersion,
          calls: { none: { createdAt: { gt: call.createdAt } } },
        },
        data: { status: finalClaimStatus },
      });
      await audit(
        {
          action: 'call.end',
          resourceType: 'Call',
          resourceId: call.id,
          organizationId: data.organizationId,
          metadata: {
            claimId: claim.id,
            intentId: intent.id,
            providerCallStatus: finalCallStatus,
            proposedClaimStatus: finalClaimStatus,
            claimTransitionApplied: claimTransition.count === 1,
            durationSeconds: ended.durationSeconds,
            endReason: ended.endReason,
          },
        },
        tx,
      );
      await enqueueJobOutbox(tx, {
        organizationId: data.organizationId,
        kind: 'SUMMARY_GENERATE',
        data: {
          organizationId: data.organizationId,
          callId: call.id,
          promptVersion: 'v1',
          idempotencyKey: `call.${call.id}`,
        },
      });
      return true;
    });
    if (!finalized)
      return {
        callId: call.id,
        retellCallId: call.retellCallId,
        outcome: 'ALREADY_PROCESSED',
        durationSeconds: ended.durationSeconds,
      };

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

    return {
      callId: call.id,
      retellCallId: call.retellCallId,
      outcome: finalClaimStatus === 'MANUAL_REVIEW' ? 'ESCALATED' : 'COMPLETED',
      durationSeconds: ended.durationSeconds,
    };
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

interface WaitForCallEndArgs {
  readonly retellPort: RetellPort;
  readonly retellCallId: string;
  readonly callId: string;
  readonly organizationId: string;
  readonly prisma: DbClient;
  readonly logger: Logger;
  /**
   * Cancel-marker poll interval (ms). ADR-047. Production default 5s;
   * tests override to keep specs fast.
   */
  readonly cancelPollIntervalMs?: number;
}

const CANCEL_POLL_INTERVAL_MS_DEFAULT = 5_000;

function waitForCallEnd(args: WaitForCallEndArgs): Promise<RetellCallEndedEvent> {
  // Events arrive on the listener concurrently, but their DB side-effects
  // must serialize: a transcript-driven `status = NAVIGATING_IVR` write
  // queued before `call.ended` MUST land before we resolve, otherwise the
  // outer handler's final status update can be overwritten by a stale
  // transcript update racing in afterwards. We serialize via a chained
  // promise — each listener invocation appends to `chain` and awaits the
  // prior tail.
  return new Promise((resolve, reject) => {
    let chain: Promise<void> = Promise.resolve();
    let unsubscribe = (): void => {
      /* set below */
    };
    let cancelTimer: ReturnType<typeof setInterval> | null = null;
    let cancelInFlight = false;
    let pollInFlight = false;
    let settled = false;
    const isSettled = (): boolean => settled;

    const cleanup = (): void => {
      settled = true;
      unsubscribe();
      if (cancelTimer) {
        clearInterval(cancelTimer);
        cancelTimer = null;
      }
    };

    // ADR-047 — Postgres-driven true cancel channel. Pub/sub has a
    // publish-before-subscribe race that drops cancel signals received
    // before this listener opens. The marker column survives reboots
    // and is checked at entry + every cancelPollIntervalMs ms.
    const checkCancelMarker = async (): Promise<void> => {
      if (pollInFlight || isSettled()) return;
      pollInFlight = true;
      try {
        await reconcileRetellWebhookInbox(args.prisma, {
          organizationId: args.organizationId,
          callId: args.callId,
          retellCallId: args.retellCallId,
        });
        const terminal = await args.prisma.callEvent.findFirst({
          where: {
            callId: args.callId,
            call: { organizationId: args.organizationId },
            eventType: { in: ['webhook.call.ended', 'call.ended'] },
          },
          orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
        });
        if (terminal && !isSettled()) {
          const parsed = RetellEventSchema.safeParse(terminal.data);
          if (parsed.success && parsed.data.type === 'call.ended') {
            cleanup();
            resolve(parsed.data);
            return;
          }
        }
        const row = await args.prisma.call.findFirst({
          where: { id: args.callId, organizationId: args.organizationId },
          select: { cancelRequestedAt: true },
        });
        if (row?.cancelRequestedAt && !cancelInFlight && !isSettled()) {
          cancelInFlight = true;
          // Tell Retell to terminate; the natural call.ended event
          // will resolve the outer promise. Failures here are logged
          // but do not abort the wait — Retell may have already ended
          // the call (race), in which case we still resolve cleanly.
          try {
            await args.retellPort.endCall({
              retellCallId: args.retellCallId,
              reason: 'operator_cancel',
            });
            args.logger.info(
              { retellCallId: args.retellCallId, callId: args.callId },
              'cancel marker observed — endCall issued',
            );
          } catch {
            args.logger.warn(
              { retellCallId: args.retellCallId },
              'cancel marker observed — endCall failed, awaiting natural end',
            );
          }
        }
      } catch {
        args.logger.error({ callId: args.callId }, 'call event/cancel poll failed; continuing');
      } finally {
        pollInFlight = false;
      }
    };

    unsubscribe = args.retellPort.subscribe(args.retellCallId, (event) => {
      chain = chain
        .then(async () => {
          if (isSettled()) return;
          await args.prisma.callEvent.create({
            data: {
              callId: args.callId,
              eventType: event.type,
              data: event as object,
            },
          });
          if (event.type === 'call.transcript') {
            // Reaching this branch means the agent / rep is talking;
            // the call is at minimum NAVIGATING_IVR. We do not flip
            // status to ON_HOLD / HUMAN_REACHED here — those transitions
            // belong to the navigator (P3-T11) which has more context.
            await args.prisma.call.updateMany({
              where: {
                id: args.callId,
                organizationId: args.organizationId,
                status: { notIn: ['COMPLETED', 'FAILED', 'VOICEMAIL'] },
              },
              data: { status: 'NAVIGATING_IVR' },
            });
          }
          if (event.type === 'call.ended') {
            cleanup();
            resolve(event);
          }
          if (event.type === 'call.error') {
            cleanup();
            reject(new Error('Retell reported a call error.'));
          }
        })
        .catch(() => {
          cleanup();
          reject(new Error('Call event persistence failed.'));
        });
    });

    // Entry-time check + ongoing poll.
    void checkCancelMarker();
    cancelTimer = setInterval(
      () => void checkCancelMarker(),
      args.cancelPollIntervalMs ?? CANCEL_POLL_INTERVAL_MS_DEFAULT,
    );
  });
}

function endReasonToCallStatus(reason: RetellCallEndedEvent['endReason']): Call['status'] {
  switch (reason) {
    case RetellCallEndReason.COMPLETED:
    case RetellCallEndReason.AGENT_HANGUP:
      return 'COMPLETED';
    case RetellCallEndReason.USER_HANGUP:
      // Rep ended early; we still got transcript events. Keep
      // COMPLETED — biller-reviewable rather than auto-failed.
      return 'COMPLETED';
    case RetellCallEndReason.NO_ANSWER:
    case RetellCallEndReason.BUSY:
    case RetellCallEndReason.VOICEMAIL:
      return 'VOICEMAIL';
    case RetellCallEndReason.ERROR:
      return 'FAILED';
    default:
      return 'FAILED';
  }
}

function endReasonToClaimStatus(ended: RetellCallEndedEvent): ClaimStatus {
  if (
    ended.endReason === RetellCallEndReason.NO_ANSWER ||
    ended.endReason === RetellCallEndReason.BUSY ||
    ended.endReason === RetellCallEndReason.VOICEMAIL ||
    ended.endReason === RetellCallEndReason.ERROR
  ) {
    return 'MANUAL_REVIEW';
  }
  // Look for explicit denial / approval signals from the agent's
  // collectedInfo. The mapping is intentionally conservative — Phase
  // 4 unpacks more nuance into NEEDS_INFO / RESOLVED.
  const info = ended.collectedInfo ?? {};
  const rawStatus = info.claimStatus;
  const status = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
  if (status === 'denied') return 'DENIED';
  if (status === 'approved' || status === 'pending' || status === 'in process') {
    return 'COMPLETED';
  }
  return 'COMPLETED';
}

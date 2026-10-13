import {
  audit,
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
  type StartCallInput,
  validateCallIdentity,
} from '@dentabill/payer-ivr';
import { CallJobDataSchema, type CallsProcessor, type JobDispatcher } from '@dentabill/queue';
import { UnrecoverableError } from 'bullmq';

import type { WorkerEnv } from './env.js';

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

/**
 * Real call-job handler (P3-T10).
 *
 * Drives the full lifecycle for a single `call.place` job:
 *
 *   1. Re-validate the job payload at the dequeue trust boundary
 *      (ADR-035 — the queue is a trust boundary).
 *   2. Load the Claim + Organization through `getOrgScopedDb`. The
 *      org-scoped accessor + write-side middleware (ADR-009) are
 *      load-bearing here: a poisoned job pointing at another org's
 *      claim cannot read or transition that claim's row.
 *   3. Resolve the payer's IVR map and Retell agent prompt
 *      (ADR-032 / ADR-033). Throws if Phase 3 doesn't support the
 *      payer; the API enqueue route should have rejected the job
 *      earlier, so this is a defence-in-depth check.
 *   4. Transition `Claim.status → CALLING` and persist a `Call`
 *      row stamped with the `retellCallId` we get back from
 *      `RetellPort.startCall`.
 *   5. Subscribe to events. Each event is persisted as a
 *      `CallEvent` row. `call.transcript` events update the live
 *      `Call.status` (NAVIGATING_IVR → ON_HOLD → COLLECTING). A
 *      terminal `call.ended` event resolves the handler; `call.error`
 *      throws so BullMQ retries per ADR-035.
 *   6. Update Call + Claim with the final state.
 *
 * Per-call duration cap (ADR-038) and hold cap (ADR-039) are enforced
 * by P3-T11 / T12 / T13 layered on top of this base handler.
 */
export interface CallJobHandlerDeps {
  readonly logger: Logger;
  readonly prisma: DbClient;
  readonly retellPort: RetellPort;
  readonly env: WorkerEnv;
  /** Override the clock (testing seam). */
  readonly clock?: () => Date;
  /** Outbound caller number in E.164 (the worker's own dial-out line). */
  readonly outboundNumberE164: string;
  /**
   * Optional job dispatcher (Phase 4 / P4-T2G; ADR-053). When present,
   * the handler dispatches a `summary.generate` job after `Call.endedAt`
   * is persisted — onto BullMQ in the worker deployment, or to the
   * inline internal route on serverless. Absent → the handler skips
   * emission, which is the Phase-3 behaviour. Production wiring always
   * provides it.
   */
  readonly jobDispatcher?: Pick<JobDispatcher, 'dispatchSummary'>;
}

export function createCallJobHandler(deps: CallJobHandlerDeps): CallsProcessor {
  const clock = deps.clock ?? ((): Date => new Date());
  return async (job) => {
    const validation = await CallJobDataSchema.safeParseAsync(job.data);
    if (!validation.success) throw validation.error;
    const data = validation.data;

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
        const blocked = await tx.claim.updateMany({
          where: {
            id: claim.id,
            organizationId: data.organizationId,
            status: { in: ['IN_QUEUE', 'CALLING'] },
            updatedAt: claim.updatedAt,
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

    // ── 4. Transition Claim → CALLING and start the Retell call ──────
    // The org-scope write middleware requires `organizationId` in every
    // `where` payload, so we use `updateMany` with the composite filter
    // (matches the established API pattern in apps/api/src/routes/v1/claims.ts).
    //
    // Failure mode (acceptable for Phase 3): if `retellPort.startCall`
    // throws AFTER this update lands, BullMQ's retry policy (ADR-035) will
    // re-enter this handler with the same claimId. The claim is now
    // `CALLING`, the second attempt's update is a no-op, and the job
    // proceeds. If retries exhaust, the claim is stuck `CALLING` until the
    // DLQ consumer (P3-T14) writes the terminal CallEvent and the runbook
    // (P3-T28) walks oncall through the recovery psql.
    await deps.prisma.claim.updateMany({
      where: { id: claim.id, organizationId: data.organizationId },
      data: { status: 'CALLING', lastCallAt: clock() },
    });

    const startInput = buildStartCallInput({
      data,
      claim,
      org,
      ivrMap,
      agentPrompt,
      identity: identity.identity,
      outboundNumberE164: deps.outboundNumberE164,
      env: deps.env,
    });
    const startResult = await deps.retellPort.startCall(startInput);

    const call = await deps.prisma.call.create({
      data: {
        organizationId: data.organizationId,
        claimId: claim.id,
        retellCallId: startResult.retellCallId,
        retellAgentId: agentPrompt.agentId,
        status: 'INITIATED',
        attemptNumber: data.attemptNumber,
        startedAt: new Date(startResult.queuedAt),
      },
    });

    // P3-T27 — audit Call create. The system actor (no userId) drove
    // this write, so we tag `userId=null` and capture the originating
    // job id + claim for the HIPAA review trail.
    await audit({
      action: 'call.start',
      resourceType: 'Call',
      resourceId: call.id,
      organizationId: data.organizationId,
      metadata: {
        claimId: claim.id,
        jobId: job.id ?? null,
        attemptNumber: data.attemptNumber,
        payerCode: claim.payerCode,
      },
    });

    deps.logger.info(
      {
        jobId: job.id,
        callId: call.id,
        retellCallId: startResult.retellCallId,
        organizationId: data.organizationId,
        claimId: claim.id,
        attemptNumber: data.attemptNumber,
        payerCode: claim.payerCode,
      },
      'call-worker started outbound call',
    );

    // ── 5. Subscribe + persist events; resolve when call.ended ───────
    const ended = await waitForCallEnd({
      retellPort: deps.retellPort,
      retellCallId: startResult.retellCallId,
      callId: call.id,
      organizationId: data.organizationId,
      prisma: deps.prisma,
      logger: deps.logger,
    });

    // ── 6. Update Call + Claim with final state ───────────────────────
    const finalCallStatus = endReasonToCallStatus(ended.endReason);
    const finalClaimStatus = endReasonToClaimStatus(ended);
    await deps.prisma.call.updateMany({
      where: { id: call.id, organizationId: data.organizationId },
      data: {
        status: finalCallStatus,
        endedAt: new Date(ended.endedAt),
        durationSeconds: ended.durationSeconds,
        humanReached:
          ended.endReason === RetellCallEndReason.COMPLETED ||
          ended.endReason === RetellCallEndReason.AGENT_HANGUP,
      },
    });
    await deps.prisma.claim.updateMany({
      where: { id: claim.id, organizationId: data.organizationId },
      data: { status: finalClaimStatus },
    });

    // P3-T27 — audit Call lifecycle close. Captures the final status,
    // duration, and end reason so the review trail can answer
    // "what was the outcome of the call DentaBill placed at <ts>?"
    // without re-deriving it from CallEvent[].
    await audit({
      action: 'call.end',
      resourceType: 'Call',
      resourceId: call.id,
      organizationId: data.organizationId,
      metadata: {
        claimId: claim.id,
        finalCallStatus,
        finalClaimStatus,
        durationSeconds: ended.durationSeconds,
        endReason: ended.endReason,
      },
    });

    // P4-T2G — enqueue post-call summarisation. Only fired when a
    // dispatcher is wired (production deploys + the explicit tests for
    // this path). The job payload uses `call.<id>` as the idempotency
    // key (= BullMQ jobId) so a double-finalise never produces two
    // summary jobs.
    if (deps.jobDispatcher) {
      try {
        await deps.jobDispatcher.dispatchSummary({
          organizationId: data.organizationId,
          callId: call.id,
          promptVersion: 'v1',
          idempotencyKey: `call.${call.id}`,
        });
      } catch (err) {
        // Failure to enqueue is NOT fatal for the call lifecycle —
        // the call is already finalised, the operator dashboard will
        // surface the missing summary, and ops can replay via the
        // /v1/calls/:id/summary/retry route (W2H).
        deps.logger.error(
          {
            callId: call.id,
            organizationId: data.organizationId,
            err: err instanceof Error ? { message: err.message, name: err.name } : err,
          },
          'call-worker: failed to enqueue summary.generate — call lifecycle still healthy',
        );
      }
    }

    return {
      callId: call.id,
      retellCallId: startResult.retellCallId,
      outcome: finalClaimStatus === 'MANUAL_REVIEW' ? 'ESCALATED' : 'COMPLETED',
      durationSeconds: ended.durationSeconds,
    };
  };
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

    const cleanup = (): void => {
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
      if (cancelInFlight) return;
      try {
        const row = await args.prisma.call.findUnique({
          where: { id: args.callId },
          select: { cancelRequestedAt: true },
        });
        if (row?.cancelRequestedAt) {
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
          } catch (err) {
            args.logger.warn(
              { err, retellCallId: args.retellCallId },
              'cancel marker observed — endCall failed, awaiting natural end',
            );
          }
        }
      } catch (err) {
        args.logger.error({ err }, 'cancel marker poll failed; continuing');
      }
    };

    unsubscribe = args.retellPort.subscribe(args.retellCallId, (event) => {
      chain = chain.then(async () => {
        try {
          await args.prisma.callEvent.create({
            data: {
              callId: args.callId,
              eventType: event.type,
              data: event as object,
            },
          });
        } catch (err) {
          args.logger.error(
            { err, retellCallId: args.retellCallId },
            'failed to persist CallEvent',
          );
        }
        if (event.type === 'call.transcript') {
          // Reaching this branch means the agent / rep is talking;
          // the call is at minimum NAVIGATING_IVR. We do not flip
          // status to ON_HOLD / HUMAN_REACHED here — those transitions
          // belong to the navigator (P3-T11) which has more context.
          await args.prisma.call.updateMany({
            where: { id: args.callId, organizationId: args.organizationId },
            data: { status: 'NAVIGATING_IVR' },
          });
        }
        if (event.type === 'call.ended') {
          cleanup();
          resolve(event);
        }
        if (event.type === 'call.error') {
          cleanup();
          reject(new Error(`Retell call.error ${event.code}: ${event.message}`));
        }
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

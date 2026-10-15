import { hostname } from 'node:os';

import {
  GATEWAY_ERROR_CODES,
  TransportAttemptSchema,
  buildObservationRequestBody,
  createFireworksDiscoveryTransport,
  type FireworksDiscoveryTransport,
  type TransportAttempt,
} from '@dentabill/model-gateway';
import { z } from 'zod';

import {
  CaptureAuthorizationSchema,
  CaptureError,
  validateCapturePlan,
  wireHash,
  type CapturePlan,
} from './capture-plan.js';
import type { CaptureStore } from './capture-store.js';
import { HashSchema, evidenceHash, evaluationRequest } from './contracts.js';

const AdmissionSchema = z
  .object({
    planSha256: HashSchema,
    caseId: z.string(),
    wireRequestSha256: HashSchema,
    wireRequestBody: z.string().max(131_072),
    disposition: z.enum(['SEND', 'NO_SEND']),
    noSendCode: z.enum(GATEWAY_ERROR_CODES).nullable(),
    reservedUsdMicros: z.number().int().nonnegative().safe(),
    startedAt: z.string().datetime(),
    executionDeadlineAt: z.string().datetime(),
    ownerPid: z.number().int().positive().safe(),
    ownerHostSha256: HashSchema,
  })
  .strict();
const ResponseSchema = z
  .object({
    planSha256: HashSchema,
    wireRequestSha256: HashSchema,
    recordedAt: z.string().datetime(),
    index: z.literal(1),
    status: z.number().int().min(100).max(599),
    body: z.string().max(1_048_576).nullable(),
    retryDelayMs: z.number().min(0).max(60_000),
  })
  .strict();
const AttemptSchema = z
  .object({
    planSha256: HashSchema,
    wireRequestSha256: HashSchema,
    attempt: TransportAttemptSchema,
    errorCode: z.enum(GATEWAY_ERROR_CODES).nullable(),
  })
  .strict();
const ResultSchema = z
  .object({
    planSha256: HashSchema,
    caseId: z.string(),
    state: z.enum(['CAPTURED_UNVERIFIED', 'FAILED', 'UNKNOWN', 'NOT_SENT']),
    code: z.enum(GATEWAY_ERROR_CODES).nullable(),
    attempts: z.array(TransportAttemptSchema).max(1),
    responseSha256: HashSchema.nullable(),
    completedAt: z.string().datetime(),
    elapsedMs: z.number().nonnegative().finite(),
  })
  .strict();
type CaptureCaseResult = z.infer<typeof ResultSchema>;

async function readCaseRecords(
  store: CaptureStore,
  plan: CapturePlan,
  planSha256: string,
  entry: CapturePlan['cases'][number],
  body: string,
): Promise<{
  admission: z.infer<typeof AdmissionSchema> | null;
  receipt: z.infer<typeof ResponseSchema> | null;
  attempt: z.infer<typeof AttemptSchema> | null;
  result: CaptureCaseResult | null;
}> {
  const name = (kind: string): string => `case-${entry.storageId}-${kind}.json`;
  const f = await store.read(name('result'));
  const t = await store.read(name('attempt'));
  const r = await store.read(name('response'));
  const a = await store.read(name('admission'));
  const admission = a ? parse(AdmissionSchema, a) : null;
  const receipt = r ? parse(ResponseSchema, r) : null;
  const attempt = t ? parse(AttemptSchema, t) : null;
  const result = f ? parse(ResultSchema, f) : null;
  if (
    (!admission && (receipt || attempt)) ||
    [admission, receipt, attempt].some(
      (record) =>
        record &&
        (record.planSha256 !== planSha256 || record.wireRequestSha256 !== entry.wireRequestSha256),
    ) ||
    (admission &&
      (admission.caseId !== entry.caseId ||
        admission.wireRequestBody !== body ||
        wireHash(admission.wireRequestBody) !== entry.wireRequestSha256 ||
        (admission.disposition === 'SEND'
          ? admission.noSendCode !== null ||
            admission.reservedUsdMicros !== plan.budget.reservedPerCaseUsdMicros ||
            Date.parse(admission.startedAt) < Date.parse(plan.createdAt) ||
            Date.parse(admission.startedAt) >= Date.parse(plan.expiresAt) ||
            Date.parse(admission.executionDeadlineAt) > Date.parse(plan.expiresAt) ||
            Date.parse(admission.executionDeadlineAt) < Date.parse(admission.startedAt) ||
            Date.parse(admission.executionDeadlineAt) - Date.parse(admission.startedAt) >
              plan.target.policy.limits.deadlineMs
          : admission.noSendCode === null ||
            admission.reservedUsdMicros !== 0 ||
            receipt !== null ||
            attempt !== null))) ||
    (receipt &&
      (receipt.status >= 200 && receipt.status < 300
        ? receipt.body === null ||
          Buffer.byteLength(receipt.body, 'utf8') > plan.target.policy.limits.responseBytes
        : receipt.body !== null)) ||
    (attempt && attempt.attempt.index !== 1)
  )
    throw new CaptureError('CAPTURE_BINDING_MISMATCH');
  if (result) {
    if (
      result.planSha256 !== planSha256 ||
      result.caseId !== entry.caseId ||
      result.responseSha256 !== (receipt ? evidenceHash(receipt) : null) ||
      (attempt && evidenceHash(result.attempts) !== evidenceHash([attempt.attempt])) ||
      (result.state === 'NOT_SENT'
        ? admission?.disposition !== 'NO_SEND' ||
          receipt !== null ||
          attempt !== null ||
          result.attempts.length !== 0 ||
          result.code !== admission.noSendCode
        : admission?.disposition !== 'SEND' ||
          result.attempts.length !== 1 ||
          result.attempts[0]?.index !== 1) ||
      (result.state === 'UNKNOWN' && (receipt !== null || result.code === null)) ||
      (result.state === 'FAILED' &&
        (receipt === null || attempt === null || result.code === null)) ||
      (result.state === 'CAPTURED_UNVERIFIED' &&
        (receipt === null ||
          attempt === null ||
          receipt.body === null ||
          receipt.status < 200 ||
          receipt.status >= 300 ||
          result.code !== null))
    )
      throw new CaptureError('CAPTURE_BINDING_MISMATCH');
  }
  return { admission, receipt, attempt, result };
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new CaptureError('CAPTURE_JOURNAL_ERROR');
  return result.data;
}

function previousOwnerDead(admission: z.infer<typeof AdmissionSchema>): boolean {
  if (admission.ownerHostSha256 !== evidenceHash(hostname())) return false;
  try {
    process.kill(admission.ownerPid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH';
  }
}

function unknownAttempt(): TransportAttempt {
  return {
    index: 1,
    httpStatus: null,
    outcome: 'NETWORK_ERROR',
    acceptance: 'POSSIBLE',
    elapsedMs: 0,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null },
  };
}

/** Stop-only check; replayed wire counts cannot be hidden by an earlier cancelled receipt. */
function rawAllowanceExceeded(
  receipt: z.infer<typeof ResponseSchema> | null,
  plan: CapturePlan,
): boolean {
  if (!receipt?.body) return false;
  try {
    const value: unknown = JSON.parse(receipt.body);
    if (typeof value !== 'object' || value === null || !('usage' in value)) return false;
    const usage = value.usage;
    if (typeof usage !== 'object' || usage === null) return false;
    return [
      ['prompt_tokens', plan.budget.inputTokenAllowance],
      ['completion_tokens', plan.budget.completionTokenAllowance],
      ['total_tokens', plan.budget.inputTokenAllowance + plan.budget.completionTokenAllowance],
    ].some(([key, limit]) => {
      if (typeof key !== 'string' || typeof limit !== 'number') return false;
      const count: unknown = Reflect.get(usage, key);
      return typeof count === 'number' && count > limit;
    });
  } catch {
    return false;
  }
}

/** No mutations or inference; the key must identify the one account frozen in the plan. */
export async function verifyCaptureAccount(apiKey: string, accountSha256: string): Promise<void> {
  try {
    if (!/^[\x21-\x7e]{1,4096}$/.test(apiKey)) throw new CaptureError('CAPTURE_ACCOUNT_MISMATCH');
    const response = await fetch('https://api.fireworks.ai/v1/accounts?pageSize=2', {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || !response.body) throw new CaptureError('CAPTURE_ACCOUNT_MISMATCH');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        const chunk: unknown = part.value;
        if (!(chunk instanceof Uint8Array)) throw new CaptureError('CAPTURE_ACCOUNT_MISMATCH');
        size += chunk.byteLength;
        if (size > 65_536) throw new CaptureError('CAPTURE_ACCOUNT_MISMATCH');
        chunks.push(chunk);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const account = z
      .object({
        accounts: z
          .array(z.object({ name: z.string().regex(/^accounts\/[A-Za-z0-9_-]+$/) }))
          .length(1),
        nextPageToken: z.string().optional(),
      })
      .safeParse(value);
    if (
      !account.success ||
      account.data.nextPageToken ||
      wireHash(account.data.accounts[0]?.name ?? '') !== accountSha256
    )
      throw new CaptureError('CAPTURE_ACCOUNT_MISMATCH');
  } catch {
    throw new CaptureError('CAPTURE_ACCOUNT_MISMATCH');
  }
}

export interface CaptureReport {
  readonly schemaVersion: 'observation-capture-report.v1';
  readonly planSha256: string;
  readonly mode: 'UNVERIFIED_DISCOVERY';
  readonly cases: readonly CaptureCaseResult[];
  readonly budget: CapturePlan['budget'];
  readonly captured: number;
  readonly unknown: number;
  readonly failed: number;
  readonly notSent: number;
  readonly measuredModelQuality: false;
  readonly providerBillingCapVerified: false;
  readonly productionApproval: false;
}

export async function runCapture(options: {
  store: CaptureStore;
  implementationSha256: string;
  authorizePlanSha256: string;
  apiKey?: string;
  signal?: AbortSignal;
  /** Trusted test seam. The CLI never chooses transport or account verification from inputs. */
  transport?: FireworksDiscoveryTransport;
  verifyAccount?: typeof verifyCaptureAccount;
}): Promise<CaptureReport> {
  const { store } = options;
  const { plan, corpus } = validateCapturePlan(
    await store.read('manifest.json'),
    await store.read('corpus.json'),
    options.implementationSha256,
    store.directory,
  );
  const planSha256 = evidenceHash(plan);
  if (options.authorizePlanSha256 !== planSha256)
    throw new CaptureError('CAPTURE_AUTHORIZATION_REQUIRED');
  const now = Date.now();
  let authorization = await store.read('authorization.json');
  if (!authorization) {
    if (now < Date.parse(plan.createdAt) || now >= Date.parse(plan.expiresAt))
      throw new CaptureError('CAPTURE_EXPIRED');
    await store.create('authorization.json', {
      schemaVersion: 'observation-capture-authorization.v1',
      planSha256,
      authorizedAt: new Date(now).toISOString(),
      expiresAt: plan.expiresAt,
      authority: 'LOCAL_OPERATOR_EXPLICIT_CONFIRMATION',
      authenticatedHumanApproval: false,
    });
    authorization = await store.read('authorization.json');
  }
  const auth = parse(CaptureAuthorizationSchema, authorization);
  if (
    auth.planSha256 !== planSha256 ||
    auth.expiresAt !== plan.expiresAt ||
    Date.parse(auth.authorizedAt) < Date.parse(plan.createdAt) ||
    Date.parse(auth.authorizedAt) >= Date.parse(auth.expiresAt) ||
    Date.parse(auth.authorizedAt) > Date.now()
  )
    throw new CaptureError('CAPTURE_AUTHORIZATION_REQUIRED');
  const transport = options.transport ?? createFireworksDiscoveryTransport();
  const results: CaptureCaseResult[] = [];
  let accountVerified = false;
  let allowanceExceeded = false;
  const checkAllowance = (attempts: readonly TransportAttempt[]): void => {
    allowanceExceeded ||= attempts.some(
      (attempt) =>
        (attempt.usage.inputTokens ?? 0) > plan.budget.inputTokenAllowance ||
        (attempt.usage.outputTokens ?? 0) > plan.budget.completionTokenAllowance ||
        (attempt.usage.totalTokens ?? 0) >
          plan.budget.inputTokenAllowance + plan.budget.completionTokenAllowance,
    );
  };
  for (const [index, item] of corpus.cases.entries()) {
    const entry = plan.cases[index];
    if (entry?.caseId !== item.id) throw new CaptureError('CAPTURE_BINDING_MISMATCH');
    const name = (kind: string): string => `case-${entry.storageId}-${kind}.json`;
    const body = buildObservationRequestBody(
      evaluationRequest(item, { kind: 'FIREWORKS_CANDIDATE', release: plan.target }),
      plan.target,
    );
    const records = await readCaseRecords(store, plan, planSha256, entry, body);
    allowanceExceeded ||= rawAllowanceExceeded(records.receipt, plan);
    if (records.result) {
      checkAllowance(records.result.attempts);
      results.push(records.result);
      continue;
    }
    let admission: unknown = records.admission;
    const receipt = records.receipt;
    const priorAttempt = records.attempt;
    let owner = false;
    const isOwner = (): boolean => owner;
    let attempt: TransportAttempt | null = priorAttempt?.attempt ?? null;
    let responseSha256 = receipt ? evidenceHash(receipt) : null;
    let result: CaptureCaseResult;
    const base = {
      planSha256,
      caseId: item.id,
      completedAt: new Date().toISOString(),
      elapsedMs: 0,
    };
    if (admission) {
      const parsed = parse(AdmissionSchema, admission);
      if (parsed.disposition === 'SEND' && !previousOwnerDead(parsed))
        throw new CaptureError('CAPTURE_BUSY');
    }
    const prohibitSend = async (code: CaptureCaseResult['code']): Promise<void> => {
      const timestamp = new Date().toISOString();
      const saved = {
        planSha256,
        caseId: item.id,
        wireRequestSha256: entry.wireRequestSha256,
        wireRequestBody: body,
        disposition: 'NO_SEND',
        noSendCode: code,
        reservedUsdMicros: 0,
        startedAt: timestamp,
        executionDeadlineAt: timestamp,
        ownerPid: process.pid,
        ownerHostSha256: evidenceHash(hostname()),
      };
      if (!(await store.create(name('admission'), saved))) throw new CaptureError('CAPTURE_BUSY');
      admission = saved;
    };
    if (records.admission?.disposition === 'NO_SEND') {
      result = {
        ...base,
        state: 'NOT_SENT',
        code: records.admission.noSendCode,
        attempts: [],
        responseSha256: null,
      };
    } else if (admission && !receipt) {
      result = {
        ...base,
        state: 'UNKNOWN',
        code: 'INFERENCE_REVIEW_REQUIRED',
        attempts: [attempt ?? unknownAttempt()],
        responseSha256: null,
      };
    } else if (
      !admission &&
      (allowanceExceeded || Date.now() >= Date.parse(plan.expiresAt) || options.signal?.aborted)
    ) {
      const code = allowanceExceeded
        ? 'BUDGET_EXCEEDED'
        : options.signal?.aborted
          ? 'CANCELLED'
          : 'DEADLINE_EXCEEDED';
      await prohibitSend(code);
      result = {
        ...base,
        state: 'NOT_SENT',
        code,
        attempts: [],
        responseSha256: null,
      };
    } else {
      if (!admission && !accountVerified) {
        await (options.verifyAccount ?? verifyCaptureAccount)(
          options.apiKey ?? '',
          plan.evidence.accountSha256,
        );
        accountVerified = true;
      }
      const started = performance.now();
      const deadlineAt = started + plan.target.policy.limits.deadlineMs;
      const executionDeadlineAt = new Date(
        Math.min(Date.now() + plan.target.policy.limits.deadlineMs, Date.parse(plan.expiresAt)),
      ).toISOString();
      let writesPending = 0;
      const write = async (operation: () => Promise<void>): Promise<void> => {
        writesPending++;
        try {
          await operation();
        } finally {
          writesPending--;
        }
      };
      const captured = await transport({
        apiKey: options.apiKey ?? '',
        body,
        maxResponseBytes: plan.target.policy.limits.responseBytes,
        deadlineAt,
        sendDeadlineAt: receipt
          ? performance.now() - 1
          : performance.now() + (Date.parse(executionDeadlineAt) - Date.now()),
        maxAttempts: 1,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(receipt
          ? {
              replay: {
                attempts: [],
                response: {
                  index: 1,
                  status: receipt.status,
                  body: receipt.body,
                  retryDelayMs: receipt.retryDelayMs,
                },
              },
            }
          : {}),
        journal: {
          async beforeAttempt(input) {
            if (
              receipt ||
              input.index !== 1 ||
              input.wireRequestHash !== entry.wireRequestSha256 ||
              options.signal?.aborted
            )
              return 'BLOCKED';
            if (Date.now() >= Date.parse(executionDeadlineAt)) return 'DEADLINE_EXCEEDED';
            await write(async () => {
              owner = await store.create(name('admission'), {
                planSha256,
                caseId: item.id,
                wireRequestSha256: entry.wireRequestSha256,
                wireRequestBody: body,
                disposition: 'SEND',
                noSendCode: null,
                reservedUsdMicros: plan.budget.reservedPerCaseUsdMicros,
                startedAt: new Date().toISOString(),
                executionDeadlineAt,
                ownerPid: process.pid,
                ownerHostSha256: evidenceHash(hostname()),
              });
              admission = await store.read(name('admission'));
            });
            return owner ? 'ADMITTED' : 'BLOCKED';
          },
          async recordResponse(value) {
            if (!owner || value.index !== 1) throw new CaptureError('CAPTURE_JOURNAL_ERROR');
            const saved = parse(ResponseSchema, {
              ...value,
              planSha256,
              wireRequestSha256: entry.wireRequestSha256,
              recordedAt: new Date().toISOString(),
            });
            await write(async () => {
              if (!(await store.create(name('response'), saved)))
                throw new CaptureError('CAPTURE_JOURNAL_ERROR');
            });
            responseSha256 = evidenceHash(saved);
          },
          async completeAttempt(value) {
            if ((!owner && !receipt) || value.attempt.index !== 1)
              throw new CaptureError('CAPTURE_JOURNAL_ERROR');
            await write(async () => {
              if (!priorAttempt) {
                const saved = parse(AttemptSchema, {
                  ...value,
                  planSha256,
                  wireRequestSha256: entry.wireRequestSha256,
                });
                await store.create(name('attempt'), saved);
                const actual = parse(AttemptSchema, await store.read(name('attempt')));
                if (
                  actual.planSha256 !== planSha256 ||
                  actual.wireRequestSha256 !== entry.wireRequestSha256
                )
                  throw new CaptureError('CAPTURE_BINDING_MISMATCH');
                attempt = actual.attempt;
              }
            });
          },
        },
      });
      if (writesPending > 0 || (!captured.ok && captured.code === 'JOURNAL_ERROR'))
        throw new CaptureError('CAPTURE_JOURNAL_ERROR');
      if (!receipt && !isOwner() && admission) throw new CaptureError('CAPTURE_BUSY');
      if (!receipt && !isOwner()) {
        if (captured.ok) throw new CaptureError('CAPTURE_JOURNAL_ERROR');
        await prohibitSend(captured.code);
      }
      result = {
        ...base,
        state: captured.ok
          ? 'CAPTURED_UNVERIFIED'
          : isOwner() && !responseSha256
            ? 'UNKNOWN'
            : receipt || responseSha256
              ? 'FAILED'
              : 'NOT_SENT',
        code: captured.ok ? null : captured.code,
        attempts: attempt ? [attempt] : [...captured.attempts],
        responseSha256,
        completedAt: new Date().toISOString(),
        elapsedMs: Math.max(0, Math.ceil(performance.now() - started)),
      };
    }
    await store.create(name('result'), parse(ResultSchema, result));
    const completedRecords = await readCaseRecords(store, plan, planSha256, entry, body);
    allowanceExceeded ||= rawAllowanceExceeded(completedRecords.receipt, plan);
    const actual = completedRecords.result;
    if (!actual) throw new CaptureError('CAPTURE_JOURNAL_ERROR');
    checkAllowance(actual.attempts);
    results.push(actual);
  }
  const report: CaptureReport = {
    schemaVersion: 'observation-capture-report.v1',
    planSha256,
    mode: 'UNVERIFIED_DISCOVERY',
    cases: results,
    budget: plan.budget,
    captured: results.filter((item) => item.state === 'CAPTURED_UNVERIFIED').length,
    unknown: results.filter((item) => item.state === 'UNKNOWN').length,
    failed: results.filter((item) => item.state === 'FAILED').length,
    notSent: results.filter((item) => item.state === 'NOT_SENT').length,
    measuredModelQuality: false,
    providerBillingCapVerified: false,
    productionApproval: false,
  };
  await store.create('capture-report.json', report);
  if (evidenceHash(await store.read('capture-report.json')) !== evidenceHash(report))
    throw new CaptureError('CAPTURE_BINDING_MISMATCH');
  return report;
}

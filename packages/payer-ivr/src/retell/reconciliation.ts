import { z } from 'zod';

import type { RetellCallEndedEvent } from './events.js';
import { parseRetellWebhookEnvelope } from './webhook.js';

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

export interface RetellCallCandidate {
  readonly providerCallId: string;
  readonly agentId: string;
  readonly fromNumberE164: string | null;
  readonly toNumberE164: string | null;
  readonly intentId: string;
  readonly callType: 'phone_call' | 'web_call';
  readonly direction: 'inbound' | 'outbound' | null;
  readonly startedAt: string | null;
}

export interface ReadonlyRetellReconciliationPort {
  /** Complete bounded enumeration, or an error; an empty result never authorizes redial. */
  findCallsByIntent(input: {
    readonly intentId: string;
    readonly signal?: AbortSignal;
  }): Promise<readonly RetellCallCandidate[]>;
  /** The caller must compare this identity with both the discovery result and its local intent. */
  getCall(input: { readonly providerCallId: string; readonly signal?: AbortSignal }): Promise<{
    readonly candidate: RetellCallCandidate;
    readonly terminalEvent: RetellCallEndedEvent | null;
  }>;
}

export type RetellReconciliationClient = ReadonlyRetellReconciliationPort;

export interface RetellReconciliationClientOptions {
  readonly apiKey: string;
  /** Transport seam for synthetic contract tests. The production origin is fixed. */
  readonly fetch?: typeof fetch;
  readonly maxPages?: number;
  readonly maxCandidates?: number;
  readonly pageSize?: number;
  /** One deadline covers every page and all response body reads in an operation. */
  readonly timeoutMs?: number;
}

export type RetellReconciliationErrorCode =
  | 'INPUT_INVALID'
  | 'NETWORK'
  | 'HTTP'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'RESPONSE_INVALID'
  | 'INCOMPLETE'
  | 'DUPLICATE'
  | 'IDENTITY_MISMATCH'
  | 'LIMIT_EXCEEDED';

/** Never contains provider response text, request identifiers, credentials, or an unsafe cause. */
export class RetellReconciliationError extends Error {
  override readonly name = 'RetellReconciliationError';

  constructor(
    readonly code: RetellReconciliationErrorCode,
    readonly status?: number,
  ) {
    super(`Retell read-only reconciliation failed (${code}).`);
  }
}

const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);
const intentIdentifier = z
  .string()
  .min(5)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/);
const baseFields = {
  call_id: identifier,
  agent_id: identifier,
  call_status: z.enum(['registered', 'not_connected', 'ongoing', 'ended', 'error']),
  metadata: z.object({ dentabill_intent_id: intentIdentifier }),
  start_timestamp: z.number().int().nonnegative().max(8_640_000_000_000_000).optional(),
};
const callIdentity = z.discriminatedUnion('call_type', [
  z.object({
    ...baseFields,
    call_type: z.literal('phone_call'),
    direction: z.enum(['inbound', 'outbound']),
    from_number: z.string().regex(/^\+[0-9]{8,15}$/),
    to_number: z.string().regex(/^\+[0-9]{8,15}$/),
  }),
  z.object({ ...baseFields, call_type: z.literal('web_call') }),
]);
const pageEnvelope = z.object({
  items: z.array(z.unknown()),
  has_more: z.boolean(),
  pagination_key: z.string().min(1).max(4096).optional(),
});
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function boundedOption(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RetellReconciliationError('INPUT_INVALID');
  }
  return value;
}

function parseIdentity(raw: unknown): z.infer<typeof callIdentity> {
  const parsed = callIdentity.safeParse(raw);
  if (!parsed.success) throw new RetellReconciliationError('RESPONSE_INVALID');
  return parsed.data;
}

function candidateOf(call: z.infer<typeof callIdentity>): RetellCallCandidate {
  return {
    providerCallId: call.call_id,
    agentId: call.agent_id,
    fromNumberE164: call.call_type === 'phone_call' ? call.from_number : null,
    toNumberE164: call.call_type === 'phone_call' ? call.to_number : null,
    intentId: call.metadata.dentabill_intent_id,
    callType: call.call_type,
    direction: call.call_type === 'phone_call' ? call.direction : null,
    startedAt:
      call.start_timestamp === undefined ? null : new Date(call.start_timestamp).toISOString(),
  };
}

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof RetellReconciliationError
      ? signal.reason
      : new RetellReconciliationError('CANCELLED');
  }
}

async function withDeadline<T>(
  timeoutMs: number,
  external: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (external?.aborted) throw new RetellReconciliationError('CANCELLED');
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  let interrupt: (error: RetellReconciliationError) => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    interrupt = (error) => {
      reject(error);
      controller.abort(error);
    };
  });
  const onCancel = (): void => {
    interrupt(new RetellReconciliationError('CANCELLED'));
  };
  external?.addEventListener('abort', onCancel, { once: true });
  const timer = setTimeout(() => {
    interrupt(new RetellReconciliationError('TIMEOUT'));
  }, timeoutMs);
  try {
    // Race bounds even a faulty injected transport that ignores AbortSignal.
    // The installed SDK's AbortController shim omits onabort; native Node supports it.
    const result = await Promise.race([work(controller.signal as AbortSignal), interrupted]);
    // Synchronous parsing can delay the timer callback; never accept an overdue result.
    if (Date.now() >= deadline) throw new RetellReconciliationError('TIMEOUT');
    return result;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onCancel);
  }
}

async function readJson(response: FetchResponse, signal: AbortSignal): Promise<unknown> {
  checkAbort(signal);
  if (!response.body) throw new RetellReconciliationError('RESPONSE_INVALID');
  const reader = response.body.getReader();
  const cancel = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      checkAbort(signal);
      if (chunk.done) break;
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) throw new RetellReconciliationError('RESPONSE_INVALID');
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        cancel();
        throw new RetellReconciliationError('LIMIT_EXCEEDED');
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) as unknown;
    } catch {
      throw new RetellReconciliationError('RESPONSE_INVALID');
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/**
 * Read-only HTTP contracts verified 2026-10-13:
 * https://docs.retellai.com/api-references/list-calls (POST /v3/list-calls)
 * https://docs.retellai.com/api-references/get-call (GET /v2/get-call/{call_id})
 * https://github.com/RetellAI/retell-typescript-sdk/blob/main/src/resources/call.ts
 * The current SDK source defines metadata StringFilter's explicit `op: 'eq'`.
 * Installed SDK 5.16's v2 list contract is not used. No retries or mutations occur here.
 * Full pagination is not a provider consistency guarantee or proof of call absence.
 */
export function createRetellReconciliationClient(
  options: RetellReconciliationClientOptions,
): RetellReconciliationClient {
  if (!options.apiKey.trim()) throw new RetellReconciliationError('INPUT_INVALID');
  const transport = options.fetch ?? fetch;
  const maxPages = boundedOption(options.maxPages ?? 3, 10);
  const maxCandidates = boundedOption(options.maxCandidates ?? 20, 100);
  const pageSize = boundedOption(options.pageSize ?? 10, 100);
  const timeoutMs = boundedOption(options.timeoutMs ?? 10_000, 30_000);

  async function request(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    checkAbort(signal);
    try {
      const response = await transport(`https://api.retellai.com${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal,
        redirect: 'error',
      });
      if (signal.aborted || response.status !== 200) {
        void response.body?.cancel().catch(() => undefined);
        checkAbort(signal);
        throw new RetellReconciliationError('HTTP', response.status);
      }
      return await readJson(response, signal);
    } catch (error) {
      if (error instanceof RetellReconciliationError) throw error;
      checkAbort(signal);
      throw new RetellReconciliationError('NETWORK');
    }
  }

  return {
    async findCallsByIntent({ intentId, signal }): Promise<readonly RetellCallCandidate[]> {
      if (!intentIdentifier.safeParse(intentId).success) {
        throw new RetellReconciliationError('INPUT_INVALID');
      }
      return withDeadline(timeoutMs, signal, async (operationSignal) => {
        const candidates: RetellCallCandidate[] = [];
        const ids = new Set<string>();
        const cursors = new Set<string>();
        let cursor: string | undefined;
        for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
          const raw = await request('/v3/list-calls', operationSignal, {
            filter_criteria: {
              metadata: [{ key: 'dentabill_intent_id', type: 'string', op: 'eq', value: intentId }],
            },
            sort_order: 'descending',
            limit: pageSize,
            include_total: false,
            ...(cursor === undefined ? {} : { pagination_key: cursor }),
          });
          const parsed = pageEnvelope.safeParse(raw);
          if (!parsed.success) throw new RetellReconciliationError('RESPONSE_INVALID');
          const page = parsed.data;
          if (
            page.items.length > pageSize ||
            candidates.length + page.items.length > maxCandidates
          ) {
            throw new RetellReconciliationError('LIMIT_EXCEEDED');
          }
          for (const item of page.items) {
            const candidate = candidateOf(parseIdentity(item));
            if (candidate.intentId !== intentId) {
              throw new RetellReconciliationError('IDENTITY_MISMATCH');
            }
            if (ids.has(candidate.providerCallId)) throw new RetellReconciliationError('DUPLICATE');
            ids.add(candidate.providerCallId);
            candidates.push(candidate);
          }
          if (!page.has_more) return candidates;
          if (!page.pagination_key || page.items.length === 0 || cursors.has(page.pagination_key)) {
            throw new RetellReconciliationError('INCOMPLETE');
          }
          cursors.add(page.pagination_key);
          cursor = page.pagination_key;
          if (candidates.length >= maxCandidates) {
            throw new RetellReconciliationError('LIMIT_EXCEEDED');
          }
        }
        throw new RetellReconciliationError('INCOMPLETE');
      });
    },

    async getCall({ providerCallId, signal }) {
      if (!identifier.safeParse(providerCallId).success) {
        throw new RetellReconciliationError('INPUT_INVALID');
      }
      return withDeadline(timeoutMs, signal, async (operationSignal) => {
        const raw = await request(
          `/v2/get-call/${encodeURIComponent(providerCallId)}`,
          operationSignal,
        );
        const call = parseIdentity(raw);
        if (call.call_id !== providerCallId)
          throw new RetellReconciliationError('IDENTITY_MISMATCH');
        let terminalEvent: RetellCallEndedEvent | null = null;
        if (
          call.call_type === 'phone_call' &&
          call.direction === 'outbound' &&
          (call.call_status === 'ended' || call.call_status === 'error')
        ) {
          try {
            const delivery = parseRetellWebhookEnvelope(
              JSON.stringify({ event: 'call_ended', call: raw }),
            );
            if (delivery.event?.type !== 'call.ended') {
              throw new RetellReconciliationError('RESPONSE_INVALID');
            }
            terminalEvent = delivery.event;
          } catch {
            throw new RetellReconciliationError('RESPONSE_INVALID');
          }
        }
        return { candidate: candidateOf(call), terminalEvent };
      });
    },
  };
}

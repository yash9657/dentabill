import { createHash } from 'node:crypto';

import {
  FIREWORKS_ENDPOINT,
  TransportAttemptSchema,
  unknownUsage,
  type FireworksTransport,
  type FireworksTransportRequest,
  type GatewayErrorCode,
  type TransportAttempt,
  type TransportResult,
  type Usage,
} from './contracts.js';

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const OPAQUE_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_DEPTH = 32;

class TransportFailure extends Error {
  constructor(readonly code: GatewayErrorCode) {
    super(code);
  }
}

class Deadline {
  readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failure: TransportFailure | undefined;
  private closed = false;
  private readonly onCancel = (): void => {
    this.abort('CANCELLED');
  };

  constructor(private readonly request: FireworksTransportRequest) {
    request.signal?.addEventListener('abort', this.onCancel, { once: true });
    if (request.signal?.aborted) this.abort('CANCELLED');
    else this.arm();
  }

  get inactive(): boolean {
    return this.closed || this.controller.signal.aborted;
  }

  check(): void {
    this.throwIfFailed();
    if (this.request.signal?.aborted) this.abort('CANCELLED');
    else if (performance.now() >= this.request.deadlineAt) this.abort('DEADLINE_EXCEEDED');
    this.throwIfFailed();
  }

  private throwIfFailed(): void {
    if (this.failure) throw this.failure;
  }

  remaining(): number {
    this.check();
    return this.request.deadlineAt - performance.now();
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.check();
    return new Promise<T>((resolve, reject) => {
      const aborted = (): void => {
        reject(this.failure ?? new TransportFailure('CANCELLED'));
      };
      this.controller.signal.addEventListener('abort', aborted, { once: true });
      Promise.resolve()
        .then(() => {
          this.check();
          return operation();
        })
        .then(
          (value) => {
            this.controller.signal.removeEventListener('abort', aborted);
            try {
              this.check();
              resolve(value);
            } catch (error) {
              reject(
                error instanceof TransportFailure ? error : new TransportFailure('NETWORK_ERROR'),
              );
            }
          },
          (error: unknown) => {
            this.controller.signal.removeEventListener('abort', aborted);
            reject(
              error instanceof TransportFailure ? error : new TransportFailure('NETWORK_ERROR'),
            );
          },
        );
    });
  }

  async sleep(ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.run(
        () =>
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, ms);
          }),
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.request.signal?.removeEventListener('abort', this.onCancel);
  }

  abort(code: 'CANCELLED' | 'DEADLINE_EXCEEDED'): void {
    if (this.failure || this.closed) return;
    this.failure = new TransportFailure(code);
    this.controller.abort();
  }

  private arm(): void {
    const remaining = this.request.deadlineAt - performance.now();
    if (remaining <= 0) {
      this.abort('DEADLINE_EXCEEDED');
      return;
    }
    this.timer = setTimeout(
      () => {
        this.arm();
      },
      Math.min(2_147_483_647, Math.ceil(remaining)),
    );
  }
}

function discard(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    /* Discard is best effort. */
  }
}

async function readBody(response: Response, maximum: number, deadline: Deadline): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null && /^[0-9]+$/.test(declared) && Number(declared) > maximum) {
    discard(response);
    throw new TransportFailure('RESPONSE_TOO_LARGE');
  }
  if (!response.body) throw new TransportFailure('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const pieces: string[] = [];
  let bytes = 0;
  let complete = false;
  try {
    for (;;) {
      const part = await deadline.run(() => reader.read());
      if (part.done) {
        complete = true;
        break;
      }
      const chunk: unknown = part.value;
      if (!(chunk instanceof Uint8Array)) throw new TransportFailure('INVALID_RESPONSE');
      if (chunk.byteLength > maximum - bytes) throw new TransportFailure('RESPONSE_TOO_LARGE');
      bytes += chunk.byteLength;
      try {
        pieces.push(decoder.decode(chunk, { stream: true }));
      } catch {
        throw new TransportFailure('INVALID_RESPONSE');
      }
    }
    try {
      pieces.push(decoder.decode());
    } catch {
      throw new TransportFailure('INVALID_RESPONSE');
    }
    deadline.check();
    return pieces.join('');
  } finally {
    if (!complete) {
      try {
        void reader.cancel().catch(() => undefined);
      } catch {
        /* An aborting reader may be locked. */
      }
    }
    try {
      reader.releaseLock();
    } catch {
      /* A pending read cannot retain the transport. */
    }
  }
}

function scanJsonDepth(text: string, maxDepth: number, check: () => void): boolean {
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) return false;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    if (index % 4096 === 0) check();
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') {
      depth += 1;
      if (depth > maxDepth) return false;
    } else if (character === '}' || character === ']') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && !quoted;
}

/** Lexical preflight only; callers must still parse JSON and validate its schema. */
export function isWithinJsonDepth(text: string, maxDepth = MAX_DEPTH): boolean {
  return scanJsonDepth(text, maxDepth, () => undefined);
}

function parseJson(text: string, deadline: Deadline): unknown {
  if (
    !scanJsonDepth(text, MAX_DEPTH, () => {
      deadline.check();
    })
  )
    throw new TransportFailure('INVALID_RESPONSE');
  deadline.check();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new TransportFailure('INVALID_RESPONSE');
  }
  deadline.check();
  return parsed;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function usageFrom(value: unknown): { usage: Usage; valid: boolean } {
  if (value === null || value === undefined) return { usage: unknownUsage(), valid: true };
  const row = object(value);
  if (!row) return { usage: unknownUsage(), valid: false };
  let valid = true;
  const count = (value: unknown): number | null => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
    valid = false;
    return null;
  };
  const details = row.prompt_tokens_details;
  const promptDetails = object(details);
  if (details !== null && details !== undefined && !promptDetails) valid = false;
  const usage: Usage = {
    inputTokens: count(row.prompt_tokens),
    outputTokens: count(row.completion_tokens),
    totalTokens: count(row.total_tokens),
    cachedInputTokens: count(promptDetails?.cached_tokens),
  };
  const { inputTokens, outputTokens, totalTokens, cachedInputTokens } = usage;
  const inconsistent =
    (totalTokens !== null && inputTokens !== null && totalTokens < inputTokens) ||
    (totalTokens !== null && outputTokens !== null && totalTokens < outputTokens) ||
    (totalTokens !== null &&
      inputTokens !== null &&
      outputTokens !== null &&
      (!Number.isSafeInteger(inputTokens + outputTokens) ||
        totalTokens !== inputTokens + outputTokens)) ||
    (cachedInputTokens !== null && inputTokens !== null && cachedInputTokens > inputTokens) ||
    (cachedInputTokens !== null && totalTokens !== null && cachedInputTokens > totalTokens);
  if (inconsistent) {
    return { usage: { ...usage, totalTokens: null, cachedInputTokens: null }, valid: false };
  }
  return { usage, valid };
}

function completion(
  value: unknown,
  expectedModels: readonly string[],
): {
  content: string;
  responseId: string | null;
  model: string;
} {
  const row = object(value);
  if (!row) throw new TransportFailure('INVALID_RESPONSE');
  const model = row.model;
  if (typeof model !== 'string') throw new TransportFailure('INVALID_RESPONSE');
  if (!expectedModels.includes(model)) throw new TransportFailure('MODEL_IDENTITY_MISMATCH');
  const id = row.id;
  if (id !== null && id !== undefined && (typeof id !== 'string' || !OPAQUE_ID.test(id)))
    throw new TransportFailure('INVALID_RESPONSE');
  const choices = row.choices;
  if (!Array.isArray(choices) || choices.length !== 1)
    throw new TransportFailure('INVALID_RESPONSE');
  const choice = object(choices[0]);
  if (choice?.index !== 0) throw new TransportFailure('INVALID_RESPONSE');
  const message = object(choice.message);
  if (message?.role !== 'assistant') throw new TransportFailure('INVALID_RESPONSE');
  if (message.refusal !== undefined && message.refusal !== null)
    throw new TransportFailure('REFUSED');
  if (choice.finish_reason === 'content_filter') throw new TransportFailure('REFUSED');
  if (choice.finish_reason === 'length') throw new TransportFailure('TRUNCATED');
  if (
    choice.finish_reason !== 'stop' ||
    typeof message.content !== 'string' ||
    (message.tool_calls !== undefined && message.tool_calls !== null) ||
    (message.tool_call_id !== undefined && message.tool_call_id !== null) ||
    (message.function_call !== undefined && message.function_call !== null)
  )
    throw new TransportFailure('INVALID_RESPONSE');
  return { content: message.content, responseId: typeof id === 'string' ? id : null, model };
}

function retryDelay(response: Response): number {
  const localJitter = 100 + Math.floor(Math.random() * 101);
  const header = response.headers.get('retry-after')?.trim();
  if (!header) return localJitter;
  if (/^[0-9]+$/.test(header)) return Math.max(localJitter, Number(header) * 1000);
  if (/^[A-Za-z]{3}, [0-9]{2} [A-Za-z]{3} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/.test(header)) {
    const time = Date.parse(header);
    if (Number.isFinite(time)) return Math.max(localJitter, time - Date.now());
  }
  return localJitter;
}

function attemptOutcome(code: GatewayErrorCode): TransportAttempt['outcome'] {
  if (
    code === 'DEADLINE_EXCEEDED' ||
    code === 'CANCELLED' ||
    code === 'NETWORK_ERROR' ||
    code === 'HTTP_ERROR'
  )
    return code;
  return 'INVALID_RESPONSE';
}

function validConfiguration(request: FireworksTransportRequest): boolean {
  return (
    typeof request.apiKey === 'string' &&
    request.apiKey.trim().length > 0 &&
    !/[\r\n]/.test(request.apiKey) &&
    typeof request.body === 'string' &&
    Number.isFinite(request.deadlineAt) &&
    Number.isSafeInteger(request.maxResponseBytes) &&
    request.maxResponseBytes > 0 &&
    [1, 2].includes(request.maxAttempts) &&
    request.expectedResponseModels.length > 0 &&
    request.expectedResponseModels.every((model) => typeof model === 'string' && model.length > 0)
  );
}

/** Accounting may finish after caller cancellation, but cannot permit a late network send. */
async function persist<T>(operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(operation)
        .catch(() => {
          throw new TransportFailure('JOURNAL_ERROR');
        }),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new TransportFailure('JOURNAL_ERROR'));
        }, 5000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function invocationUsage(attempts: readonly TransportAttempt[]): Usage {
  const sum = (field: keyof Usage): number | null => {
    let total = 0;
    for (const attempt of attempts) {
      const value = attempt.usage[field];
      if (value === null || !Number.isSafeInteger(total + value)) return null;
      total += value;
    }
    return total;
  };
  return {
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    totalTokens: sum('totalTokens'),
    cachedInputTokens: sum('cachedInputTokens'),
  };
}

export function createFireworksTransport(
  options: { readonly fetch?: typeof globalThis.fetch } = {},
): FireworksTransport {
  const fetcher = options.fetch ?? globalThis.fetch;
  return async (request): Promise<TransportResult> => {
    const attempts: TransportAttempt[] = [];
    let activeAttempt: Omit<TransportAttempt, 'outcome'> | null = null;
    const publish = (): void => {
      try {
        request.onProgress?.({
          completedAttempts: attempts.map((attempt) => ({
            ...attempt,
            usage: { ...attempt.usage },
          })),
          activeAttempt: activeAttempt
            ? { ...activeAttempt, usage: { ...activeAttempt.usage } }
            : null,
        });
      } catch {
        /* Diagnostics cannot substitute for or bypass the awaited journal. */
      }
    };
    publish();
    if (!validConfiguration(request) || typeof fetcher !== 'function')
      return { ok: false, code: 'CONFIGURATION_ERROR', attempts };
    const journal = request.journal;
    if (
      !journal ||
      typeof journal.beforeAttempt !== 'function' ||
      typeof journal.recordResponse !== 'function' ||
      typeof journal.completeAttempt !== 'function'
    )
      return { ok: false, code: 'ACCOUNTING_REQUIRED', attempts };
    const replay = request.replay;
    if (replay) {
      if (
        !Number.isSafeInteger(replay.response.index) ||
        replay.response.index < 1 ||
        replay.response.index > request.maxAttempts ||
        replay.attempts.length !== replay.response.index - 1 ||
        replay.attempts.some(
          (attempt, i) =>
            !TransportAttemptSchema.safeParse(attempt).success || attempt.index !== i + 1,
        ) ||
        !Number.isSafeInteger(replay.response.status) ||
        replay.response.status < 100 ||
        replay.response.status > 599 ||
        !Number.isFinite(replay.response.retryDelayMs) ||
        replay.response.retryDelayMs < 0 ||
        replay.response.retryDelayMs > 60_000 ||
        (replay.response.status >= 200 && replay.response.status < 300
          ? typeof replay.response.body !== 'string' ||
            Buffer.byteLength(replay.response.body, 'utf8') > request.maxResponseBytes
          : replay.response.body !== null)
      )
        return { ok: false, code: 'CONFIGURATION_ERROR', attempts };
      attempts.push(...structuredClone(replay.attempts));
      publish();
    }
    const wireRequestHash = createHash('sha256').update(request.body).digest('hex');
    const sendDeadlineAt = Math.min(
      request.sendDeadlineAt ?? request.deadlineAt,
      request.deadlineAt,
    );
    if (!Number.isFinite(sendDeadlineAt))
      return { ok: false, code: 'CONFIGURATION_ERROR', attempts };
    const deadline = new Deadline(request);
    try {
      for (let index = replay?.response.index ?? 1; index <= request.maxAttempts; index += 1) {
        deadline.check();
        const started = performance.now();
        let status: number | null = null;
        let acceptance: TransportAttempt['acceptance'] = 'NOT_SENT';
        let usage = unknownUsage();
        let admitted = false;
        let completed = false;
        let journalFailed = false;
        let interpretation: {
          outcome: TransportAttempt['outcome'];
          errorCode: GatewayErrorCode | null;
        } | null = null;
        const completionState = (): { completed: boolean; journalFailed: boolean } => ({
          completed,
          journalFailed,
        });
        const updateProgress = (): void => {
          activeAttempt = {
            index,
            httpStatus: status,
            acceptance,
            elapsedMs: Math.max(0, performance.now() - started),
            usage,
          };
          publish();
        };
        const save = async (
          outcome: TransportAttempt['outcome'],
          code: GatewayErrorCode | null,
        ): Promise<void> => {
          if (!admitted) {
            activeAttempt = null;
            completed = true;
            publish();
            return;
          }
          const attempt: TransportAttempt = {
            index,
            httpStatus: status,
            outcome,
            acceptance,
            elapsedMs: Math.max(0, performance.now() - started),
            usage,
          };
          try {
            await persist(() => journal.completeAttempt({ attempt, errorCode: code }));
          } catch {
            journalFailed = true;
            throw new TransportFailure('JOURNAL_ERROR');
          }
          attempts.push(attempt);
          activeAttempt = null;
          completed = true;
          publish();
        };
        updateProgress();
        let response: Response | undefined;
        try {
          let text: string | null;
          let delay = 0;
          const saved = replay?.response.index === index ? replay.response : null;
          if (saved) {
            admitted = true;
            status = saved.status;
            acceptance = 'RESPONDED';
            text = saved.body;
            delay = saved.retryDelayMs;
            updateProgress();
          } else {
            if (performance.now() >= sendDeadlineAt)
              throw new TransportFailure('DEADLINE_EXCEEDED');
            const admission = await persist(() =>
              journal.beforeAttempt({ index, wireRequestHash }),
            );
            if (admission !== 'ADMITTED') {
              const code =
                admission === 'BUDGET_EXCEEDED'
                  ? 'BUDGET_EXCEEDED'
                  : admission === 'DEADLINE_EXCEEDED'
                    ? 'DEADLINE_EXCEEDED'
                    : 'ADMISSION_DENIED';
              throw new TransportFailure(code);
            }
            admitted = true;
            // Awaited admission may finish after cancellation/deadline. Recheck at the actual send boundary.
            deadline.check();
            if (performance.now() >= sendDeadlineAt)
              throw new TransportFailure('DEADLINE_EXCEEDED');
            response = await deadline.run(async () => {
              deadline.check();
              if (performance.now() >= sendDeadlineAt)
                throw new TransportFailure('DEADLINE_EXCEEDED');
              acceptance = 'POSSIBLE';
              updateProgress();
              const received = await fetcher(FIREWORKS_ENDPOINT, {
                method: 'POST',
                redirect: 'error',
                headers: {
                  Authorization: `Bearer ${request.apiKey}`,
                  'Content-Type': 'application/json',
                  Accept: 'application/json',
                },
                body: request.body,
                signal: deadline.controller.signal,
              });
              if (deadline.inactive) discard(received);
              else {
                status = received.status;
                acceptance = 'RESPONDED';
                updateProgress();
              }
              return received;
            });
            status = response.status;
            acceptance = 'RESPONDED';
            if (response.ok) text = await readBody(response, request.maxResponseBytes, deadline);
            else {
              delay = Math.min(60_000, retryDelay(response));
              text = null;
              discard(response);
            }
            // Preserve bounded wire evidence before JSON, model, finish, usage or observation validation.
            try {
              await persist(() =>
                journal.recordResponse({
                  index,
                  status: status ?? 0,
                  body: text,
                  retryDelayMs: delay,
                }),
              );
            } catch {
              journalFailed = true;
              throw new TransportFailure('JOURNAL_ERROR');
            }
          }
          deadline.check();
          if (status < 200 || status >= 300) {
            await save('HTTP_ERROR', 'HTTP_ERROR');
            if (
              index < request.maxAttempts &&
              RETRY_STATUSES.has(status) &&
              delay < Math.min(deadline.remaining(), sendDeadlineAt - performance.now())
            ) {
              await deadline.sleep(delay);
              continue;
            }
            return { ok: false, code: 'HTTP_ERROR', attempts };
          }
          if (text === null) throw new TransportFailure('INVALID_RESPONSE');
          const parsed = parseJson(text, deadline);
          const accounting = usageFrom(object(parsed)?.usage);
          usage = accounting.usage;
          updateProgress();
          if (!accounting.valid) throw new TransportFailure('INVALID_RESPONSE');
          const result = completion(parsed, request.expectedResponseModels);
          interpretation = { outcome: 'COMPLETED', errorCode: null };
          deadline.check();
          await save('COMPLETED', null);
          deadline.check();
          return { ok: true, ...result, usage: invocationUsage(attempts), attempts };
        } catch (error) {
          if (response) discard(response);
          let code: GatewayErrorCode =
            error instanceof TransportFailure ? error.code : 'NETWORK_ERROR';
          const interpretedError = code;
          if (code === 'JOURNAL_ERROR') journalFailed = true;
          if (!journalFailed) {
            try {
              deadline.check();
            } catch (deadlineError) {
              if (deadlineError instanceof TransportFailure) code = deadlineError.code;
            }
          }
          if (!completionState().completed && !completionState().journalFailed) {
            try {
              // A caller interrupt cannot replace an interpretation already obtained from saved evidence.
              const definite =
                interpretation ??
                (!['CANCELLED', 'DEADLINE_EXCEEDED'].includes(interpretedError)
                  ? { outcome: attemptOutcome(interpretedError), errorCode: interpretedError }
                  : null);
              await save(
                definite?.outcome ?? attemptOutcome(code),
                definite ? definite.errorCode : code,
              );
            } catch {
              code = 'JOURNAL_ERROR';
            }
          }
          // If storage failed, preserve the active attempt in the safe result without fabricating a receipt.
          if (!completionState().completed) {
            attempts.push({
              index,
              httpStatus: status,
              outcome: attemptOutcome(code),
              acceptance,
              elapsedMs: Math.max(0, performance.now() - started),
              usage,
            });
            activeAttempt = null;
            publish();
          }
          return { ok: false, code, attempts };
        }
      }
      return { ok: false, code: 'HTTP_ERROR', attempts };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof TransportFailure ? error.code : 'NETWORK_ERROR',
        attempts,
      };
    } finally {
      deadline.close();
    }
  };
}

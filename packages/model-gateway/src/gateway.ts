import {
  GatewayRequestSchema,
  PROMPT_VERSION,
  SCHEMA_VERSION,
  TASK_VERSION,
  unknownUsage,
  type FireworksTransport,
  type GatewayErrorCode,
  type GatewayRequest,
  type GatewayResult,
  type ModelGateway,
  type TransportAttempt,
  type TransportProgress,
  type TransportResult,
} from './contracts.js';
import { createReleaseRegistry, sha256, type ModelRelease } from './release.js';
import {
  OBSERVATION_JSON_SCHEMA,
  SYSTEM_PROMPT,
  validateGatewayInput,
  validateObservation,
} from './task.js';
import { createFireworksTransport, isWithinJsonDepth } from './transport.js';

function elapsed(start: number): number {
  return Math.max(0, Math.ceil(performance.now() - start));
}

export function gatewayFailure(
  code: GatewayErrorCode,
  startedAt: number,
  attempts: readonly TransportAttempt[] = [],
): GatewayResult {
  return { status: 'FAILED', code, attempts, elapsedMs: elapsed(startedAt) };
}

function ambiguousAttempt(start: number, outcome: TransportAttempt['outcome']): TransportAttempt {
  return {
    index: 1,
    httpStatus: null,
    outcome,
    acceptance: 'POSSIBLE',
    elapsedMs: elapsed(start),
    usage: unknownUsage(),
  };
}

async function boundedTransport(
  transport: FireworksTransport,
  request: Parameters<FireworksTransport>[0],
  startedAt: number,
): Promise<TransportResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let progress: TransportProgress | undefined;
  const interruptedAttempts = (
    outcome: TransportAttempt['outcome'],
  ): readonly TransportAttempt[] => {
    if (!progress) return [ambiguousAttempt(startedAt, outcome)];
    return [
      ...progress.completedAttempts,
      ...(progress.activeAttempt ? [{ ...progress.activeAttempt, outcome }] : []),
    ];
  };
  try {
    const result = await Promise.race([
      transport({
        ...request,
        signal: controller.signal,
        onProgress: (snapshot): void => {
          progress = structuredClone(snapshot);
        },
      }),
      new Promise<TransportResult>((resolve) => {
        const stop = (code: 'CANCELLED' | 'DEADLINE_EXCEEDED'): void => {
          controller.abort();
          resolve({ ok: false, code, attempts: interruptedAttempts(code) });
        };
        onAbort = (): void => {
          stop('CANCELLED');
        };
        request.signal?.addEventListener('abort', onAbort, { once: true });
        const arm = (): void => {
          const remaining = request.deadlineAt - performance.now();
          if (remaining <= 0) stop('DEADLINE_EXCEEDED');
          else timeout = setTimeout(arm, Math.ceil(remaining));
        };
        arm();
        if (request.signal?.aborted) stop('CANCELLED');
      }),
    ]);
    return result;
  } catch {
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      attempts: interruptedAttempts('NETWORK_ERROR'),
    };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (onAbort) request.signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

function requestBody(request: GatewayRequest, release: ModelRelease): string {
  return JSON.stringify({
    model: release.policy.requestModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          task: request.task,
          claim: {
            id: request.claim.id,
            version: request.claim.version,
            billedMinorUnits: request.claim.billedMinorUnits,
            currency: request.claim.currency,
          },
          sources: request.sources.map(({ id, version, kind, text }) => ({
            id,
            version,
            kind,
            text,
          })),
        }),
      },
    ],
    stream: false,
    n: 1,
    max_tokens: release.policy.limits.outputTokens,
    context_length_exceeded_behavior: 'error',
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'claim_observation_v1', schema: OBSERVATION_JSON_SCHEMA },
    },
    prompt_cache_isolation_key: sha256(
      JSON.stringify(['dentabill', request.organizationId, request.releaseId]),
    ),
  });
}

export function createFireworksGateway(
  options: {
    readonly apiKey?: string;
    readonly releases?: readonly ModelRelease[];
    readonly implementationArtifactSha256?: string;
    /** A trusted fixture seam, never derived from request data or environment URLs. */
    readonly transport?: FireworksTransport;
  } = {},
): ModelGateway {
  const registry = createReleaseRegistry(options);
  const transport = options.transport ?? createFireworksTransport();
  const apiKey = options.apiKey;
  return {
    async generate(input, options = {}): Promise<GatewayResult> {
      const startedAt = performance.now();
      if (options.signal?.aborted) return gatewayFailure('CANCELLED', startedAt);
      let request: GatewayRequest;
      try {
        const parsed = GatewayRequestSchema.safeParse(input);
        if (!parsed.success || !validateGatewayInput(parsed.data))
          return gatewayFailure('INVALID_REQUEST', startedAt);
        request = parsed.data;
      } catch {
        return gatewayFailure('INVALID_REQUEST', startedAt);
      }
      const resolution = registry.resolve(request);
      if (!resolution.ok) return gatewayFailure(resolution.code, startedAt);
      const release = resolution.release;
      if (!apiKey || !/^[\x21-\x7e]{1,4096}$/.test(apiKey))
        return gatewayFailure('CONFIGURATION_ERROR', startedAt);
      const deadlineAt = startedAt + release.policy.limits.deadlineMs;
      const body = requestBody(request, release);
      if (Buffer.byteLength(body, 'utf8') > release.policy.limits.requestBytes)
        return gatewayFailure('REQUEST_TOO_LARGE', startedAt);
      if (options.signal?.aborted) return gatewayFailure('CANCELLED', startedAt);
      if (performance.now() >= deadlineAt) return gatewayFailure('DEADLINE_EXCEEDED', startedAt);
      const result = await boundedTransport(
        transport,
        {
          apiKey,
          body,
          expectedResponseModels: release.policy.responseModels,
          maxResponseBytes: release.policy.limits.responseBytes,
          deadlineAt,
          maxAttempts: release.policy.limits.maxAttempts,
          ...(options.signal ? { signal: options.signal } : {}),
        },
        startedAt,
      );
      if (!result.ok) return gatewayFailure(result.code, startedAt, result.attempts);
      if (options.signal?.aborted) return gatewayFailure('CANCELLED', startedAt, result.attempts);
      if (performance.now() >= deadlineAt)
        return gatewayFailure('DEADLINE_EXCEEDED', startedAt, result.attempts);
      let value: unknown;
      try {
        if (!isWithinJsonDepth(result.content))
          return gatewayFailure('OUTPUT_SCHEMA_INVALID', startedAt, result.attempts);
        value = JSON.parse(result.content);
      } catch {
        return gatewayFailure('OUTPUT_SCHEMA_INVALID', startedAt, result.attempts);
      }
      try {
        const validated = validateObservation(value, request);
        if (!validated.ok) return gatewayFailure(validated.code, startedAt, result.attempts);
        if (options.signal?.aborted) return gatewayFailure('CANCELLED', startedAt, result.attempts);
        if (performance.now() >= deadlineAt)
          return gatewayFailure('DEADLINE_EXCEEDED', startedAt, result.attempts);
        return {
          status: validated.output.disposition === 'ABSTAIN' ? 'ABSTAINED' : 'VALIDATED',
          output: validated.output,
          requiresHumanReview: true,
          provenance: {
            kind: 'FIREWORKS',
            releaseId: request.releaseId,
            task: TASK_VERSION,
            promptVersion: PROMPT_VERSION,
            schemaVersion: SCHEMA_VERSION,
            responseId: result.responseId,
            model: result.model,
            attempts: result.attempts,
            usage: result.usage,
            elapsedMs: elapsed(startedAt),
          },
        };
      } catch {
        return gatewayFailure('VALIDATOR_FAILED', startedAt, result.attempts);
      }
    },
  };
}

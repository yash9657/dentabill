import {
  GatewayRequestSchema,
  PROMPT_VERSION,
  SCHEMA_VERSION,
  TASK_VERSION,
  unknownUsage,
  type ClaimObservation,
  type GatewayRequest,
  type GatewayResult,
  type ModelGateway,
} from './contracts.js';
import { gatewayFailure } from './gateway.js';
import { sha256 } from './release.js';
import { validateGatewayInput, validateObservation } from './task.js';

export const SYNTHETIC_RELEASE_ID = 'synthetic.claim-observation.v1';

export function createFakeModelGateway(
  fixtures: readonly {
    readonly request: GatewayRequest;
    readonly output: ClaimObservation;
  }[] = [],
): ModelGateway {
  const saved = new Map<string, ClaimObservation>();
  for (const fixture of fixtures) {
    const parsed = GatewayRequestSchema.safeParse(fixture.request);
    if (
      !parsed.success ||
      parsed.data.dataClass !== 'SYNTHETIC' ||
      parsed.data.releaseId !== SYNTHETIC_RELEASE_ID ||
      !validateGatewayInput(parsed.data)
    ) {
      throw new Error('INVALID_SYNTHETIC_FIXTURE');
    }
    const validation = validateObservation(fixture.output, parsed.data);
    const key = sha256(JSON.stringify(parsed.data));
    if (!validation.ok || saved.has(key)) throw new Error('INVALID_SYNTHETIC_FIXTURE');
    saved.set(key, structuredClone(validation.output));
  }
  return {
    generate(input, options = {}): Promise<GatewayResult> {
      const startedAt = performance.now();
      const fail = (code: Parameters<typeof gatewayFailure>[0]): Promise<GatewayResult> =>
        Promise.resolve(gatewayFailure(code, startedAt));
      if (options.signal?.aborted) return fail('CANCELLED');
      const parsed = GatewayRequestSchema.safeParse(input);
      if (!parsed.success || !validateGatewayInput(parsed.data)) return fail('INVALID_REQUEST');
      const request = parsed.data;
      if (request.dataClass !== 'SYNTHETIC' || request.releaseId !== SYNTHETIC_RELEASE_ID)
        return fail('RELEASE_SCOPE_MISMATCH');
      const output = saved.get(sha256(JSON.stringify(request))) ?? {
        disposition: 'ABSTAIN',
        claimId: request.claim.id,
        claimVersion: request.claim.version,
        status: { value: 'UNKNOWN', evidence: [] },
        payerReportedPayment: null,
        denialCodes: [],
        proposedAction: 'MANUAL_REVIEW',
        abstentionReason: 'INSUFFICIENT_EVIDENCE',
      };
      return Promise.resolve({
        status: output.disposition === 'ABSTAIN' ? 'ABSTAINED' : 'VALIDATED',
        output: structuredClone(output),
        requiresHumanReview: true,
        provenance: {
          kind: 'SYNTHETIC',
          releaseId: SYNTHETIC_RELEASE_ID,
          task: TASK_VERSION,
          promptVersion: PROMPT_VERSION,
          schemaVersion: SCHEMA_VERSION,
          responseId: null,
          model: null,
          attempts: [],
          usage: unknownUsage(),
          elapsedMs: Math.ceil(performance.now() - startedAt),
        },
      });
    },
  };
}

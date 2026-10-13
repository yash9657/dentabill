import { z } from 'zod';

export const TASK_VERSION = 'claim-observation.v1' as const;
export const PROMPT_VERSION = 'claim-observation-prompt.v1' as const;
export const SCHEMA_VERSION = 'claim-observation-schema.v1' as const;
export const FIREWORKS_ENDPOINT =
  'https://us.api.fireworks.ai/inference/v1/chat/completions' as const;
export const OpaqueIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.-]+$/);
export const SourceSchema = z
  .object({
    id: OpaqueIdSchema,
    organizationId: OpaqueIdSchema,
    claimId: OpaqueIdSchema,
    claimVersion: z.string().max(64).datetime(),
    version: OpaqueIdSchema,
    kind: z.literal('FINAL_CALL_TRANSCRIPT'),
    text: z.string().min(1).max(65_536),
  })
  .strict();
export const GatewayRequestSchema = z
  .object({
    organizationId: OpaqueIdSchema,
    invocationId: OpaqueIdSchema,
    releaseId: OpaqueIdSchema,
    task: z.literal(TASK_VERSION),
    dataClass: z.enum(['SYNTHETIC', 'PROTECTED']),
    claim: z
      .object({
        id: OpaqueIdSchema,
        organizationId: OpaqueIdSchema,
        version: z.string().max(64).datetime(),
        billedMinorUnits: z.number().int().min(0).max(1_000_000_000),
        currency: z.literal('USD'),
      })
      .strict(),
    sources: z.array(SourceSchema).min(1).max(8),
  })
  .strict();
export type GatewayRequest = z.infer<typeof GatewayRequestSchema>;

export const EvidenceSchema = z
  .object({
    sourceId: OpaqueIdSchema,
    sourceVersion: OpaqueIdSchema,
    start: z.number().int().min(0).max(65_536),
    end: z.number().int().min(1).max(65_536),
    quote: z.string().min(1).max(4096),
  })
  .strict();
export const ObservationSchema = z
  .object({
    disposition: z.enum(['OBSERVED', 'ABSTAIN']),
    claimId: OpaqueIdSchema,
    claimVersion: z.string().max(64).datetime(),
    status: z
      .object({
        value: z.enum(['PAID_REPORTED', 'DENIED_REPORTED', 'PENDING_REPORTED', 'UNKNOWN']),
        evidence: z.array(EvidenceSchema).max(8),
      })
      .strict(),
    payerReportedPayment: z
      .object({
        amountMinorUnits: z.number().int().min(0).max(1_000_000_000),
        currency: z.literal('USD'),
        evidence: z.array(EvidenceSchema).min(1).max(8),
      })
      .strict()
      .nullable(),
    denialCodes: z
      .array(
        z
          .object({
            system: z.enum(['CARC', 'RARC', 'PAYER_LOCAL', 'UNKNOWN']),
            code: z.string().min(1).max(64),
            evidence: z.array(EvidenceSchema).min(1).max(8),
          })
          .strict(),
      )
      .max(16),
    proposedAction: z.enum([
      'REVIEW_PAYMENT',
      'REVIEW_DENIAL',
      'FOLLOW_UP',
      'REQUEST_INFORMATION',
      'MANUAL_REVIEW',
    ]),
    abstentionReason: z
      .enum(['INSUFFICIENT_EVIDENCE', 'CONTRADICTORY_EVIDENCE', 'UNSUPPORTED_CONTENT'])
      .nullable(),
  })
  .strict();
export type ClaimObservation = z.infer<typeof ObservationSchema>;

export const GATEWAY_ERROR_CODES = [
  'INVALID_REQUEST',
  'RELEASE_NOT_FOUND',
  'RELEASE_DISABLED',
  'RELEASE_UNAPPROVED',
  'RELEASE_SCOPE_MISMATCH',
  'RELEASE_INTEGRITY_FAILED',
  'CONFIGURATION_ERROR',
  'REQUEST_TOO_LARGE',
  'RESPONSE_TOO_LARGE',
  'DEADLINE_EXCEEDED',
  'CANCELLED',
  'NETWORK_ERROR',
  'HTTP_ERROR',
  'INVALID_RESPONSE',
  'MODEL_IDENTITY_MISMATCH',
  'TRUNCATED',
  'REFUSED',
  'OUTPUT_SCHEMA_INVALID',
  'OUTPUT_SEMANTIC_INVALID',
  'VALIDATOR_FAILED',
] as const;
export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[number];
export interface Usage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly cachedInputTokens: number | null;
}
export interface TransportAttempt {
  readonly index: number;
  readonly httpStatus: number | null;
  readonly outcome:
    | 'COMPLETED'
    | 'HTTP_ERROR'
    | 'NETWORK_ERROR'
    | 'DEADLINE_EXCEEDED'
    | 'CANCELLED'
    | 'INVALID_RESPONSE';
  readonly acceptance: 'NOT_SENT' | 'POSSIBLE' | 'RESPONDED';
  readonly elapsedMs: number;
  readonly usage: Usage;
}
export type TransportResult =
  | {
      readonly ok: true;
      readonly content: string;
      readonly responseId: string | null;
      readonly model: string;
      readonly usage: Usage;
      readonly attempts: readonly TransportAttempt[];
    }
  | {
      readonly ok: false;
      readonly code: GatewayErrorCode;
      readonly attempts: readonly TransportAttempt[];
    };
export interface TransportProgress {
  readonly completedAttempts: readonly TransportAttempt[];
  readonly activeAttempt: Omit<TransportAttempt, 'outcome'> | null;
}
export interface FireworksTransportRequest {
  readonly apiKey: string;
  readonly body: string;
  readonly expectedResponseModels: readonly string[];
  readonly maxResponseBytes: number;
  /** performance.now()-based end-to-end deadline, shared with gateway validation. */
  readonly deadlineAt: number;
  readonly maxAttempts: 1 | 2;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: TransportProgress) => void;
}
export type FireworksTransport = (request: FireworksTransportRequest) => Promise<TransportResult>;
export type GatewayResult =
  | {
      readonly status: 'VALIDATED' | 'ABSTAINED';
      readonly output: ClaimObservation;
      readonly requiresHumanReview: true;
      readonly provenance: {
        readonly kind: 'FIREWORKS' | 'SYNTHETIC';
        readonly releaseId: string;
        readonly task: typeof TASK_VERSION;
        readonly promptVersion: typeof PROMPT_VERSION;
        readonly schemaVersion: typeof SCHEMA_VERSION;
        readonly responseId: string | null;
        readonly model: string | null;
        readonly attempts: readonly TransportAttempt[];
        readonly usage: Usage;
        readonly elapsedMs: number;
      };
    }
  | {
      readonly status: 'FAILED';
      readonly code: GatewayErrorCode;
      readonly attempts: readonly TransportAttempt[];
      readonly elapsedMs: number;
    };
export interface ModelGateway {
  generate(
    request: GatewayRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GatewayResult>;
}
export const unknownUsage = (): Usage => ({
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  cachedInputTokens: null,
});

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
  'ACCOUNTING_REQUIRED',
  'ADMISSION_DENIED',
  'JOURNAL_ERROR',
  'INFERENCE_BUSY',
  'INFERENCE_REVIEW_REQUIRED',
  'BUDGET_EXCEEDED',
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
/** Sensitive bounded response evidence. Store it before parsing or interpreting vendor JSON. */
export interface TransportResponseReceipt {
  readonly index: number;
  readonly status: number;
  readonly body: string | null;
  readonly retryDelayMs: number;
}
export interface TransportReplay {
  /** Completed earlier attempts only; the response's ordinal is revalidated locally. */
  readonly attempts: readonly TransportAttempt[];
  readonly response: TransportResponseReceipt;
}
export interface TransportJournal {
  beforeAttempt(input: {
    readonly index: number;
    readonly wireRequestHash: string;
  }): Promise<'ADMITTED' | 'REPLAY' | 'BUDGET_EXCEEDED' | 'DEADLINE_EXCEEDED' | 'BLOCKED'>;
  recordResponse(receipt: TransportResponseReceipt): Promise<void>;
  completeAttempt(receipt: {
    readonly attempt: TransportAttempt;
    readonly errorCode: GatewayErrorCode | null;
  }): Promise<void>;
}
export interface FireworksTransportRequest {
  readonly apiKey: string;
  readonly body: string;
  readonly expectedResponseModels: readonly string[];
  readonly maxResponseBytes: number;
  /** performance.now()-based end-to-end deadline, shared with gateway validation. */
  readonly deadlineAt: number;
  readonly maxAttempts: 1 | 2;
  /** An original monotonic send deadline; local receipt replay may use a fresh validation budget. */
  readonly sendDeadlineAt?: number;
  readonly journal?: TransportJournal;
  readonly replay?: TransportReplay;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: TransportProgress) => void;
}
export type FireworksTransport = (request: FireworksTransportRequest) => Promise<TransportResult>;
/** Capture-only request. It cannot be used as an observation transport with an empty allowlist. */
export type FireworksDiscoveryTransportRequest = Omit<
  FireworksTransportRequest,
  'expectedResponseModels'
>;
/**
 * A capture confirms only a journaled bounded JSON object and basic usage validation.
 * Model identity, completion content/finish, and observation correctness remain unverified.
 * Sensitive raw response text is available only through the required transport journal.
 */
export type FireworksDiscoveryTransportResult =
  | {
      readonly ok: true;
      readonly captured: true;
      readonly usage: Usage;
      readonly attempts: readonly TransportAttempt[];
    }
  | {
      readonly ok: false;
      readonly code: GatewayErrorCode;
      readonly attempts: readonly TransportAttempt[];
    };
export type FireworksDiscoveryTransport = (
  request: FireworksDiscoveryTransportRequest,
) => Promise<FireworksDiscoveryTransportResult>;
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
const UsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().safe().nullable(),
    outputTokens: z.number().int().nonnegative().safe().nullable(),
    totalTokens: z.number().int().nonnegative().safe().nullable(),
    cachedInputTokens: z.number().int().nonnegative().safe().nullable(),
  })
  .strict();
export const TransportAttemptSchema = z
  .object({
    index: z.number().int().min(1).max(2),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    outcome: z.enum([
      'COMPLETED',
      'HTTP_ERROR',
      'NETWORK_ERROR',
      'DEADLINE_EXCEEDED',
      'CANCELLED',
      'INVALID_RESPONSE',
    ]),
    acceptance: z.enum(['NOT_SENT', 'POSSIBLE', 'RESPONDED']),
    elapsedMs: z.number().nonnegative().finite(),
    usage: UsageSchema,
  })
  .strict();
export const GatewayResultSchema = z.union([
  z
    .object({
      status: z.enum(['VALIDATED', 'ABSTAINED']),
      output: ObservationSchema,
      requiresHumanReview: z.literal(true),
      provenance: z
        .object({
          kind: z.enum(['FIREWORKS', 'SYNTHETIC']),
          releaseId: OpaqueIdSchema,
          task: z.literal(TASK_VERSION),
          promptVersion: z.literal(PROMPT_VERSION),
          schemaVersion: z.literal(SCHEMA_VERSION),
          responseId: OpaqueIdSchema.nullable(),
          model: z.string().max(256).nullable(),
          attempts: z.array(TransportAttemptSchema).max(2),
          usage: UsageSchema,
          elapsedMs: z.number().nonnegative().finite(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      status: z.literal('FAILED'),
      code: z.enum(GATEWAY_ERROR_CODES),
      attempts: z.array(TransportAttemptSchema).max(2),
      elapsedMs: z.number().nonnegative().finite(),
    })
    .strict(),
]);
export interface GatewayJournalBinding {
  readonly request: GatewayRequest;
  readonly wireRequestHash: string;
  readonly releasePolicyHash: string;
  readonly requestBytes: number;
  readonly executionDeadlineAt: string;
  readonly limits: {
    readonly requestBytes: number;
    readonly responseBytes: number;
    readonly outputTokens: number;
    readonly deadlineMs: number;
    readonly maxAttempts: 1 | 2;
  };
}
export interface GatewayJournalSession {
  readonly journal: TransportJournal;
  /** Original persisted wall-clock deadline. A restart cannot extend the send window. */
  readonly executionDeadlineAt: string;
  readonly replay?: TransportReplay;
  /** Called after validation; per-attempt receipts and usage have already committed. */
  complete(result: GatewayResult): Promise<void>;
}
export type GatewayJournalOpen =
  | { readonly kind: 'READY'; readonly session: GatewayJournalSession }
  | { readonly kind: 'RESULT'; readonly result: GatewayResult }
  | {
      readonly kind: 'DENIED';
      readonly code: GatewayErrorCode;
      readonly attempts?: readonly TransportAttempt[];
    };
export interface GatewayJournalFactory {
  open(
    binding: GatewayJournalBinding,
    options: { readonly signal: AbortSignal },
  ): Promise<GatewayJournalOpen>;
}
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

import { z } from 'zod';

/**
 * Wire-format contract for API errors. Every Fastify route returns this
 * shape on failure — no stack traces, no raw `Error` objects.
 *
 *   { "error": true, "message": "string", "code": "STRING_CODE" }
 *
 * Frontend consumers parse with `ApiErrorSchema.parse(body)` — never trust
 * the shape blindly.
 */
export const ApiErrorSchema = z.object({
  error: z.literal(true),
  message: z.string().min(1),
  code: z.string().min(1),
});

export type ApiErrorPayload = z.infer<typeof ApiErrorSchema>;

/**
 * Catalog of well-known error codes. Add new codes here, never inline.
 * Each maps to a default HTTP status via {@link httpStatusForCode}.
 */
export const API_ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',
  ORG_SCOPE_MISSING: 'ORG_SCOPE_MISSING',
  ORG_SCOPE_VIOLATION: 'ORG_SCOPE_VIOLATION',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  /**
   * Phase 3 — payer's provider line is outside business hours. The
   * UI uses this code to render a "Reopens at <time>" tooltip on the
   * disabled "Call now" pill (ADR-037).
   */
  PAYER_HOURS_CLOSED: 'PAYER_HOURS_CLOSED',
  /**
   * Phase 3 — the claim's `payerCode` is not one of the three payers
   * Phase 3 supports (Delta Dental PPO, Cigna Dental, MetLife Dental).
   * The UI uses this code to render a "Manual review only" badge.
   */
  UNSUPPORTED_PAYER: 'UNSUPPORTED_PAYER',
  /**
   * Phase 3 — Organization.npi (and the per-payer override on
   * PayerConfig.providerNpi) are both empty. The call worker would
   * fail with the same condition; we pre-flight at the API so the UI
   * can surface a deep link to /dashboard/settings/organization
   * instead of letting a job die in the DLQ.
   */
  MISSING_PROVIDER_NPI: 'MISSING_PROVIDER_NPI',
  MISSING_CALL_IDENTITY: 'MISSING_CALL_IDENTITY',
  CALL_RECONCILIATION_UNAVAILABLE: 'CALL_RECONCILIATION_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

const CODE_TO_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  AUTHENTICATION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  WEBHOOK_SIGNATURE_INVALID: 401,
  ORG_SCOPE_MISSING: 403,
  ORG_SCOPE_VIOLATION: 403,
  INVALID_STATE_TRANSITION: 409,
  // 422 (Unprocessable Entity) — request was syntactically valid but
  // domain rules reject it. This is the canonical status for "you
  // can't dial right now" / "we don't support this payer yet".
  PAYER_HOURS_CLOSED: 422,
  UNSUPPORTED_PAYER: 422,
  MISSING_PROVIDER_NPI: 422,
  MISSING_CALL_IDENTITY: 422,
  CALL_RECONCILIATION_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/**
 * Returns the canonical HTTP status code for a known {@link ApiErrorCode}.
 * Unknown codes fall back to 500 — but you should add new codes to the
 * catalog rather than relying on the fallback.
 */
export function httpStatusForCode(code: string): number {
  // Cast for the lookup, but the runtime value may not be a known code,
  // so the lookup may return undefined. The fallback handles that.
  const status: number | undefined = (CODE_TO_STATUS as Record<string, number>)[code];
  return status ?? 500;
}

/**
 * Throwable + serializable application error. Construct with a known code;
 * serializers turn this into the {@link ApiErrorSchema} wire format.
 *
 *   throw new ApiError('ORG_SCOPE_MISSING', 'organizationId required')
 */
export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly statusCode: number;

  public constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = httpStatusForCode(code);
    // Restore prototype chain across compile targets that strip it.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJson(): ApiErrorPayload {
    return {
      error: true,
      message: this.message,
      code: this.code,
    };
  }

  public static isApiError(value: unknown): value is ApiError {
    return value instanceof ApiError;
  }
}

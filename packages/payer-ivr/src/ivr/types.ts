import { z } from 'zod';

import { SUPPORTED_PAYER_CODES } from '../payer-codes.js';

/**
 * DTMF timing rules — sourced verbatim from PRD §6.
 *
 * The call worker MUST use these exact values; lowering them produces
 * IVRs that swallow keypresses, raising them blows our per-call budget
 * (ADR-038). Override only with a new ADR.
 */
export const DTMF_TIMING = {
  /** Time to wait after the call connects before the first DTMF press. */
  POST_CONNECT_MS: 2_500,
  /** Minimum gap between DTMF digits. */
  INTER_DIGIT_MS: 1_500,
  /** Minimum gap between an IVR speech prompt and our reply. */
  POST_SPEECH_MS: 3_000,
  /** Inter-digit gap when entering an NPI (10 digits). */
  NPI_DIGIT_MS: 800,
} as const;

/**
 * Steps the navigator can execute. Mirrors PRD §6's `IvrStep` discriminated
 * union with one addition (`COLLECT_VOICE_INPUT`) — the LLM-driven path the
 * agent uses when an IVR asks for spoken member-ID input rather than DTMF.
 *
 * Each step is pure data; the navigator (`apps/call-worker`) interprets it
 * against a live Retell call.
 */
export const IvrStepSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('WAIT'),
    /** Wall-clock pause in milliseconds. */
    ms: z.number().int().positive(),
    /** Optional human-readable rationale shown in the call event log. */
    note: z.string().optional(),
  }),
  z.object({
    type: z.literal('DTMF'),
    /** A single digit `0`–`9`, `*`, or `#`. Multi-digit sequences are an explicit array of steps. */
    digit: z.string().regex(/^[0-9*#]$/),
    /** ms to wait BEFORE pressing — usually 0 because preceding `WAIT` covers it. */
    waitBefore: z.number().int().min(0),
    /** ms to wait AFTER pressing. Must be ≥ DTMF_TIMING.INTER_DIGIT_MS for non-NPI digits. */
    waitAfter: z.number().int().min(0),
    note: z.string().optional(),
  }),
  z.object({
    type: z.literal('SPEECH'),
    /** Verbatim phrase the LLM should say. Templated `{{var}}` placeholders are substituted by the worker. */
    say: z.string().min(1),
    /** ms to wait after speaking — IVRs need time to consume the speech. */
    waitAfter: z.number().int().min(0),
    note: z.string().optional(),
  }),
  z.object({
    type: z.literal('WAIT_FOR_HUMAN'),
    /** Hard wall on hold time before the navigator gives up and reschedules (ADR-039 default). */
    maxWaitMs: z.number().int().positive(),
    note: z.string().optional(),
  }),
  z.object({
    type: z.literal('COLLECT_VOICE_INPUT'),
    /** Variable the worker must have populated before the call. */
    fromVar: z.enum(['memberId', 'subscriberId', 'npi', 'claimNumber', 'dateOfService']),
    /** ms to wait after speaking. */
    waitAfter: z.number().int().min(0),
    note: z.string().optional(),
  }),
]);

export type IvrStep = z.infer<typeof IvrStepSchema>;

/**
 * IANA timezone names — narrow to what we know we'll see in Phase 3
 * (the three Phase-3 payers operate in CT and ET only) so a typo on a
 * future entry is caught at type-check time. Extend explicitly when
 * onboarding payers in other zones.
 */
export const SUPPORTED_PAYER_TIMEZONES = ['America/New_York', 'America/Chicago'] as const;

export const PayerIvrMapSchema = z.object({
  payerCode: z.enum(SUPPORTED_PAYER_CODES as readonly [string, ...string[]]),
  displayName: z.string().min(1),
  providerLine: z.string().regex(/^\+?[0-9 ()\-.]{7,}$/),
  timezone: z.enum(SUPPORTED_PAYER_TIMEZONES),
  /** Hour-of-day (24h) the provider line opens, payer-local. */
  hoursStartHour: z.number().int().min(0).max(23),
  /** Hour-of-day (24h) the provider line closes, payer-local. */
  hoursEndHour: z.number().int().min(1).max(24),
  /**
   * Days of week the provider line is open, in JS `Date.getDay()`
   * convention (0 = Sunday, 1 = Monday, …, 6 = Saturday). Phase-1
   * dental payers all run weekdays only — Mon–Fri = `[1,2,3,4,5]`.
   * Encoded explicitly so we never accidentally call a payer on a
   * Saturday because we forgot to check.
   */
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
  /** Mid-point of the PRD §6 hold range, used for queue priority math. */
  estimatedHoldMinutes: z.number().int().positive(),
  steps: z.array(IvrStepSchema).min(1),
  /**
   * Free-form notes about calibration date, fallback assumptions, and
   * known IVR quirks. Required so engineers reading the file know how
   * stale the digit sequence is — Phase 3 ships representative
   * skeletons that need dial-test calibration before first production
   * traffic.
   */
  notes: z.array(z.string().min(1)).min(1),
});

export type PayerIvrMap = z.infer<typeof PayerIvrMapSchema>;

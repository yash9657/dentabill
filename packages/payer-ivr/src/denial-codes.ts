/**
 * Allow-list of denial / adjustment codes the summarizer is permitted
 * to emit on `CallSummary.denialCode`. Anything outside this list is
 * either an LLM hallucination or a payer-specific code we haven't
 * mapped yet — both should route the claim to MANUAL_REVIEW rather
 * than auto-decision.
 *
 * The codes are X12 Claim Adjustment Reason Codes (CARC) plus dental-
 * specific Remittance Advice Remark Codes (RARC) commonly cited by
 * Delta Dental PPO, Cigna Dental, and MetLife Dental IVR + rep
 * scripts. Keep this list small and dental-relevant; expanding it to
 * full CARC/RARC is Phase-6 work.
 *
 * Source: payer EOB samples + ADA dental-billing reference (2024).
 * Anything we add here needs a comment naming the payer + scenario it
 * was observed under.
 */
export const DENIAL_CODES = [
  // CO-50: non-covered service (most common denial across all three
  // Phase-3 payers). Cigna + MetLife scripts cite it verbatim.
  'CO-50',
  // CO-29: timely-filing limit exceeded (Cigna 365d, MetLife 180d).
  'CO-29',
  // CO-96: non-covered charge — patient elected non-covered procedure.
  'CO-96',
  // CO-97: benefit included in another adjudicated procedure
  // (frequently cited on bundled cleanings + exams).
  'CO-97',
  // CO-109: claim not covered by this payer (wrong payer routing —
  // resubmit, don't appeal).
  'CO-109',
  // CO-167: diagnosis not covered (rare in dental — appears on cosmetic
  // claims sent without a medical-necessity narrative).
  'CO-167',
  // PR-1: deductible amount (informational, not a true denial — but
  // reps cite it as a denial code on partial-pay claims).
  'PR-1',
  // PR-2: coinsurance amount (same caveat as PR-1).
  'PR-2',
  // PR-3: copayment amount.
  'PR-3',
  // PR-204: not covered under the patient's current benefit plan.
  'PR-204',
  // N362: number of days/units exceeded benefit (Delta Dental PPO
  // cites this on frequency-limited cleanings).
  'N362',
  // N370: missing tooth clause exclusion.
  'N370',
  // N522: duplicate claim.
  'N522',
] as const;

export type DenialCode = (typeof DENIAL_CODES)[number];

const DENIAL_CODE_SET: ReadonlySet<string> = new Set(DENIAL_CODES);

export function isKnownDenialCode(value: string): value is DenialCode {
  return DENIAL_CODE_SET.has(value);
}

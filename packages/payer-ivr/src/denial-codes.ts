/**
 * Small recognition subset retained for compatibility. Unknown codes are
 * preserved as raw observations and require review, not rejected as false.
 *
 * CO/PR prefixes are adjustment groups, numeric suffixes are CARCs, and
 * N-prefixed entries here are RARCs. Recognition does not validate the
 * payer's use, clinical meaning, responsibility, or appropriate next action.
 *
 * Existing annotations checked against X12 on 2026-10-13:
 * https://x12.org/codes/claim-adjustment-reason-codes
 * https://x12.org/codes/remittance-advice-remark-codes
 * These brief paraphrases are not a complete or licensed code dictionary.
 */
export const DENIAL_CODES = [
  // CARC 50: payer determination of insufficient medical necessity.
  'CO-50',
  // CARC 29: filing deadline passed; no payer-specific window is implied.
  'CO-29',
  // CARC 96: excluded charge; consult the required accompanying remark.
  'CO-96',
  // CARC 97: payment for another adjudicated service includes this benefit.
  'CO-97',
  // CARC 109: coverage belongs with a different payer/contractor.
  'CO-109',
  // CARC 167: diagnosis outside coverage; no clinical cause is inferred.
  'CO-167',
  // CARC 1: deductible component, not itself evidence of a denial.
  'PR-1',
  // CARC 2: coinsurance component.
  'PR-2',
  // CARC 3: copayment component.
  'PR-3',
  // CARC 204: current plan excludes the service, equipment, or drug.
  'PR-204',
  // RARC N362: service-day/unit quantity above the accepted maximum.
  'N362',
  // RARC N370: rental period beyond the payer's covered/approved months.
  'N370',
  // RARC N522: duplicate of a processed or forthcoming crossover claim.
  'N522',
] as const;

export type DenialCode = (typeof DENIAL_CODES)[number];

const DENIAL_CODE_SET: ReadonlySet<string> = new Set(DENIAL_CODES);

export function isKnownDenialCode(value: string): value is DenialCode {
  return DENIAL_CODE_SET.has(value);
}

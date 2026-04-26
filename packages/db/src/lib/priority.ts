/**
 * Claim priority scoring — `0..100`, higher = call sooner.
 *
 * Source of truth: PRD §5 "Priority Score Formula". Reproduced here
 * verbatim so the algorithm lives in pure code (testable, no I/O)
 * rather than buried inside the ingestion path.
 *
 *   amountScore = min(claimAmount / 100,  100)
 *   ageScore    = min(daysOutstanding*2,  100)
 *   priority    = round(0.6*amountScore + 0.4*ageScore)
 *
 * The split (60% amount / 40% age) reflects what billers told us:
 * a 90-day-old $200 claim is worth less of their time than a 7-day-
 * old $4000 crown, but a $200 claim that has aged out to 180 days
 * still moves up the queue. Multiplying age by 2 means a claim
 * crosses the 50-day mark before age starts dominating amount —
 * matches the typical payer's 60-day "should-be-paid-by-now" wire
 * window without us hard-coding payer-specific deadlines.
 *
 * P2-T47 ships the pure scorer; the bulk-insert path (T48) calls
 * it on every imported row and writes the result to `Claim.priority`.
 * Phase 3's call worker re-scores on every retry so an aged claim
 * floats to the top of the queue without manual intervention.
 */

export interface ScoreClaimInput {
  /** Decimal claim amount in dollars. Negative or NaN → 0. */
  readonly claimAmount: number;
  /**
   * Whole days since the claim was first submitted (or, if the
   * row was just imported and never submitted, days since the
   * service date). Negative values are clamped to 0.
   */
  readonly daysOutstanding: number;
}

const AMOUNT_DIVISOR = 100;
const AGE_MULTIPLIER = 2;
const MAX_COMPONENT = 100;
const AMOUNT_WEIGHT = 0.6;
const AGE_WEIGHT = 0.4;

function clampNonNegative(value: number): number {
  if (Number.isNaN(value) || value < 0) return 0;
  return value;
}

export function scoreClaim(input: ScoreClaimInput): number {
  const safeAmount = clampNonNegative(input.claimAmount);
  const safeAge = clampNonNegative(input.daysOutstanding);
  const amountScore = Math.min(safeAmount / AMOUNT_DIVISOR, MAX_COMPONENT);
  const ageScore = Math.min(safeAge * AGE_MULTIPLIER, MAX_COMPONENT);
  return Math.round(amountScore * AMOUNT_WEIGHT + ageScore * AGE_WEIGHT);
}

/**
 * Convenience: compute days between an ISO date string (or a Date)
 * and `now` (default = current time). Floors at 0 so a future
 * service date doesn't generate a negative age.
 */
export function daysOutstandingSince(reference: string | Date, now: Date = new Date()): number {
  const ref = reference instanceof Date ? reference : new Date(reference);
  if (Number.isNaN(ref.getTime())) return 0;
  const ms = now.getTime() - ref.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

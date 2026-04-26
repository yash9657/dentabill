import type { ClaimStatus } from '@dentabill/db';

/**
 * Claim state machine.
 *
 * Phase 2 ships the validation layer; the call worker that drives
 * `IN_QUEUE → CALLING → COMPLETED` lands in Phase 3. Until then the
 * UI moves claims by hand and this map is what stops a biller from
 * skipping the queue or reopening a closed claim.
 *
 * Visual reference (each line is "from -> ...allowed to"):
 *
 *   PENDING        -> IN_QUEUE | MANUAL_REVIEW | WRITTEN_OFF
 *   IN_QUEUE       -> CALLING | PENDING | MANUAL_REVIEW
 *   CALLING        -> COMPLETED | FAILED | MANUAL_REVIEW
 *   COMPLETED      -> IN_QUEUE | RESOLVED | DENIED | NEEDS_INFO | APPEALING
 *   DENIED         -> APPEALING | WRITTEN_OFF | MANUAL_REVIEW
 *   NEEDS_INFO     -> IN_QUEUE | MANUAL_REVIEW
 *   APPEALING      -> IN_QUEUE | RESOLVED | DENIED
 *   RESOLVED       -> (terminal)
 *   WRITTEN_OFF    -> (terminal)
 *   FAILED         -> IN_QUEUE | MANUAL_REVIEW
 *   MANUAL_REVIEW  -> IN_QUEUE | RESOLVED | DENIED | WRITTEN_OFF
 *
 * Self-transitions (`PENDING -> PENDING`) are always allowed because
 * a no-op patch (e.g. priority bump that includes status echoed back
 * by the client) shouldn't fail validation.
 */
export const CLAIM_STATE_TRANSITIONS: Readonly<Record<ClaimStatus, ReadonlySet<ClaimStatus>>> = {
  PENDING: new Set(['IN_QUEUE', 'MANUAL_REVIEW', 'WRITTEN_OFF']),
  IN_QUEUE: new Set(['CALLING', 'PENDING', 'MANUAL_REVIEW']),
  CALLING: new Set(['COMPLETED', 'FAILED', 'MANUAL_REVIEW']),
  COMPLETED: new Set(['IN_QUEUE', 'RESOLVED', 'DENIED', 'NEEDS_INFO', 'APPEALING']),
  DENIED: new Set(['APPEALING', 'WRITTEN_OFF', 'MANUAL_REVIEW']),
  NEEDS_INFO: new Set(['IN_QUEUE', 'MANUAL_REVIEW']),
  APPEALING: new Set(['IN_QUEUE', 'RESOLVED', 'DENIED']),
  RESOLVED: new Set([]),
  WRITTEN_OFF: new Set([]),
  FAILED: new Set(['IN_QUEUE', 'MANUAL_REVIEW']),
  MANUAL_REVIEW: new Set(['IN_QUEUE', 'RESOLVED', 'DENIED', 'WRITTEN_OFF']),
};

/**
 * Returns true when the supplied transition is allowed by the state
 * machine. Self-transitions are always allowed so a PATCH that echoes
 * the current status (with other field changes) is not rejected.
 */
export function isValidClaimTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  if (from === to) return true;
  return CLAIM_STATE_TRANSITIONS[from].has(to);
}

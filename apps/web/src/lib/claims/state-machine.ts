import type { ClaimStatus } from './types.js';

/**
 * Client-side mirror of the server's claim state machine
 * (`apps/api/src/lib/claim-state.ts`). The server is the source of
 * truth — a 409 INVALID_STATE_TRANSITION can still come back if the
 * server has moved the claim while the dialog was open — but knowing
 * the rules lets the UI grey out clearly-illegal options instead of
 * letting the user hit submit and get a 409.
 *
 * Self-transitions are intentionally excluded so the dialog only
 * lists *changes*.
 */
const TRANSITIONS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> = {
  PENDING: ['IN_QUEUE', 'MANUAL_REVIEW', 'WRITTEN_OFF'],
  IN_QUEUE: ['CALLING', 'PENDING', 'MANUAL_REVIEW'],
  CALLING: ['COMPLETED', 'FAILED', 'MANUAL_REVIEW'],
  COMPLETED: ['IN_QUEUE', 'RESOLVED', 'DENIED', 'NEEDS_INFO', 'APPEALING'],
  DENIED: ['APPEALING', 'WRITTEN_OFF', 'MANUAL_REVIEW'],
  NEEDS_INFO: ['IN_QUEUE', 'MANUAL_REVIEW'],
  APPEALING: ['IN_QUEUE', 'RESOLVED', 'DENIED'],
  RESOLVED: [],
  WRITTEN_OFF: [],
  FAILED: ['IN_QUEUE', 'MANUAL_REVIEW'],
  MANUAL_REVIEW: ['IN_QUEUE', 'RESOLVED', 'DENIED', 'WRITTEN_OFF'],
};

export function allowedTransitions(from: ClaimStatus): readonly ClaimStatus[] {
  return TRANSITIONS[from];
}

export function isTerminal(status: ClaimStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

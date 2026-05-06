import type { paths } from '@dentabill/api-sdk/types';

/**
 * Wire types for the `/v1/claims` list endpoint, sourced from the
 * generated OpenAPI types (no hand-maintained DTOs per ADR-017).
 *
 * The SDK types are nested deep so we re-export them under the names
 * components actually consume (`Claim`, `ClaimStatus`, `PayerCode`,
 * `ClaimsListQuery`, `ClaimsListResponse`).
 */
type ListResponse = paths['/v1/claims']['get']['responses'][200]['content']['application/json'];

export type Claim = ListResponse['items'][number];
export type ClaimStatus = Claim['status'];
export type PayerCode = Claim['payerCode'];
export type ClaimsListResponse = ListResponse;

export type ClaimsListQuery = NonNullable<paths['/v1/claims']['get']['parameters']['query']>;

/**
 * Subset of {@link ClaimsListQuery} that the dashboard's UI controls
 * actually drive. `cursor` is owned by the pagination loop, not the
 * filter bar, so it isn't part of this type.
 */
export interface ClaimsFilters {
  readonly status?: ClaimStatus;
  readonly payer?: PayerCode;
  readonly search?: string;
}

export const CLAIM_STATUS_OPTIONS = [
  'PENDING',
  'IN_QUEUE',
  'CALLING',
  'COMPLETED',
  'DENIED',
  'NEEDS_INFO',
  'APPEALING',
  'RESOLVED',
  'WRITTEN_OFF',
  'FAILED',
  'MANUAL_REVIEW',
] as const satisfies readonly ClaimStatus[];

export const PAYER_OPTIONS = [
  'DELTA_DENTAL_PPO',
  'DELTA_DENTAL_PREMIER',
  'CIGNA_DENTAL',
  'METLIFE_DENTAL',
  'AETNA_DENTAL',
  'GUARDIAN_DENTAL',
  'UNITED_CONCORDIA',
  'HUMANA_DENTAL',
  'UNKNOWN',
] as const satisfies readonly PayerCode[];

/**
 * Payers the Phase-3 call worker can actually dial. Mirrors
 * `PHASE_3_PAYERS_SET` in `apps/api/src/routes/v1/calls.ts` — keep in
 * sync. The UI uses this to gate the Call-Now affordance: claims for
 * any other payer (including `UNKNOWN` rows from CSVs whose payer
 * column couldn't be canonicalised) get a "Manual review only" badge
 * instead of a clickable button, per the comment in
 * `packages/types/src/api-error.ts` on `UNSUPPORTED_PAYER`.
 */
export const PHASE_3_DIALABLE_PAYERS: ReadonlySet<PayerCode> = new Set<PayerCode>([
  'DELTA_DENTAL_PPO',
  'CIGNA_DENTAL',
  'METLIFE_DENTAL',
]);

const STATUS_LABELS: Readonly<Record<ClaimStatus, string>> = {
  PENDING: 'Pending',
  IN_QUEUE: 'In queue',
  CALLING: 'Calling',
  COMPLETED: 'Completed',
  DENIED: 'Denied',
  NEEDS_INFO: 'Needs info',
  APPEALING: 'Appealing',
  RESOLVED: 'Resolved',
  WRITTEN_OFF: 'Written off',
  FAILED: 'Failed',
  MANUAL_REVIEW: 'Manual review',
};

const PAYER_LABELS: Readonly<Record<PayerCode, string>> = {
  DELTA_DENTAL_PPO: 'Delta Dental PPO',
  DELTA_DENTAL_PREMIER: 'Delta Dental Premier',
  CIGNA_DENTAL: 'Cigna Dental',
  METLIFE_DENTAL: 'MetLife Dental',
  AETNA_DENTAL: 'Aetna Dental',
  GUARDIAN_DENTAL: 'Guardian Dental',
  UNITED_CONCORDIA: 'United Concordia',
  HUMANA_DENTAL: 'Humana Dental',
  UNKNOWN: 'Unknown',
};

export function statusLabel(status: ClaimStatus): string {
  return STATUS_LABELS[status];
}

export function payerLabel(payer: PayerCode): string {
  return PAYER_LABELS[payer];
}

/**
 * The exact set of `<StatusDot>` variants the design system exposes
 * (kept in `packages/ui/src/components/status-dot.tsx`). Re-typed here
 * so the mapping below stays a string-literal union — drift between
 * the two surfaces fails at type-check, not at runtime.
 */
export type StatusIndicatorVariant =
  | 'idle'
  | 'pending'
  | 'active'
  | 'success'
  | 'warning'
  | 'error';

const STATUS_INDICATOR_MAP: Readonly<Record<ClaimStatus, StatusIndicatorVariant>> = {
  // Live — the muted-teal accent + status-pulse animation. ADR-013
  // names this the *one* chromatic surface allowed in the system, and
  // P3-T23 unlocks it for the full live phase of a call (queued →
  // dialing → on-hold) so a user glancing at the dashboard knows
  // *something is happening right now* without reading text.
  IN_QUEUE: 'active',
  CALLING: 'active',
  // Pending — queued in the broad sense; not yet a live action.
  PENDING: 'pending',
  // Terminal-positive — completed/resolved/written-off all settle here.
  // `RESOLVED` is the post-completion confirmation; `WRITTEN_OFF` is a
  // human terminal decision.
  COMPLETED: 'success',
  RESOLVED: 'success',
  WRITTEN_OFF: 'success',
  // Needs-attention — not failing, but waiting on operator input.
  NEEDS_INFO: 'warning',
  APPEALING: 'warning',
  MANUAL_REVIEW: 'warning',
  // Terminal-negative.
  DENIED: 'error',
  FAILED: 'error',
};

/**
 * Maps a `ClaimStatus` onto a `<StatusDot>` variant. Used by the
 * claims table, claim detail card, and (Phase 3) the dashboard
 * overview tiles — keep the mapping centralised so a status's
 * visual identity is truly one decision.
 */
export function statusIndicatorVariant(status: ClaimStatus): StatusIndicatorVariant {
  return STATUS_INDICATOR_MAP[status];
}

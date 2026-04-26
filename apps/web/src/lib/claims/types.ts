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

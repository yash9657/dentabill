import type { paths } from '@dentabill/api-sdk/types';

/**
 * Wire types for the Phase-3 call endpoints, sourced from the
 * generated OpenAPI types (no hand-maintained DTOs per ADR-017).
 */
type EnqueuePath = paths['/v1/claims/{id}/calls']['post'];
type ListPath = paths['/v1/calls']['get'];
type DetailPath = paths['/v1/calls/{id}']['get'];

export type EnqueueCallResponse = EnqueuePath['responses'][202]['content']['application/json'];
export type CallsListResponse = ListPath['responses'][200]['content']['application/json'];
export type CallSummary = CallsListResponse['items'][number];
export type CallStatus = CallSummary['status'];
export type CallDetailResponse = DetailPath['responses'][200]['content']['application/json'];
export type CallEvent = CallDetailResponse['events'][number];

export type CallsListQuery = NonNullable<ListPath['parameters']['query']>;

const STATUS_LABELS: Readonly<Record<CallStatus, string>> = {
  INITIATED: 'Initiated',
  NAVIGATING_IVR: 'Navigating IVR',
  ON_HOLD: 'On hold',
  HUMAN_REACHED: 'Connected',
  COLLECTING: 'Collecting',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  VOICEMAIL: 'Voicemail',
};

export function callStatusLabel(status: CallStatus): string {
  return STATUS_LABELS[status];
}

const LIVE_STATUSES: ReadonlySet<CallStatus> = new Set([
  'INITIATED',
  'NAVIGATING_IVR',
  'ON_HOLD',
  'HUMAN_REACHED',
  'COLLECTING',
]);

export function isLiveCallStatus(status: CallStatus): boolean {
  return LIVE_STATUSES.has(status);
}

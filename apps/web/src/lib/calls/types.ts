import type { paths } from '@dentabill/api-sdk/types';

/**
 * Wire types for the Phase-3 call endpoints, sourced from the
 * generated OpenAPI types (no hand-maintained DTOs per ADR-017).
 */
type EnqueuePath = paths['/v1/claims/{id}/calls']['post'];
type ListPath = paths['/v1/calls']['get'];
type DetailPath = paths['/v1/calls/{id}']['get'];
type StatsPath = paths['/v1/calls/stats']['get'];
type CancelPath = paths['/v1/calls/{id}/cancel']['post'];

export type EnqueueCallResponse = EnqueuePath['responses'][202]['content']['application/json'];
export type CallsListResponse = ListPath['responses'][200]['content']['application/json'];
export type CallSummary = CallsListResponse['items'][number];
export type CallStatus = CallSummary['status'];
export type CallDetailResponse = DetailPath['responses'][200]['content']['application/json'];
export type CallEvent = CallDetailResponse['events'][number];
export type CallsStatsResponse = StatsPath['responses'][200]['content']['application/json'];
export type CancelCallResponse = CancelPath['responses'][200]['content']['application/json'];

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

export function isCallCancellationPending(
  call: Pick<CallSummary, 'status' | 'cancelRequestedAt'>,
): boolean {
  return call.cancelRequestedAt != null && isLiveCallStatus(call.status);
}

export const CALL_STATUS_OPTIONS = [
  'INITIATED',
  'NAVIGATING_IVR',
  'ON_HOLD',
  'HUMAN_REACHED',
  'COLLECTING',
  'COMPLETED',
  'FAILED',
  'VOICEMAIL',
] as const satisfies readonly CallStatus[];

/**
 * Maps a `CallStatus` onto a `<StatusDot>` variant. Mirrors the
 * `statusIndicatorVariant()` policy from `lib/claims/types.ts` so a
 * row's visual identity doesn't depend on which surface renders it.
 */
export type CallStatusIndicatorVariant =
  | 'idle'
  | 'pending'
  | 'active'
  | 'success'
  | 'warning'
  | 'error';

const CALL_INDICATOR_MAP: Readonly<Record<CallStatus, CallStatusIndicatorVariant>> = {
  // Live phase — the muted-teal pulse ADR-013 reserves for real-time
  // signal. INITIATED → COLLECTING all light up.
  INITIATED: 'active',
  NAVIGATING_IVR: 'active',
  ON_HOLD: 'active',
  HUMAN_REACHED: 'active',
  COLLECTING: 'active',
  // Terminal-positive — the call ran to completion (the rep gave us a
  // status, even if it was a denial — that's logged at the claim level).
  COMPLETED: 'success',
  // Terminal-warning — voicemail isn't success but isn't a system
  // failure either; the operator may want to retry.
  VOICEMAIL: 'warning',
  // Terminal-negative — DLQ, hard fail, cancellation.
  FAILED: 'error',
};

export function callStatusIndicatorVariant(status: CallStatus): CallStatusIndicatorVariant {
  return CALL_INDICATOR_MAP[status];
}

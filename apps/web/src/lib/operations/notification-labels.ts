import type { NotificationRow } from './use-notifications.js';

export const notificationStateLabels: Record<NotificationRow['state'], string> = {
  PENDING: 'Pending',
  SENDING: 'Sending',
  SIMULATED: 'Simulated',
  ACCEPTED: 'Provider accepted',
  BLOCKED: 'Blocked',
  QUARANTINED: 'Quarantined',
  SUPPRESSED: 'Suppressed',
};
export const notificationPurposeLabels: Record<NotificationRow['purpose'], string> = {
  REVIEW_AVAILABLE: 'Review available',
  INFERENCE_REVIEW_REQUIRED: 'Inference review required',
};
export const notificationBindingLabels: Record<NotificationRow['recipientBinding'], string> = {
  BOUND: 'Recipient available',
  MISSING: 'Recipient missing',
  CHANGED: 'Recipient changed',
};

// Render only closed diagnostic codes; unexpected strings must never become browser copy.
const knownReasons = new Set([
  'MISSING_RECIPIENT',
  'RECIPIENT_CHANGED',
  'SOURCE_NOT_READY',
  'SOURCE_REVIEWED',
  'SOURCE_SUPERSEDED',
  'SOURCE_CHANGED',
  'DEADLINE_EXPIRED',
  'ATTEMPTS_EXHAUSTED',
  'TRANSPORT_UNKNOWN',
  'TRANSPORT_RETRYABLE',
  'IDEMPOTENCY_CONFLICT',
  'PAYLOAD_INVALID',
  'TRANSPORT_REJECTED',
  'LEASE_EXPIRED',
  'UNKNOWN',
]);
export function notificationReason(code: string | null): string {
  return code === null ? 'None recorded' : knownReasons.has(code) ? code : 'UNKNOWN';
}
export function notificationAge(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 1) return 'Less than a minute';
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${String(hours)} hr`;
  return `${String(Math.floor(hours / 24))} days`;
}

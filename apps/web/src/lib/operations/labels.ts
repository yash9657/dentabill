import type { RecoveryPreview } from './types.js';

export function deliveryStateLabel(state: RecoveryPreview['state']): string {
  return {
    PENDING: 'Awaiting delivery',
    QUARANTINED: 'Needs review',
    DELIVERED: 'Delivery received',
    CLOSED: 'Closed after review',
  }[state];
}
export function deliveryKindLabel(kind: RecoveryPreview['kind']): string {
  return kind === 'CALL_PLACE' ? 'Call request' : 'Call summary';
}
export function recoveryExplanation(preview: RecoveryPreview): string {
  if (preview.state === 'CLOSED')
    return 'Reviewed: no further delivery is needed. Closing did not deliver this request.';
  if (preview.action === 'RETRY')
    return 'Allow three more delivery attempts for this same request. Its call identity and existing progress are preserved.';
  if (preview.action === 'CLOSE')
    return 'The related work is already finished or no longer needed. Close this delivery after review; closing will not send it.';
  const reasons: Record<NonNullable<RecoveryPreview['blockedReason']>, string> = {
    NOT_QUARANTINED: 'Only deliveries held for review can be retried or closed here.',
    DELIVERY_NOT_EXHAUSTED:
      'This request still has delivery attempts available. Wait for its existing delivery schedule.',
    ACTIVE_LEASE: 'A delivery attempt may still be in progress. Refresh after it finishes.',
    PAYLOAD_INVALID: 'This request failed validation. It cannot be retried safely.',
    DOMAIN_BINDING_MISMATCH: 'This request does not match its related work. Keep it in review.',
    CLAIM_CHANGED: 'The claim changed after this request was created. Keep it in review.',
    CLAIM_NOT_QUEUED: 'The claim is no longer queued for this request. Keep it in review.',
    CALL_RECONCILIATION_REQUIRED:
      'A call may already exist. Check the existing call from the claim before taking another action.',
    CALL_OBSERVATION_REQUIRED:
      'This call was accepted. Open the call to check its status; do not create another call.',
    SUMMARY_RETRY_UNSAFE:
      'The summary is missing. Safe summary recovery is not available yet; keep this delivery in review.',
  };
  return preview.blockedReason
    ? reasons[preview.blockedReason]
    : 'No recovery action is available for this delivery.';
}
export function deliveryErrorLabel(code: string | null): string {
  if (!code) return 'None recorded';
  return (
    (
      {
        PAYLOAD_INVALID: 'Request validation failed',
        DELIVERY_EXHAUSTED: 'Delivery attempts exhausted',
        DISPATCH_FAILED: 'Delivery attempt failed',
        DISPATCH_TIMEOUT: 'Delivery acknowledgement timed out',
      } as Record<string, string>
    )[code] ?? 'Unclassified delivery failure'
  );
}
export function operationDate(value: string | null): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date)
    : 'Unavailable';
}

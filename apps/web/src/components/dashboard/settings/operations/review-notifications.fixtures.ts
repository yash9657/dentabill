import type {
  NotificationDetail,
  NotificationList,
  NotificationRow,
} from '../../../../lib/operations/use-notifications.js';

export const notificationInstant = '2026-10-14T18:00:00.000Z';

export function notificationFixture(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: 'notification_synthetic_a',
    purpose: 'REVIEW_AVAILABLE',
    state: 'SIMULATED',
    reason: null,
    recipientBinding: 'BOUND',
    generation: 2,
    templateVersion: 'review-available.v1',
    claimId: 'claim_synthetic_a',
    callId: 'call_synthetic_a',
    inferenceRunId: 'inference_synthetic_a',
    observationId: 'observation_synthetic_a',
    createdAt: '2026-10-14T17:00:00.000Z',
    updatedAt: notificationInstant,
    availableAt: '2026-10-14T17:00:00.000Z',
    ageSeconds: 3600,
    attemptCount: 1,
    firstSubmissionAt: '2026-10-14T17:01:00.000Z',
    retryDeadlineAt: '2026-10-14T17:11:00.000Z',
    leaseExpiresAt: null,
    ambiguous: false,
    ...overrides,
  };
}
export function notificationListFixture(
  items = [notificationFixture()],
  overrides: Partial<NotificationList> = {},
): NotificationList {
  return {
    sampledAt: notificationInstant,
    deliveryMode: 'DISABLED',
    counts: {
      pending: 0,
      sending: 0,
      blocked: 0,
      quarantined: 0,
      simulated: 1,
      accepted: 0,
      suppressed: 0,
      agedPending: 0,
    },
    items,
    nextCursor: null,
    hasMore: false,
    ...overrides,
  };
}
export function notificationDetailFixture(
  notification = notificationFixture(),
  overrides: Partial<NotificationDetail> = {},
): NotificationDetail {
  return {
    sampledAt: notificationInstant,
    deliveryMode: 'DISABLED',
    notification,
    attempts: [
      {
        id: 'attempt_synthetic_a',
        attemptNumber: 1,
        mode: 'SYNTHETIC',
        startedAt: '2026-10-14T17:01:00.000Z',
        leaseExpiresAt: '2026-10-14T17:02:00.000Z',
        receipt: {
          outcome: 'SIMULATED',
          code: null,
          completedAt: notificationInstant,
          acceptedAt: null,
        },
      },
    ],
    ...overrides,
  };
}

import type { paths } from '@dentabill/api-sdk/types';

type AuditLogsPath = paths['/v1/audit-logs']['get'];
export type AuditLogsListResponse = AuditLogsPath['responses'][200]['content']['application/json'];
export type AuditLogEntry = AuditLogsListResponse['items'][number];
export type AuditLogsListQuery = NonNullable<AuditLogsPath['parameters']['query']>;

/**
 * Subset of {@link AuditLogsListQuery} that the dashboard's UI controls
 * actually drive. `cursor` and `limit` are owned by the pagination logic.
 * Fields are explicitly optional (can be undefined) because filter controls
 * use undefined to represent "no filter applied" (vs empty string).
 */
export interface AuditLogsFilters {
  readonly resourceType?: string | undefined;
  readonly from?: string | undefined; // ISO 8601 date
  readonly to?: string | undefined; // ISO 8601 date
}

/**
 * Common audit actions that might appear in the log.
 * Non-exhaustive — the system can log any action string.
 */
export const AUDIT_ACTIONS = [
  'READ_CLAIM',
  'READ_CALL',
  'UPDATE_CLAIM_STATUS',
  'CREATE_CALL',
  'AUTO_TRANSITION',
  'EXPORT_DATA',
] as const;

/**
 * Common resource types that appear in audit logs.
 * Non-exhaustive — the system can log any resource type string.
 */
export const AUDIT_RESOURCE_TYPES = ['Claim', 'Call', 'CallSummary', 'Organization'] as const;

/**
 * Format a timestamp for display in the UI.
 */
export function formatAuditTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

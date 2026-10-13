/**
 * Wire types for the `/v1/audit-logs` list endpoint.
 *
 * The AuditLog Prisma model fields are:
 * - id, organizationId, userId, action, resourceType, resourceId
 * - ipAddress, userAgent, metadata (Json), createdAt
 *
 * The API response follows the cursor-pagination envelope used by
 * `/v1/claims` and `/v1/calls` (see ADR-037). A sibling agent is
 * building the endpoint; these types define the wire contract we assume.
 */

/**
 * A single audit log entry as returned by the API.
 * The `user` field is optional because userId can be NULL (system actions).
 */
export interface AuditLogEntry {
  readonly id: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly userId: string | null;
  readonly user: {
    readonly id: string;
    readonly name: string | null;
    readonly email: string;
  } | null;
  readonly metadata: Record<string, unknown>;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly createdAt: string; // ISO 8601 datetime
}

/**
 * The paginated response envelope for `/v1/audit-logs`.
 * Mirrors the shape of `ClaimsListResponse` and `CallsListResponse`.
 */
export interface AuditLogsListResponse {
  readonly items: readonly AuditLogEntry[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * Query parameters for `/v1/audit-logs`. The backend will support
 * filtering by `resourceType` and date range (`from`/`to`).
 */
export interface AuditLogsListQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly resourceType?: string;
  readonly from?: string; // ISO 8601 date
  readonly to?: string; // ISO 8601 date
}

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
export const AUDIT_RESOURCE_TYPES = ['CLAIM', 'CALL', 'CALL_SUMMARY', 'ORGANIZATION'] as const;

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

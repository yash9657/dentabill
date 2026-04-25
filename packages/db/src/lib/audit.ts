import type { AuditLog, Prisma } from '@prisma/client';

import { prisma } from '../client.js';

import { MissingOrgScopeError } from './errors.js';

/**
 * Input for an audit-log entry. Every PHI-touching read should write one
 * of these via `audit({ action, resourceType, resourceId, organizationId, userId? })`.
 */
export interface AuditInput {
  /** Verb describing what happened. Use a dotted action like `claim.read`. */
  action: string;
  /** PRD §5 model name, e.g. `Claim`, `Call`, `User`. */
  resourceType: string;
  /** Primary key of the row that was read or modified. */
  resourceId: string;
  /** Owning organization. Required — `audit()` throws without it. */
  organizationId: string;
  /** Acting user's id, if available. Null for system actions. */
  userId?: string;
  /** Source IP, if known. */
  ipAddress?: string;
  /** Source user-agent, if known. */
  userAgent?: string;
  /** Free-form structured metadata. PHI-safe (no patient names / DOB / SSN). */
  metadata?: Record<string, unknown>;
}

/**
 * Minimal client surface required by `audit()`. Accepts the singleton
 * `prisma` client, a transaction client, or any object that exposes
 * `auditLog.create`. This keeps the helper composable inside `$transaction`
 * blocks.
 */
interface AuditClient {
  auditLog: { create: (args: { data: Prisma.AuditLogUncheckedCreateInput }) => Promise<AuditLog> };
}

/**
 * Write an `AuditLog` row. Rejects synchronously if `organizationId` is
 * absent; that is the only invariant — every other field is optional.
 *
 * Returns the created audit row so callers can correlate downstream.
 */
export async function audit(input: AuditInput, client: AuditClient = prisma): Promise<AuditLog> {
  if (!input.organizationId) {
    throw new MissingOrgScopeError('audit() requires a non-empty organizationId');
  }
  return client.auditLog.create({
    data: {
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}

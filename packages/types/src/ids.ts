/**
 * Branded ID types for the core entities. Branding prevents accidentally
 * passing a `userId` where an `organizationId` is expected — TypeScript
 * treats them as nominally distinct even though they're both strings at
 * runtime.
 *
 * Construct with the corresponding helper (`asOrgId`, `asUserId`, …) at
 * the boundary where the ID enters the system (route handler, DB result),
 * then carry the branded type inward.
 */

declare const idBrand: unique symbol;

export type Branded<T, K extends string> = T & { readonly [idBrand]: K };

export type OrgId = Branded<string, 'OrgId'>;
export type UserId = Branded<string, 'UserId'>;
export type ClaimId = Branded<string, 'ClaimId'>;
export type CallId = Branded<string, 'CallId'>;
export type CallSummaryId = Branded<string, 'CallSummaryId'>;
export type PayerConfigId = Branded<string, 'PayerConfigId'>;
export type AuditLogId = Branded<string, 'AuditLogId'>;

export const asOrgId = (raw: string): OrgId => raw as OrgId;
export const asUserId = (raw: string): UserId => raw as UserId;
export const asClaimId = (raw: string): ClaimId => raw as ClaimId;
export const asCallId = (raw: string): CallId => raw as CallId;
export const asCallSummaryId = (raw: string): CallSummaryId => raw as CallSummaryId;
export const asPayerConfigId = (raw: string): PayerConfigId => raw as PayerConfigId;
export const asAuditLogId = (raw: string): AuditLogId => raw as AuditLogId;

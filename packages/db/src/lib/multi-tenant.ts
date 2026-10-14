/**
 * Single source of truth for which models carry an `organizationId` column
 * and therefore participate in multi-tenancy enforcement.
 *
 * Both `getOrgScopedDb(orgId)` (read-side, P1-T4A) and the write middleware
 * (P1-T5) read from this list. Adding a new multi-tenant model means
 * exactly one edit here plus the schema change.
 */
export const MULTI_TENANT_MODELS = [
  'user',
  'claim',
  'claimSourceDetails',
  'claimSourceLine',
  'claimSourceCoverage',
  'claimRemittanceEvidence',
  'claimRemittanceReview',
  'claimRemittanceAllocation',
  'claimRemittanceAdjustment',
  'remittanceBatchEvidence',
  'remittanceBatchReview',
  'remittanceBatchClaim',
  'remittanceBatchAdjustment',
  'cashSourceTransaction',
  'cashSourceEvidence',
  'cashSourceReview',
  'cashBatchMatch',
  'cashBatchRelease',
  'postingSourceReceipt',
  'postingSourceEvidence',
  'postingSourceReview',
  'postingSourceEntry',
  'reviewNotificationIntent',
  'reviewNotificationDelivery',
  'reviewNotificationAttempt',
  'reviewNotificationReceipt',
  'call',
  'callIntent',
  'jobOutbox',
  'inferenceBudget',
  'inferenceRun',
  'inferenceAttempt',
  'claimObservation',
  'claimObservationReview',
  'observationRegeneration',
  'callSummary',
  'payerConfig',
  'auditLog',
  'billingUsageRecord',
] as const;

export type MultiTenantModel = (typeof MULTI_TENANT_MODELS)[number];

export function isMultiTenantModel(model: string | undefined): model is MultiTenantModel {
  return typeof model === 'string' && (MULTI_TENANT_MODELS as readonly string[]).includes(model);
}

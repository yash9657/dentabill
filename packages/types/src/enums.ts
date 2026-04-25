/**
 * Shared enum re-exports.
 *
 * After P1-T4 lands `@dentabill/db`, this file re-exports the Prisma-generated
 * enums so frontend code (which cannot depend on Prisma) gets a single
 * source of truth without coupling to the runtime DB client.
 *
 * Until P1-T4, the enum values are mirrored here as `as const` literals
 * matching PRD §5. The mirror is replaced — not augmented — when the
 * Prisma client lands; double-write drift would defeat the purpose.
 */

export const PLAN_VALUES = ['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'] as const;
export type Plan = (typeof PLAN_VALUES)[number];

export const USER_ROLE_VALUES = ['OWNER', 'ADMIN', 'BILLING_STAFF'] as const;
export type UserRole = (typeof USER_ROLE_VALUES)[number];

export const CLAIM_STATUS_VALUES = [
  'PENDING',
  'IN_QUEUE',
  'CALLING',
  'COMPLETED',
  'DENIED',
  'NEEDS_INFO',
  'APPEALING',
  'RESOLVED',
  'WRITTEN_OFF',
  'FAILED',
  'MANUAL_REVIEW',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUS_VALUES)[number];

export const CALL_STATUS_VALUES = [
  'INITIATED',
  'NAVIGATING_IVR',
  'ON_HOLD',
  'HUMAN_REACHED',
  'COLLECTING',
  'COMPLETED',
  'FAILED',
  'VOICEMAIL',
] as const;
export type CallStatus = (typeof CALL_STATUS_VALUES)[number];

export const PAYER_CODE_VALUES = [
  'DELTA_DENTAL_PPO',
  'DELTA_DENTAL_PREMIER',
  'CIGNA_DENTAL',
  'METLIFE_DENTAL',
  'AETNA_DENTAL',
  'GUARDIAN_DENTAL',
  'UNITED_CONCORDIA',
  'HUMANA_DENTAL',
  'UNKNOWN',
] as const;
export type PayerCode = (typeof PAYER_CODE_VALUES)[number];

export const NEXT_ACTION_VALUES = [
  'RESUBMIT',
  'APPEAL',
  'SUBMIT_DOCS',
  'CALL_BACK',
  'WRITE_OFF',
  'RESOLVED',
  'MANUAL_REVIEW',
] as const;
export type NextAction = (typeof NEXT_ACTION_VALUES)[number];

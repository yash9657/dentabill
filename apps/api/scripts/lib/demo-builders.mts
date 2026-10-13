#!/usr/bin/env tsx
/**
 * Deterministic pseudo-random builders for demo data.
 *
 * All builders use a seeded PRNG (Mulberry32) so reseeding produces
 * identical data. This ensures demo runs are reproducible and consistent
 * across environments.
 *
 * These are intentionally NOT exported from @dentabill/db — they are
 * scripts-local and should remain opaque to the main application.
 */

// `@prisma/client` is deliberately NOT imported here: apps/api depends on
// @dentabill/db, not on Prisma directly, so under pnpm's strict resolution a
// bare `@prisma/client` import is unresolvable at runtime. Prisma.Decimal is
// reached through the workspace package instead, per the cross-package import
// rule in CLAUDE.md.
import { cuid, hashPatientDOB, Prisma } from '@dentabill/db';
import type {
  Claim,
  Call,
  CallEvent,
  CallSummary,
  Organization,
  PayerConfig,
  User,
  BillingUsageRecord,
} from '@dentabill/db';

/**
 * Mulberry32 — a fast, deterministic PRNG seeded with a fixed value.
 * Returns a value in [0, 1).
 */
function mulberry32(a: number): () => number {
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    const t = Math.imul(a ^ (a >>> 15), 1 | a);
    return ((t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0) / 4294967296;
  };
}

// Fixed seed so reseeds are reproducible
const SEED = 12345;
const rng = mulberry32(SEED);

/** Pseudo-random integer in [min, max) */
function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min)) + min;
}

/** Pseudo-random choice from an array */
function choice<T>(arr: T[]): T {
  return arr[randInt(0, arr.length)];
}

// ─── Synthetic data pools ─────────────────────────────────────────────

const FIRST_NAMES = [
  'James', 'Sarah', 'Michael', 'Jennifer', 'David', 'Maria', 'Robert', 'Lisa',
  'William', 'Karen', 'Richard', 'Nancy', 'John', 'Susan', 'Charles', 'Patricia',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson',
  'Moore', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin',
];

const CDT_CODES = ['D2391', 'D2392', 'D2394', 'D1110', 'D1120', 'D5110', 'D5120'];

const DENIAL_CODES = ['CO-50', 'CO-29', 'CO-96', 'CO-97', 'CO-109', 'N362', 'N522'];

// ─── Builders ─────────────────────────────────────────────────────────

interface OrganizationData
  extends Omit<Organization, 'id' | 'createdAt' | 'updatedAt' | 'settings' | 'featureFlags'> {
  clerkOrgId: string;
  name: string;
  npi: string;
}

export function buildOrganization(overrides?: Partial<OrganizationData>): OrganizationData {
  return {
    clerkOrgId: `clerk_demo_${Math.random().toString(36).slice(2)}`,
    name: 'Bright Smile Dental',
    npi: '9999999999',
    plan: 'TRIAL',
    callsUsed: 0,
    summaryTokensUsed: 0,
    ...overrides,
  };
}

interface UserData extends Omit<User, 'id' | 'createdAt'> {
  clerkUserId: string;
  organizationId: string;
  email: string;
  name: string | null;
}

export function buildUser(
  organizationId: string,
  overrides?: Partial<UserData>,
): UserData {
  return {
    clerkUserId: `user_demo_${Math.random().toString(36).slice(2)}`,
    organizationId,
    role: 'OWNER',
    email: 'demo@brightsmile.local',
    name: 'Demo User',
    ...overrides,
  };
}

interface PayerConfigData extends Omit<PayerConfig, 'id'> {
  organizationId: string;
  payerCode: 'DELTA_DENTAL_PPO' | 'CIGNA_DENTAL' | 'METLIFE_DENTAL';
}

export function buildPayerConfig(
  organizationId: string,
  payerCode: 'DELTA_DENTAL_PPO' | 'CIGNA_DENTAL' | 'METLIFE_DENTAL',
  overrides?: Partial<PayerConfigData>,
): PayerConfigData {
  return {
    organizationId,
    payerCode,
    enabled: true,
    providerNpi: '9999999999',
    groupNumber: undefined,
    ...overrides,
  };
}

interface ClaimData extends Omit<Claim, 'id' | 'createdAt' | 'updatedAt'> {
  organizationId: string;
  patientDOBHash: string;
  claimNumber: string;
  cdtCodes: string[];
  claimAmount: Prisma.Decimal;
  payerCode: 'DELTA_DENTAL_PPO' | 'CIGNA_DENTAL' | 'METLIFE_DENTAL';
  serviceDate: Date;
  status: string;
}

/**
 * Build a claim with deterministic but realistic data.
 * HASH_SECRET is a dummy value for demo purposes.
 */
export function buildClaim(
  organizationId: string,
  overrides?: Partial<ClaimData>,
): ClaimData {
  const patientDOB = `198${randInt(0, 10)}-${String(randInt(1, 13)).padStart(2, '0')}-${String(randInt(1, 29)).padStart(2, '0')}`;
  const patientDOBHash = hashPatientDOB({
    dob: patientDOB,
    organizationId,
    secret: 'demo-seed-secret',
  });

  const serviceDate = new Date();
  serviceDate.setDate(serviceDate.getDate() - randInt(1, 30));
  const submittedDate = new Date(serviceDate);
  submittedDate.setDate(submittedDate.getDate() + randInt(1, 5));

  return {
    organizationId,
    patientDOBHash,
    patientDOBLast4: patientDOB.slice(0, 4),
    claimNumber: `CLM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    cdtCodes: [choice(CDT_CODES)],
    // Dollars, not cents: a real dental claim runs $150–$2000. Dividing by 100
    // here produced $1.50–$20.00 claims, which made the recovered-value KPI
    // read as loose change.
    claimAmount: new Prisma.Decimal(`${String(randInt(150, 2000))}.${String(randInt(0, 100)).padStart(2, '0')}`),
    payerCode: choice(['DELTA_DENTAL_PPO', 'CIGNA_DENTAL', 'METLIFE_DENTAL']),
    serviceDate,
    submittedDate,
    status: 'PENDING',
    priority: randInt(20, 90),
    lastCallAt: null,
    nextCallAt: null,
    retryCount: 0,
    maxRetries: 3,
    subscriberId: `SUB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    ...overrides,
  };
}

interface CallData extends Omit<Call, 'id' | 'createdAt'> {
  organizationId: string;
  claimId: string;
  retellCallId: string;
  status: string;
}

/**
 * Build a completed call with realistic timing.
 * Duration is 3-11 minutes (realistic for insurance calls).
 */
export function buildCall(
  organizationId: string,
  claimId: string,
  overrides?: Partial<CallData>,
): CallData {
  const durationSeconds = randInt(180, 660); // 3-11 minutes
  const startedAt = new Date();
  startedAt.setHours(startedAt.getHours() - randInt(0, 24));
  const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);

  return {
    organizationId,
    claimId,
    retellCallId: `retell_${Math.random().toString(36).slice(2)}`,
    retellAgentId: `agent_demo_${Math.random().toString(36).slice(2)}`,
    status: 'COMPLETED',
    ivrNavigated: true,
    humanReached: true,
    holdTimeSeconds: randInt(30, 300),
    startedAt,
    endedAt,
    durationSeconds,
    audioQualityScore: 0.85 + rng() * 0.15,
    callCostCents: randInt(50, 200),
    attemptNumber: 1,
    dlqReason: null,
    cancelRequestedAt: null,
    cancelRequestedBy: null,
    ...overrides,
  };
}

interface CallEventData extends Omit<CallEvent, 'id'> {
  callId: string;
  eventType: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Build a call event (part of the transcript).
 */
export function buildCallEvent(
  callId: string,
  eventType: string,
  data: Record<string, unknown> = {},
  timestamp: Date = new Date(),
): CallEventData {
  return {
    callId,
    eventType,
    data,
    timestamp,
  };
}

interface CallSummaryData extends Omit<CallSummary, 'id' | 'createdAt'> {
  organizationId: string;
  callId: string;
  claimStatus: string;
  nextAction: string;
}

/**
 * Build a call summary with synthetic rep dialogue.
 */
export function buildCallSummary(
  organizationId: string,
  callId: string,
  overrides?: Partial<CallSummaryData>,
): CallSummaryData {
  const hasApproval = rng() > 0.6;
  const isDenied = rng() > 0.8 && !hasApproval;

  return {
    organizationId,
    callId,
    claimStatus: isDenied ? 'DENIED' : 'APPROVED',
    denialReason: isDenied ? choice(['Coverage exclusion', 'Frequency limit', 'Missing info']) : null,
    denialCode: isDenied ? choice(DENIAL_CODES) : null,
    nextAction: isDenied ? 'APPEAL' : hasApproval ? 'RESOLVED' : 'SUBMIT_DOCS',
    confidence: 0.72 + rng() * 0.25,
    repName: `${choice(FIRST_NAMES)} ${choice(LAST_NAMES)}`,
    referenceNumber: `REF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    callbackDate: rng() > 0.8 ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null,
    amountApproved: hasApproval
      ? new Prisma.Decimal(`${String(randInt(120, 1800))}.${String(randInt(0, 100)).padStart(2, '0')}`)
      : null,
    notes: 'Synthetic demo call summary for testing.',
    rawTranscript: generateFakeTranscript(),
    claudeSummary: 'This is a synthetically generated call summary for demo purposes.',
    ...overrides,
  };
}

/**
 * Generate a realistic-looking (but synthetic) insurance call transcript.
 */
function generateFakeTranscript(): string {
  const repName = `${choice(FIRST_NAMES)} ${choice(LAST_NAMES)}`;
  const claimNum = `CLM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return `
[IVR]: Welcome to Dental Insurance. Please enter your claim number.
[Patient]: (DTMF tones)
[IVR]: Thank you. Transferring to an agent.
[Agent]: Hi, this is ${repName} from Dental Insurance. I found your claim ${claimNum}.
What information do you need?
[Patient]: Can you check the status and tell me when we can expect payment?
[Agent]: Sure. Let me pull up the details. I see this claim was submitted 15 days ago.
We're still reviewing it. I estimate we'll have a decision within the next 5-7 business days.
[Patient]: What about the claim amount?
[Agent]: The claim was for $420. We're evaluating coverage under your plan. I'll note your request
and call you back once we have a decision. Is this still the best number to reach you?
[Patient]: Yes, this is good.
[Agent]: Perfect. Thanks for calling. Goodbye.
  `.trim();
}

interface BillingUsageRecordData extends Omit<BillingUsageRecord, 'id' | 'createdAt'> {
  organizationId: string;
  claimId: string;
  billingPeriodStart: Date;
  amountCents: number;
  idempotencyKey: string;
}

/**
 * Build a billing usage record for metered billing.
 */
export function buildBillingUsageRecord(
  organizationId: string,
  claimId: string,
  overrides?: Partial<BillingUsageRecordData>,
): BillingUsageRecordData {
  const billingPeriodStart = new Date();
  billingPeriodStart.setDate(1);
  billingPeriodStart.setHours(0, 0, 0, 0);

  return {
    organizationId,
    claimId,
    stripeUsageRecordId: null,
    billingPeriodStart,
    amountCents: randInt(10000, 50000),
    idempotencyKey: `claim.${claimId}.${billingPeriodStart.toISOString().slice(0, 10)}`,
    postedAt: null,
    ...overrides,
  };
}

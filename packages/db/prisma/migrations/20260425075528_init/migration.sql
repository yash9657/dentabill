-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('TRIAL', 'STARTER', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'BILLING_STAFF');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'IN_QUEUE', 'CALLING', 'COMPLETED', 'DENIED', 'NEEDS_INFO', 'APPEALING', 'RESOLVED', 'WRITTEN_OFF', 'FAILED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('INITIATED', 'NAVIGATING_IVR', 'ON_HOLD', 'HUMAN_REACHED', 'COLLECTING', 'COMPLETED', 'FAILED', 'VOICEMAIL');

-- CreateEnum
CREATE TYPE "PayerCode" AS ENUM ('DELTA_DENTAL_PPO', 'DELTA_DENTAL_PREMIER', 'CIGNA_DENTAL', 'METLIFE_DENTAL', 'AETNA_DENTAL', 'GUARDIAN_DENTAL', 'UNITED_CONCORDIA', 'HUMANA_DENTAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "NextAction" AS ENUM ('RESUBMIT', 'APPEAL', 'SUBMIT_DOCS', 'CALL_BACK', 'WRITE_OFF', 'RESOLVED', 'MANUAL_REVIEW');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "clerkOrgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "npi" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'TRIAL',
    "callsUsed" INTEGER NOT NULL DEFAULT 0,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'BILLING_STAFF',
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientDOBHash" TEXT NOT NULL,
    "patientDOBLast4" TEXT,
    "claimNumber" TEXT NOT NULL,
    "cdtCodes" TEXT[],
    "claimAmount" DECIMAL(10,2) NOT NULL,
    "payerCode" "PayerCode" NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "submittedDate" TIMESTAMP(3),
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "lastCallAt" TIMESTAMP(3),
    "nextCallAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "retellCallId" TEXT NOT NULL,
    "retellAgentId" TEXT,
    "status" "CallStatus" NOT NULL DEFAULT 'INITIATED',
    "ivrNavigated" BOOLEAN NOT NULL DEFAULT false,
    "humanReached" BOOLEAN NOT NULL DEFAULT false,
    "holdTimeSeconds" INTEGER,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "audioQualityScore" DOUBLE PRECISION,
    "callCostCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSummary" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "claimStatus" TEXT NOT NULL,
    "denialReason" TEXT,
    "denialCode" TEXT,
    "nextAction" "NextAction" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "repName" TEXT,
    "referenceNumber" TEXT,
    "callbackDate" TIMESTAMP(3),
    "amountApproved" DECIMAL(10,2),
    "notes" TEXT,
    "rawTranscript" TEXT NOT NULL,
    "claudeSummary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallEvent" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayerConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "payerCode" "PayerCode" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "providerNpi" TEXT,
    "groupNumber" TEXT,

    CONSTRAINT "PayerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_clerkOrgId_key" ON "Organization"("clerkOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "Claim_organizationId_status_idx" ON "Claim"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Claim_organizationId_priority_idx" ON "Claim"("organizationId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "Call_retellCallId_key" ON "Call"("retellCallId");

-- CreateIndex
CREATE INDEX "Call_organizationId_idx" ON "Call"("organizationId");

-- CreateIndex
CREATE INDEX "Call_claimId_idx" ON "Call"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "CallSummary_callId_key" ON "CallSummary"("callId");

-- CreateIndex
CREATE INDEX "CallEvent_callId_idx" ON "CallEvent"("callId");

-- CreateIndex
CREATE UNIQUE INDEX "PayerConfig_organizationId_payerCode_key" ON "PayerConfig"("organizationId", "payerCode");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSummary" ADD CONSTRAINT "CallSummary_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallEvent" ADD CONSTRAINT "CallEvent_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerConfig" ADD CONSTRAINT "PayerConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

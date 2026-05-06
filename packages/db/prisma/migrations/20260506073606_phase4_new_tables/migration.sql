-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "cancelRequestedBy" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "featureFlags" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "summaryTokensResetAt" TIMESTAMP(3),
ADD COLUMN     "summaryTokensUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BillingUsageRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "stripeUsageRecordId" TEXT,
    "billingPeriodStart" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingUsageRecord_idempotencyKey_key" ON "BillingUsageRecord"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BillingUsageRecord_organizationId_billingPeriodStart_idx" ON "BillingUsageRecord"("organizationId", "billingPeriodStart");

-- CreateIndex
CREATE UNIQUE INDEX "BillingUsageRecord_claimId_billingPeriodStart_key" ON "BillingUsageRecord"("claimId", "billingPeriodStart");

-- CreateIndex
CREATE INDEX "CallEvent_callId_timestamp_idx" ON "CallEvent"("callId", "timestamp");

-- AddForeignKey
ALTER TABLE "BillingUsageRecord" ADD CONSTRAINT "BillingUsageRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "CallIntentState" AS ENUM ('READY', 'SUBMITTING', 'UNKNOWN', 'ACCEPTED', 'TERMINAL', 'CANCELLED');

-- CreateTable
CREATE TABLE "CallIntent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payerCode" "PayerCode" NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "claimPriority" INTEGER NOT NULL,
    "claimVersion" TIMESTAMP(3) NOT NULL,
    "state" "CallIntentState" NOT NULL DEFAULT 'READY',
    "requestPayload" JSONB,
    "requestHash" TEXT,
    "callId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallIntent_callId_key" ON "CallIntent"("callId");

-- CreateIndex
CREATE INDEX "CallIntent_organizationId_claimId_createdAt_idx" ON "CallIntent"("organizationId", "claimId", "createdAt");

-- CreateIndex
CREATE INDEX "CallIntent_organizationId_state_updatedAt_idx" ON "CallIntent"("organizationId", "state", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CallIntent_organizationId_idempotencyKey_key" ON "CallIntent"("organizationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "CallIntent" ADD CONSTRAINT "CallIntent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallIntent" ADD CONSTRAINT "CallIntent_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallIntent" ADD CONSTRAINT "CallIntent_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An unresolved external outcome keeps ownership, even after a local timeout.
CREATE UNIQUE INDEX "CallIntent_active_claim_key"
  ON "CallIntent" ("organizationId", "claimId")
  WHERE "state" IN ('READY', 'SUBMITTING', 'UNKNOWN', 'ACCEPTED');

ALTER TABLE "CallIntent" ADD CONSTRAINT "CallIntent_attempt_bounds"
  CHECK ("attemptNumber" BETWEEN 1 AND 2 AND "claimPriority" BETWEEN 0 AND 100);

-- CreateEnum
CREATE TYPE "CallDLQReason" AS ENUM ('EXCEEDED_MAX_ATTEMPTS', 'EXCEEDED_MAX_DURATION', 'EXCEEDED_MAX_HOLD', 'CANCELLED_BY_OPERATOR');

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "attemptNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "dlqReason" "CallDLQReason";

-- CreateIndex
CREATE INDEX "Call_organizationId_claimId_status_idx" ON "Call"("organizationId", "claimId", "status");

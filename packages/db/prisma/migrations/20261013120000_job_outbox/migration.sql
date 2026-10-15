-- CreateEnum
CREATE TYPE "JobOutboxKind" AS ENUM ('CALL_PLACE', 'SUMMARY_GENERATE');

-- CreateEnum
CREATE TYPE "JobOutboxState" AS ENUM ('PENDING', 'DELIVERED', 'QUARANTINED');

-- CreateTable
CREATE TABLE "JobOutbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "JobOutboxKind" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "state" "JobOutboxState" NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "deliveredAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobOutbox_organizationId_state_availableAt_idx" ON "JobOutbox"("organizationId", "state", "availableAt");

-- CreateIndex
CREATE INDEX "JobOutbox_state_availableAt_leaseExpiresAt_idx" ON "JobOutbox"("state", "availableAt", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobOutbox_organizationId_kind_idempotencyKey_key" ON "JobOutbox"("organizationId", "kind", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "JobOutbox" ADD CONSTRAINT "JobOutbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


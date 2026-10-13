ALTER TABLE "CallIntent"
  ADD COLUMN "reconciledAt" TIMESTAMP(3),
  ADD COLUMN "reconcileOutcome" TEXT,
  ADD COLUMN "reconcileAvailableAt" TIMESTAMP(3),
  ADD COLUMN "reconcileLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "reconcileLeaseToken" TEXT,
  ADD COLUMN "reconcileAttempts" INTEGER NOT NULL DEFAULT 0;

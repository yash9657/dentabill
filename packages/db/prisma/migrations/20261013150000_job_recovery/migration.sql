ALTER TYPE "JobOutboxState" ADD VALUE 'CLOSED';
ALTER TABLE "JobOutbox"
  ADD COLUMN "deliveryAttemptLimit" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "recoveryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "JobOutbox"
  ADD CONSTRAINT "JobOutbox_deliveryAttemptLimit_check" CHECK ("deliveryAttemptLimit" >= 10),
  ADD CONSTRAINT "JobOutbox_recoveryCount_check" CHECK ("recoveryCount" >= 0);

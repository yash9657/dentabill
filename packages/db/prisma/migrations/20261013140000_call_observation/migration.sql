ALTER TABLE "CallIntent"
  ADD COLUMN "callDeadlineAt" TIMESTAMP(3),
  ADD COLUMN "nextObservationAt" TIMESTAMP(3),
  ADD COLUMN "observationLeaseToken" TEXT,
  ADD COLUMN "observationLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "observationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastObservedAt" TIMESTAMP(3),
  ADD COLUMN "observationErrorCode" TEXT,
  ADD COLUMN "observationReviewAt" TIMESTAMP(3),
  ADD COLUMN "stopRequestedAt" TIMESTAMP(3),
  ADD COLUMN "stopReason" TEXT,
  ADD COLUMN "stopAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "stopLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "stopAcknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "stopConfirmationDeadlineAt" TIMESTAMP(3);

CREATE INDEX "CallIntent_state_nextObservationAt_observationLeaseExpiresAt_idx"
  ON "CallIntent"("state", "nextObservationAt", "observationLeaseExpiresAt");

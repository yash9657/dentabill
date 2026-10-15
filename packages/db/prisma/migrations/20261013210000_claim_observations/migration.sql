-- CreateEnum
CREATE TYPE "ObservationDataClass" AS ENUM ('SYNTHETIC', 'PROTECTED');

-- CreateEnum
CREATE TYPE "ObservationReviewDecision" AS ENUM ('ACKNOWLEDGED', 'DISMISSED');

-- CreateTable
CREATE TABLE "ClaimObservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "inferenceRunId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "claimVersion" TIMESTAMP(3) NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "previousObservationId" TEXT,
    "supersedesObservationId" TEXT,
    "sourceHash" VARCHAR(64) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "releaseId" TEXT NOT NULL,
    "provider" "InferenceProvider" NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "taskVersion" TEXT NOT NULL,
    "dataClass" "ObservationDataClass" NOT NULL,
    "output" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimObservationReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "reviewedByRole" "UserRole" NOT NULL,
    "decision" "ObservationReviewDecision" NOT NULL,
    "note" VARCHAR(1000),
    "observationDigest" VARCHAR(64) NOT NULL,
    "claimVersion" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimObservationReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaimObservation_inferenceRunId_key" ON "ClaimObservation"("inferenceRunId");

-- CreateIndex
CREATE INDEX "ClaimObservation_organizationId_claimId_createdAt_idx" ON "ClaimObservation"("organizationId", "claimId", "createdAt");

-- CreateIndex
CREATE INDEX "ClaimObservation_organizationId_callId_idx" ON "ClaimObservation"("organizationId", "callId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimObservation_id_claimId_organizationId_key" ON "ClaimObservation"("id", "claimId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimObservation_organizationId_claimId_version_key" ON "ClaimObservation"("organizationId", "claimId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimObservation_inferenceRunId_claimId_callId_organization_key" ON "ClaimObservation"("inferenceRunId", "claimId", "callId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimObservationReview_observationId_key" ON "ClaimObservationReview"("observationId");

-- CreateIndex
CREATE INDEX "ClaimObservationReview_organizationId_claimId_reviewedAt_idx" ON "ClaimObservationReview"("organizationId", "claimId", "reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimObservationReview_observationId_claimId_organizationId_key" ON "ClaimObservationReview"("observationId", "claimId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InferenceRun_id_claimId_callId_organizationId_key" ON "InferenceRun"("id", "claimId", "callId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "User_id_organizationId_key" ON "User"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "ClaimObservation" ADD CONSTRAINT "ClaimObservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimObservation" ADD CONSTRAINT "ClaimObservation_claimId_organizationId_fkey" FOREIGN KEY ("claimId", "organizationId") REFERENCES "Claim"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimObservation" ADD CONSTRAINT "ClaimObservation_callId_claimId_organizationId_fkey" FOREIGN KEY ("callId", "claimId", "organizationId") REFERENCES "Call"("id", "claimId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimObservation" ADD CONSTRAINT "ClaimObservation_inferenceRunId_claimId_callId_organizatio_fkey" FOREIGN KEY ("inferenceRunId", "claimId", "callId", "organizationId") REFERENCES "InferenceRun"("id", "claimId", "callId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimObservation" ADD CONSTRAINT "ClaimObservation_previousObservationId_claimId_organizatio_fkey" FOREIGN KEY ("previousObservationId", "claimId", "organizationId") REFERENCES "ClaimObservation"("id", "claimId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimObservation" ADD CONSTRAINT "ClaimObservation_supersedesObservationId_claimId_organizat_fkey" FOREIGN KEY ("supersedesObservationId", "claimId", "organizationId") REFERENCES "ClaimObservation"("id", "claimId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimObservationReview" ADD CONSTRAINT "ClaimObservationReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimObservationReview" ADD CONSTRAINT "ClaimObservationReview_observationId_claimId_organizationI_fkey" FOREIGN KEY ("observationId", "claimId", "organizationId") REFERENCES "ClaimObservation"("id", "claimId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimObservationReview" ADD CONSTRAINT "ClaimObservationReview_reviewedByUserId_organizationId_fkey" FOREIGN KEY ("reviewedByUserId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "CallIntent_state_nextObservationAt_observationLeaseExpiresAt_id" RENAME TO "CallIntent_state_nextObservationAt_observationLeaseExpiresA_idx";


ALTER TABLE "ClaimObservation" ADD CONSTRAINT "ClaimObservation_version_check" CHECK ("version" > 0);
ALTER TABLE "ClaimObservation" ADD CONSTRAINT "ClaimObservation_provider_check" CHECK ("provider" = 'FIREWORKS');
ALTER TABLE "ClaimObservation" ADD CONSTRAINT "ClaimObservation_hashes_check" CHECK
  ("digest" ~ '^[a-f0-9]{64}$' AND "sourceHash" ~ '^[a-f0-9]{64}$' AND "requestHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "ClaimObservationReview" ADD CONSTRAINT "ClaimObservationReview_digest_check" CHECK ("observationDigest" ~ '^[a-f0-9]{64}$');
ALTER TABLE "ClaimObservationReview" ADD CONSTRAINT "ClaimObservationReview_note_check" CHECK
  ("decision" <> 'DISMISSED' OR ("note" IS NOT NULL AND length(btrim("note")) > 0));
CREATE FUNCTION dentabill_claim_observation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CLAIM_OBSERVATION_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER claim_observation_immutable BEFORE UPDATE OR DELETE ON "ClaimObservation"
  FOR EACH ROW EXECUTE FUNCTION dentabill_claim_observation_immutable();
CREATE TRIGGER claim_observation_review_immutable BEFORE UPDATE OR DELETE ON "ClaimObservationReview"
  FOR EACH ROW EXECUTE FUNCTION dentabill_claim_observation_immutable();

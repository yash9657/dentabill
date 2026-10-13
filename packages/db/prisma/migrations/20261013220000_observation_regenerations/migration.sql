-- AlterTable
ALTER TABLE "InferenceRun" ADD COLUMN     "regenerationId" TEXT;

-- CreateTable
CREATE TABLE "ObservationRegeneration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "previousObservationId" TEXT NOT NULL,
    "previousObservationDigest" VARCHAR(64) NOT NULL,
    "previousRunId" TEXT NOT NULL,
    "previousGeneration" INTEGER NOT NULL,
    "generation" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdByRole" "UserRole" NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "claimVersion" TIMESTAMP(3) NOT NULL,
    "requestPayload" JSONB NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "sourceHash" VARCHAR(64) NOT NULL,
    "releaseId" TEXT NOT NULL,
    "releasePolicyHash" VARCHAR(64) NOT NULL,
    "implementationArtifactSha256" VARCHAR(64) NOT NULL,
    "previewDigest" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObservationRegeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ObservationRegeneration_organizationId_claimId_createdAt_idx" ON "ObservationRegeneration"("organizationId", "claimId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ObservationRegeneration_id_claimId_callId_organizationId_ge_key" ON "ObservationRegeneration"("id", "claimId", "callId", "organizationId", "generation");

-- CreateIndex
CREATE UNIQUE INDEX "ObservationRegeneration_organizationId_callId_generation_key" ON "ObservationRegeneration"("organizationId", "callId", "generation");

-- CreateIndex
CREATE UNIQUE INDEX "ObservationRegeneration_organizationId_idempotencyKey_key" ON "ObservationRegeneration"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimObservation_id_claimId_callId_organizationId_key" ON "ClaimObservation"("id", "claimId", "callId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InferenceRun_regenerationId_key" ON "InferenceRun"("regenerationId");

-- CreateIndex
CREATE UNIQUE INDEX "InferenceRun_id_claimId_callId_organizationId_generation_key" ON "InferenceRun"("id", "claimId", "callId", "organizationId", "generation");

-- CreateIndex
CREATE UNIQUE INDEX "InferenceRun_regenerationId_claimId_callId_organizationId_g_key" ON "InferenceRun"("regenerationId", "claimId", "callId", "organizationId", "generation");

-- AddForeignKey
ALTER TABLE "InferenceRun" ADD CONSTRAINT "InferenceRun_regenerationId_claimId_callId_organizationId__fkey" FOREIGN KEY ("regenerationId", "claimId", "callId", "organizationId", "generation") REFERENCES "ObservationRegeneration"("id", "claimId", "callId", "organizationId", "generation") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservationRegeneration" ADD CONSTRAINT "ObservationRegeneration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservationRegeneration" ADD CONSTRAINT "ObservationRegeneration_claimId_organizationId_fkey" FOREIGN KEY ("claimId", "organizationId") REFERENCES "Claim"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservationRegeneration" ADD CONSTRAINT "ObservationRegeneration_callId_claimId_organizationId_fkey" FOREIGN KEY ("callId", "claimId", "organizationId") REFERENCES "Call"("id", "claimId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservationRegeneration" ADD CONSTRAINT "ObservationRegeneration_previousObservationId_claimId_call_fkey" FOREIGN KEY ("previousObservationId", "claimId", "callId", "organizationId") REFERENCES "ClaimObservation"("id", "claimId", "callId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservationRegeneration" ADD CONSTRAINT "ObservationRegeneration_previousRunId_claimId_callId_organ_fkey" FOREIGN KEY ("previousRunId", "claimId", "callId", "organizationId", "previousGeneration") REFERENCES "InferenceRun"("id", "claimId", "callId", "organizationId", "generation") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservationRegeneration" ADD CONSTRAINT "ObservationRegeneration_createdByUserId_organizationId_fkey" FOREIGN KEY ("createdByUserId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "InferenceRun" DROP CONSTRAINT "InferenceRun_generation_check";
ALTER TABLE "InferenceRun" ADD CONSTRAINT "InferenceRun_generation_check" CHECK
  (("generation" = 1 AND "regenerationId" IS NULL) OR
   ("generation" > 1 AND "regenerationId" IS NOT NULL AND "provider" = 'FIREWORKS'));
ALTER TABLE "ObservationRegeneration" ADD CONSTRAINT "ObservationRegeneration_generation_check" CHECK
  ("previousGeneration" >= 1 AND "generation" > "previousGeneration");
ALTER TABLE "ObservationRegeneration" ADD CONSTRAINT "ObservationRegeneration_role_check" CHECK
  ("createdByRole" IN ('OWNER', 'ADMIN'));
ALTER TABLE "ObservationRegeneration" ADD CONSTRAINT "ObservationRegeneration_reason_check" CHECK
  (length(btrim("reason")) BETWEEN 1 AND 1000);
ALTER TABLE "ObservationRegeneration" ADD CONSTRAINT "ObservationRegeneration_expiry_check" CHECK
  ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '15 minutes');
ALTER TABLE "ObservationRegeneration" ADD CONSTRAINT "ObservationRegeneration_hashes_check" CHECK
  ("previousObservationDigest" ~ '^[a-f0-9]{64}$' AND "requestHash" ~ '^[a-f0-9]{64}$'
   AND "sourceHash" ~ '^[a-f0-9]{64}$' AND "releasePolicyHash" ~ '^[a-f0-9]{64}$'
   AND "implementationArtifactSha256" ~ '^[a-f0-9]{64}$' AND "previewDigest" ~ '^[a-f0-9]{64}$');
CREATE TRIGGER observation_regeneration_immutable BEFORE UPDATE OR DELETE ON "ObservationRegeneration"
  FOR EACH ROW EXECUTE FUNCTION dentabill_claim_observation_immutable();
CREATE OR REPLACE FUNCTION dentabill_inference_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."organizationId", NEW."callId", NEW."claimId", NEW."generation", NEW."claimVersion",
         NEW."sourceHash", NEW."requestHash", NEW."provider", NEW."releaseId", NEW."promptVersion",
         NEW."billingDay", NEW."tokenAllowance", NEW."requestPayload", NEW."maxAttempts",
         NEW."executionDeadlineAt", NEW."releasePolicyHash", NEW."wireRequestHash", NEW."regenerationId")
     IS DISTINCT FROM
     ROW(OLD."organizationId", OLD."callId", OLD."claimId", OLD."generation", OLD."claimVersion",
         OLD."sourceHash", OLD."requestHash", OLD."provider", OLD."releaseId", OLD."promptVersion",
         OLD."billingDay", OLD."tokenAllowance", OLD."requestPayload", OLD."maxAttempts",
         OLD."executionDeadlineAt", OLD."releasePolicyHash", OLD."wireRequestHash", OLD."regenerationId") THEN
    RAISE EXCEPTION 'INFERENCE_SNAPSHOT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

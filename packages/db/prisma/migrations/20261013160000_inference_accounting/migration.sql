-- CreateEnum
CREATE TYPE "InferenceProvider" AS ENUM ('SYNTHETIC', 'FIREWORKS');

-- CreateEnum
CREATE TYPE "InferenceRunState" AS ENUM ('RESERVED', 'SUBMITTING', 'UNKNOWN', 'RESPONDED', 'REJECTED', 'APPLIED');

-- CreateEnum
CREATE TYPE "InferenceAttemptState" AS ENUM ('SUBMITTING', 'RESPONDED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "InferenceBudget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billingDay" VARCHAR(10) NOT NULL,
    "tokenLimit" BIGINT NOT NULL,
    "baselineTokens" BIGINT NOT NULL DEFAULT 0,
    "knownTokens" BIGINT NOT NULL DEFAULT 0,
    "reservedTokens" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InferenceBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InferenceRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "claimVersion" TIMESTAMP(3) NOT NULL,
    "sourceHash" VARCHAR(64) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "provider" "InferenceProvider" NOT NULL,
    "releaseId" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "billingDay" VARCHAR(10) NOT NULL,
    "tokenAllowance" BIGINT NOT NULL,
    "reservedTokens" BIGINT NOT NULL,
    "totalTokens" BIGINT,
    "state" "InferenceRunState" NOT NULL DEFAULT 'RESERVED',
    "requestPayload" JSONB NOT NULL,
    "resultPayload" JSONB,
    "receiptHash" VARCHAR(64),
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "summaryId" TEXT,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InferenceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InferenceAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "state" "InferenceAttemptState" NOT NULL DEFAULT 'SUBMITTING',
    "tokenAllowance" BIGINT NOT NULL,
    "reservedTokens" BIGINT NOT NULL,
    "totalTokens" BIGINT,
    "inputTokens" BIGINT,
    "outputTokens" BIGINT,
    "cachedInputTokens" BIGINT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,

    CONSTRAINT "InferenceAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InferenceBudget_organizationId_reservedTokens_idx" ON "InferenceBudget"("organizationId", "reservedTokens");

-- CreateIndex
CREATE UNIQUE INDEX "InferenceBudget_organizationId_billingDay_key" ON "InferenceBudget"("organizationId", "billingDay");

-- CreateIndex
CREATE UNIQUE INDEX "InferenceRun_summaryId_key" ON "InferenceRun"("summaryId");

-- CreateIndex
CREATE INDEX "InferenceRun_organizationId_state_updatedAt_idx" ON "InferenceRun"("organizationId", "state", "updatedAt");

-- CreateIndex
CREATE INDEX "InferenceRun_state_leaseExpiresAt_idx" ON "InferenceRun"("state", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "InferenceRun_organizationId_callId_generation_key" ON "InferenceRun"("organizationId", "callId", "generation");

-- CreateIndex
CREATE UNIQUE INDEX "InferenceRun_id_organizationId_key" ON "InferenceRun"("id", "organizationId");

-- CreateIndex
CREATE INDEX "InferenceAttempt_organizationId_state_submittedAt_idx" ON "InferenceAttempt"("organizationId", "state", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InferenceAttempt_organizationId_runId_attemptNumber_key" ON "InferenceAttempt"("organizationId", "runId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "InferenceBudget" ADD CONSTRAINT "InferenceBudget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InferenceRun" ADD CONSTRAINT "InferenceRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InferenceRun" ADD CONSTRAINT "InferenceRun_callId_claimId_organizationId_fkey" FOREIGN KEY ("callId", "claimId", "organizationId") REFERENCES "Call"("id", "claimId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InferenceRun" ADD CONSTRAINT "InferenceRun_organizationId_billingDay_fkey" FOREIGN KEY ("organizationId", "billingDay") REFERENCES "InferenceBudget"("organizationId", "billingDay") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InferenceAttempt" ADD CONSTRAINT "InferenceAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InferenceAttempt" ADD CONSTRAINT "InferenceAttempt_runId_organizationId_fkey" FOREIGN KEY ("runId", "organizationId") REFERENCES "InferenceRun"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Admission allocations are operational token units, not dollar-spend guarantees.
ALTER TABLE "InferenceBudget" ADD CONSTRAINT "InferenceBudget_amounts_check"
  CHECK ("tokenLimit" > 0 AND "baselineTokens" >= 0 AND "knownTokens" >= "baselineTokens" AND "reservedTokens" >= 0);
ALTER TABLE "InferenceBudget" ADD CONSTRAINT "InferenceBudget_day_check"
  CHECK ("billingDay" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
ALTER TABLE "InferenceRun" ADD CONSTRAINT "InferenceRun_amounts_check"
  CHECK ("tokenAllowance" > 0 AND "reservedTokens" >= 0 AND "reservedTokens" <= "tokenAllowance" AND ("totalTokens" IS NULL OR "totalTokens" >= 0));
ALTER TABLE "InferenceRun" ADD CONSTRAINT "InferenceRun_generation_check" CHECK ("generation" = 1);
ALTER TABLE "InferenceRun" ADD CONSTRAINT "InferenceRun_hashes_check"
  CHECK ("sourceHash" ~ '^[a-f0-9]{64}$' AND "requestHash" ~ '^[a-f0-9]{64}$' AND ("receiptHash" IS NULL OR "receiptHash" ~ '^[a-f0-9]{64}$'));
ALTER TABLE "InferenceAttempt" ADD CONSTRAINT "InferenceAttempt_amounts_check"
  CHECK ("tokenAllowance" > 0 AND "reservedTokens" >= 0 AND "reservedTokens" <= "tokenAllowance"
    AND ("totalTokens" IS NULL OR "totalTokens" >= 0)
    AND ("inputTokens" IS NULL OR "inputTokens" >= 0)
    AND ("outputTokens" IS NULL OR "outputTokens" >= 0)
    AND ("cachedInputTokens" IS NULL OR "cachedInputTokens" >= 0));
-- Supporting more sends requires separate durable per-attempt admission first.
ALTER TABLE "InferenceAttempt" ADD CONSTRAINT "InferenceAttempt_number_check" CHECK ("attemptNumber" = 1);

-- The snapshot remains the evidence for both first send and later local application.
CREATE FUNCTION dentabill_inference_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."organizationId", NEW."callId", NEW."claimId", NEW."generation", NEW."claimVersion",
         NEW."sourceHash", NEW."requestHash", NEW."provider", NEW."releaseId", NEW."promptVersion",
         NEW."billingDay", NEW."tokenAllowance", NEW."requestPayload")
     IS DISTINCT FROM
     ROW(OLD."organizationId", OLD."callId", OLD."claimId", OLD."generation", OLD."claimVersion",
         OLD."sourceHash", OLD."requestHash", OLD."provider", OLD."releaseId", OLD."promptVersion",
         OLD."billingDay", OLD."tokenAllowance", OLD."requestPayload") THEN
    RAISE EXCEPTION 'INFERENCE_SNAPSHOT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inference_snapshot_immutable BEFORE UPDATE ON "InferenceRun"
  FOR EACH ROW EXECUTE FUNCTION dentabill_inference_snapshot_immutable();

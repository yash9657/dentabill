ALTER TABLE "InferenceRun"
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "executionDeadlineAt" TIMESTAMP(3),
  ADD COLUMN "releasePolicyHash" VARCHAR(64),
  ADD COLUMN "wireRequestHash" VARCHAR(64);
ALTER TABLE "InferenceAttempt"
  ADD COLUMN "billingDay" VARCHAR(10),
  ADD COLUMN "responsePayload" JSONB,
  ADD COLUMN "responseRecordedAt" TIMESTAMP(3),
  ADD COLUMN "responseHash" VARCHAR(64),
  ADD COLUMN "completionHash" VARCHAR(64),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "acceptance" TEXT,
  ADD COLUMN "httpStatus" INTEGER,
  ADD COLUMN "elapsedMs" INTEGER;
UPDATE "InferenceAttempt" AS attempt SET "billingDay" = run."billingDay"
  FROM "InferenceRun" AS run WHERE attempt."runId" = run."id" AND attempt."organizationId" = run."organizationId";
ALTER TABLE "InferenceAttempt" ALTER COLUMN "billingDay" SET NOT NULL;
ALTER TABLE "InferenceAttempt" ADD CONSTRAINT "InferenceAttempt_organizationId_billingDay_fkey"
  FOREIGN KEY ("organizationId", "billingDay") REFERENCES "InferenceBudget"("organizationId", "billingDay") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InferenceRun" DROP CONSTRAINT "InferenceRun_amounts_check";
ALTER TABLE "InferenceRun" ADD CONSTRAINT "InferenceRun_amounts_check"
  CHECK ("maxAttempts" BETWEEN 1 AND 2 AND ("provider" = 'FIREWORKS' OR "maxAttempts" = 1)
    AND "tokenAllowance" > 0 AND "reservedTokens" >= 0 AND "reservedTokens" <= "tokenAllowance" * "maxAttempts"
    AND ("totalTokens" IS NULL OR "totalTokens" >= 0));
ALTER TABLE "InferenceRun" ADD CONSTRAINT "InferenceRun_native_hashes_check"
  CHECK (("releasePolicyHash" IS NULL OR "releasePolicyHash" ~ '^[a-f0-9]{64}$')
    AND ("wireRequestHash" IS NULL OR "wireRequestHash" ~ '^[a-f0-9]{64}$'));
ALTER TABLE "InferenceAttempt" DROP CONSTRAINT "InferenceAttempt_number_check";
ALTER TABLE "InferenceAttempt" ADD CONSTRAINT "InferenceAttempt_number_check" CHECK ("attemptNumber" BETWEEN 1 AND 2);
ALTER TABLE "InferenceAttempt" ADD CONSTRAINT "InferenceAttempt_receipt_check"
  CHECK (("responseHash" IS NULL OR "responseHash" ~ '^[a-f0-9]{64}$')
    AND ("completionHash" IS NULL OR "completionHash" ~ '^[a-f0-9]{64}$')
    AND ("httpStatus" IS NULL OR "httpStatus" BETWEEN 100 AND 599)
    AND ("elapsedMs" IS NULL OR "elapsedMs" >= 0)
    AND ("outcome" IS NULL OR "outcome" IN ('COMPLETED','HTTP_ERROR','NETWORK_ERROR','DEADLINE_EXCEEDED','CANCELLED','INVALID_RESPONSE'))
    AND ("acceptance" IS NULL OR "acceptance" IN ('NOT_SENT','POSSIBLE','RESPONDED')));
CREATE OR REPLACE FUNCTION dentabill_inference_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."organizationId", NEW."callId", NEW."claimId", NEW."generation", NEW."claimVersion",
         NEW."sourceHash", NEW."requestHash", NEW."provider", NEW."releaseId", NEW."promptVersion",
         NEW."billingDay", NEW."tokenAllowance", NEW."requestPayload", NEW."maxAttempts",
         NEW."executionDeadlineAt", NEW."releasePolicyHash", NEW."wireRequestHash")
     IS DISTINCT FROM
     ROW(OLD."organizationId", OLD."callId", OLD."claimId", OLD."generation", OLD."claimVersion",
         OLD."sourceHash", OLD."requestHash", OLD."provider", OLD."releaseId", OLD."promptVersion",
         OLD."billingDay", OLD."tokenAllowance", OLD."requestPayload", OLD."maxAttempts",
         OLD."executionDeadlineAt", OLD."releasePolicyHash", OLD."wireRequestHash") THEN
    RAISE EXCEPTION 'INFERENCE_SNAPSHOT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION dentabill_inference_attempt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."organizationId", NEW."runId", NEW."attemptNumber", NEW."billingDay", NEW."tokenAllowance", NEW."submittedAt")
     IS DISTINCT FROM ROW(OLD."organizationId", OLD."runId", OLD."attemptNumber", OLD."billingDay", OLD."tokenAllowance", OLD."submittedAt")
     OR (OLD."responseHash" IS NOT NULL AND ROW(NEW."responseHash", NEW."responsePayload", NEW."responseRecordedAt")
       IS DISTINCT FROM ROW(OLD."responseHash", OLD."responsePayload", OLD."responseRecordedAt"))
     OR (OLD."completionHash" IS NOT NULL AND ROW(NEW."completionHash", NEW."completedAt", NEW."outcome", NEW."acceptance", NEW."httpStatus", NEW."elapsedMs", NEW."inputTokens", NEW."outputTokens", NEW."totalTokens", NEW."cachedInputTokens", NEW."reservedTokens", NEW."lastErrorCode")
       IS DISTINCT FROM ROW(OLD."completionHash", OLD."completedAt", OLD."outcome", OLD."acceptance", OLD."httpStatus", OLD."elapsedMs", OLD."inputTokens", OLD."outputTokens", OLD."totalTokens", OLD."cachedInputTokens", OLD."reservedTokens", OLD."lastErrorCode")) THEN
    RAISE EXCEPTION 'INFERENCE_ATTEMPT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inference_attempt_immutable BEFORE UPDATE ON "InferenceAttempt"
  FOR EACH ROW EXECUTE FUNCTION dentabill_inference_attempt_immutable();

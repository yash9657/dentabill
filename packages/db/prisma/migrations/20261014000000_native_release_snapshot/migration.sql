ALTER TABLE "InferenceRun" ADD COLUMN "releaseSnapshot" JSONB;

ALTER TABLE "InferenceRun" ADD CONSTRAINT "InferenceRun_releaseSnapshot_check" CHECK
  ("releaseSnapshot" IS NULL OR jsonb_typeof("releaseSnapshot") = 'string');

CREATE OR REPLACE FUNCTION dentabill_inference_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."organizationId", NEW."callId", NEW."claimId", NEW."generation", NEW."claimVersion",
         NEW."sourceHash", NEW."requestHash", NEW."provider", NEW."releaseId", NEW."promptVersion",
         NEW."billingDay", NEW."tokenAllowance", NEW."requestPayload", NEW."maxAttempts",
         NEW."executionDeadlineAt", NEW."releasePolicyHash", NEW."wireRequestHash", NEW."regenerationId",
         NEW."releaseSnapshot")
     IS DISTINCT FROM
     ROW(OLD."organizationId", OLD."callId", OLD."claimId", OLD."generation", OLD."claimVersion",
         OLD."sourceHash", OLD."requestHash", OLD."provider", OLD."releaseId", OLD."promptVersion",
         OLD."billingDay", OLD."tokenAllowance", OLD."requestPayload", OLD."maxAttempts",
         OLD."executionDeadlineAt", OLD."releasePolicyHash", OLD."wireRequestHash", OLD."regenerationId",
         OLD."releaseSnapshot") THEN
    RAISE EXCEPTION 'INFERENCE_SNAPSHOT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

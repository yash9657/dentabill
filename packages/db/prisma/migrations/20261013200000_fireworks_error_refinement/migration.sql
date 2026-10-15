CREATE OR REPLACE FUNCTION dentabill_inference_attempt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE refining BOOLEAN;
BEGIN
  refining := OLD."completionHash" IS NOT NULL AND OLD."totalTokens" IS NULL
    AND OLD."outcome" IN ('CANCELLED', 'DEADLINE_EXCEEDED') AND OLD."acceptance" = 'RESPONDED'
    AND OLD."responseHash" IS NOT NULL
    AND NEW."acceptance" = 'RESPONDED' AND NEW."httpStatus" = (OLD."responsePayload"->>'status')::integer
    AND ((NEW."httpStatus" BETWEEN 200 AND 299 AND NEW."outcome" IN ('COMPLETED', 'INVALID_RESPONSE'))
      OR ((NEW."httpStatus" < 200 OR NEW."httpStatus" >= 300) AND NEW."outcome" = 'HTTP_ERROR'))
    AND (OLD."inputTokens" IS NULL OR NEW."inputTokens" IS NOT DISTINCT FROM OLD."inputTokens")
    AND (OLD."outputTokens" IS NULL OR NEW."outputTokens" IS NOT DISTINCT FROM OLD."outputTokens")
    AND (OLD."cachedInputTokens" IS NULL OR NEW."cachedInputTokens" IS NOT DISTINCT FROM OLD."cachedInputTokens")
    AND OLD."completionHistory" = '[]'::jsonb
    AND jsonb_typeof(NEW."completionHistory") = 'array' AND jsonb_array_length(NEW."completionHistory") = 1
    AND NEW."completionHistory"->0->>'completionHash' = OLD."completionHash";
  IF ROW(NEW."organizationId", NEW."runId", NEW."attemptNumber", NEW."billingDay", NEW."tokenAllowance", NEW."submittedAt")
     IS DISTINCT FROM ROW(OLD."organizationId", OLD."runId", OLD."attemptNumber", OLD."billingDay", OLD."tokenAllowance", OLD."submittedAt")
     OR (OLD."responseHash" IS NOT NULL AND ROW(NEW."responseHash", NEW."responsePayload", NEW."responseRecordedAt")
       IS DISTINCT FROM ROW(OLD."responseHash", OLD."responsePayload", OLD."responseRecordedAt"))
     OR (NOT COALESCE(refining, FALSE) AND OLD."completionHash" IS NOT NULL AND ROW(NEW."completionHash", NEW."completedAt", NEW."outcome", NEW."acceptance", NEW."httpStatus", NEW."elapsedMs", NEW."inputTokens", NEW."outputTokens", NEW."totalTokens", NEW."cachedInputTokens", NEW."reservedTokens", NEW."lastErrorCode", NEW."completionHistory")
       IS DISTINCT FROM ROW(OLD."completionHash", OLD."completedAt", OLD."outcome", OLD."acceptance", OLD."httpStatus", OLD."elapsedMs", OLD."inputTokens", OLD."outputTokens", OLD."totalTokens", OLD."cachedInputTokens", OLD."reservedTokens", OLD."lastErrorCode", OLD."completionHistory")) THEN
    RAISE EXCEPTION 'INFERENCE_ATTEMPT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

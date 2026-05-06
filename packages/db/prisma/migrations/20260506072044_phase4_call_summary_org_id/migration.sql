-- P4-T1A: Close the multi-tenancy gap on CallSummary.
--
-- CallSummary held PHI (rawTranscript + claudeSummary) but was not
-- registered in MULTI_TENANT_MODELS, leaving the read-scope and write-
-- middleware unable to enforce org isolation. This migration adds the
-- organizationId column safely (expand → backfill → tighten) so it is
-- replayable on a populated production table.
--
-- Steps:
--   1. Add the column as nullable.
--   2. Backfill from Call.organizationId (1:1 relation; every existing
--      row resolves to exactly one parent Call).
--   3. Tighten to NOT NULL.
--   4. Wire the foreign key + index that the read-scope path uses.

-- Step 1: expand
ALTER TABLE "CallSummary" ADD COLUMN "organizationId" TEXT;

-- Step 2: backfill from the parent Call row.
UPDATE "CallSummary" cs
SET "organizationId" = c."organizationId"
FROM "Call" c
WHERE cs."callId" = c."id"
  AND cs."organizationId" IS NULL;

-- Step 3: tighten. After step 2 every existing row has a value;
-- new rows must supply one.
ALTER TABLE "CallSummary" ALTER COLUMN "organizationId" SET NOT NULL;

-- Step 4: read-scope index + foreign-key constraint.
CREATE INDEX "CallSummary_organizationId_createdAt_idx"
  ON "CallSummary"("organizationId", "createdAt");

ALTER TABLE "CallSummary"
  ADD CONSTRAINT "CallSummary_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

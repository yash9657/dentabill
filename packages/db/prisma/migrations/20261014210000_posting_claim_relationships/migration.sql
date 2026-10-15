BEGIN;

-- CreateTable
CREATE TABLE "PostingClaimRelationship" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receiptId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "claimId" TEXT NOT NULL,
    "claimSourceLineId" UUID,
    "claimVersion" TIMESTAMP(3) NOT NULL,
    "claimSourceContentHash" CHAR(64) NOT NULL,
    "sourceSystem" VARCHAR(32) NOT NULL,
    "sourceNamespace" VARCHAR(80) NOT NULL,
    "sourceEntryId" VARCHAR(200) NOT NULL,
    "sourceClaimId" VARCHAR(200) NOT NULL,
    "evidenceHash" CHAR(64) NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "reviewedByRole" "UserRole" NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "reviewToken" CHAR(64) NOT NULL,
    "ledgerVersion" VARCHAR(160) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostingClaimRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostingClaimRelease" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "relationshipId" UUID NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "reviewedByRole" "UserRole" NOT NULL,
    "reason" VARCHAR(20) NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "reviewToken" CHAR(64) NOT NULL,
    "ledgerVersion" VARCHAR(160) NOT NULL,
    "relationshipRequestHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostingClaimRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostingClaimRelationship_source_idx" ON "PostingClaimRelationship"("organizationId", "sourceSystem", "sourceNamespace", "sourceEntryId");

-- CreateIndex
CREATE INDEX "PostingClaimRelationship_organizationId_claimId_idx" ON "PostingClaimRelationship"("organizationId", "claimId");

-- CreateIndex
CREATE INDEX "PostingClaimRelationship_organizationId_receiptId_idx" ON "PostingClaimRelationship"("organizationId", "receiptId");

-- CreateIndex
CREATE INDEX "PostingClaimRelationship_organizationId_createdAt_id_idx" ON "PostingClaimRelationship"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PostingClaimRelationship_id_organizationId_key" ON "PostingClaimRelationship"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PostingClaimRelationship_organizationId_idempotencyKey_key" ON "PostingClaimRelationship"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PostingClaimRelease_relationshipId_key" ON "PostingClaimRelease"("relationshipId");

-- CreateIndex
CREATE INDEX "PostingClaimRelease_organizationId_createdAt_id_idx" ON "PostingClaimRelease"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PostingClaimRelease_relationshipId_organizationId_key" ON "PostingClaimRelease"("relationshipId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PostingClaimRelease_organizationId_idempotencyKey_key" ON "PostingClaimRelease"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PostingSourceEntry_relationship_binding_key" ON "PostingSourceEntry"("id", "organizationId", "receiptId", "evidenceId", "reviewId");

-- AddForeignKey
ALTER TABLE "PostingClaimRelationship" ADD CONSTRAINT "PostingClaimRelationship_receiptId_organizationId_fkey" FOREIGN KEY ("receiptId", "organizationId") REFERENCES "PostingSourceReceipt"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PostingClaimRelationship" ADD CONSTRAINT "PostingClaimRelationship_evidenceId_organizationId_receipt_fkey" FOREIGN KEY ("evidenceId", "organizationId", "receiptId") REFERENCES "PostingSourceEvidence"("id", "organizationId", "receiptId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PostingClaimRelationship" ADD CONSTRAINT "PostingClaimRelationship_reviewId_organizationId_receiptId_fkey" FOREIGN KEY ("reviewId", "organizationId", "receiptId", "evidenceId") REFERENCES "PostingSourceReview"("id", "organizationId", "receiptId", "evidenceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PostingClaimRelationship" ADD CONSTRAINT "PostingClaimRelationship_entryId_organizationId_receiptId__fkey" FOREIGN KEY ("entryId", "organizationId", "receiptId", "evidenceId", "reviewId") REFERENCES "PostingSourceEntry"("id", "organizationId", "receiptId", "evidenceId", "reviewId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PostingClaimRelationship" ADD CONSTRAINT "PostingClaimRelationship_claimId_organizationId_fkey" FOREIGN KEY ("claimId", "organizationId") REFERENCES "Claim"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PostingClaimRelationship" ADD CONSTRAINT "PostingClaimRelationship_claimSourceLineId_organizationId__fkey" FOREIGN KEY ("claimSourceLineId", "organizationId", "claimId") REFERENCES "ClaimSourceLine"("id", "organizationId", "claimId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PostingClaimRelationship" ADD CONSTRAINT "PostingClaimRelationship_reviewedByUserId_organizationId_fkey" FOREIGN KEY ("reviewedByUserId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PostingClaimRelease" ADD CONSTRAINT "PostingClaimRelease_relationshipId_organizationId_fkey" FOREIGN KEY ("relationshipId", "organizationId") REFERENCES "PostingClaimRelationship"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PostingClaimRelease" ADD CONSTRAINT "PostingClaimRelease_reviewedByUserId_organizationId_fkey" FOREIGN KEY ("reviewedByUserId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Additive, explicit relationships only. No prior evidence, claim, ledger or
-- helper is rewritten, and no historical association is inferred or backfilled.
ALTER TABLE "PostingClaimRelationship" ADD CONSTRAINT "PostingClaimRelationship_shape_check" CHECK (
  "sourceSystem" IN ('DENTRIX','EAGLESOFT','OPEN_DENTAL')
  AND "sourceNamespace" ~ '^[a-z0-9][a-z0-9_-]{0,79}$'
  AND dentabill_posting_token_valid("sourceEntryId",200)
  AND dentabill_posting_token_valid("sourceClaimId",200)
  AND "reviewedByRole" IN ('OWNER','ADMIN','BILLING_STAFF')
  AND "claimSourceContentHash" ~ '^[a-f0-9]{64}$'
  AND "evidenceHash" ~ '^[a-f0-9]{64}$'
  AND "requestHash" ~ '^[a-f0-9]{64}$' AND "reviewToken" ~ '^[a-f0-9]{64}$'
  AND "ledgerVersion" ~ '^[0-9]+:[0-9]+:[0-9]+:[0-9]+$'
  AND isfinite("claimVersion") AND isfinite("createdAt")
);
ALTER TABLE "PostingClaimRelease" ADD CONSTRAINT "PostingClaimRelease_shape_check" CHECK (
  reason IN ('WRONG_LINK','SOURCE_CHANGED','OTHER_REVIEWED_ERROR')
  AND "reviewedByRole" IN ('OWNER','ADMIN','BILLING_STAFF')
  AND "requestHash" ~ '^[a-f0-9]{64}$' AND "reviewToken" ~ '^[a-f0-9]{64}$'
  AND "relationshipRequestHash" ~ '^[a-f0-9]{64}$'
  AND "ledgerVersion" ~ '^[0-9]+:[0-9]+:[0-9]+:[0-9]+$'
  AND isfinite("createdAt")
);
CREATE FUNCTION dentabill_posting_claim_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'POSTING_CLAIM_IMMUTABLE' USING ERRCODE = '23514'; END;
$$;
CREATE TRIGGER "PostingClaimRelationship_immutable" BEFORE UPDATE OR DELETE ON "PostingClaimRelationship"
  FOR EACH ROW EXECUTE FUNCTION dentabill_posting_claim_immutable();
CREATE TRIGGER "PostingClaimRelease_immutable" BEFORE UPDATE OR DELETE ON "PostingClaimRelease"
  FOR EACH ROW EXECUTE FUNCTION dentabill_posting_claim_immutable();

CREATE FUNCTION dentabill_posting_claim_ledger(org TEXT)
RETURNS TEXT LANGUAGE sql VOLATILE AS $$
  SELECT (SELECT count(*) FROM "PostingSourceEvidence" WHERE "organizationId" = org)::text || ':' ||
    (SELECT count(*) FROM "PostingSourceReview" WHERE "organizationId" = org)::text || ':' ||
    (SELECT count(*) FROM "PostingClaimRelationship" WHERE "organizationId" = org)::text || ':' ||
    (SELECT count(*) FROM "PostingClaimRelease" WHERE "organizationId" = org)::text;
$$;

CREATE FUNCTION dentabill_admit_posting_claim_relationship() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_entry "PostingSourceEntry"%ROWTYPE;
  source_evidence "PostingSourceEvidence"%ROWTYPE;
  local_claim "Claim"%ROWTYPE;
  local_line "ClaimSourceLine"%ROWTYPE;
  actor_role "UserRole";
BEGIN
  -- Tuple writes fence old repeatable-read snapshots as well as concurrent
  -- read-committed admission. Neither statement changes business timestamps.
  UPDATE "Organization" SET id = id WHERE id = NEW."organizationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTING_CLAIM_ORGANIZATION_INVALID' USING ERRCODE = '23514'; END IF;
  UPDATE "Claim" SET id = id WHERE id = NEW."claimId" AND "organizationId" = NEW."organizationId"
    RETURNING * INTO local_claim;
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTING_CLAIM_BINDING_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT role INTO actor_role FROM "User" WHERE id = NEW."reviewedByUserId" AND "organizationId" = NEW."organizationId" FOR SHARE;
  IF NOT FOUND OR actor_role IS DISTINCT FROM NEW."reviewedByRole" THEN
    RAISE EXCEPTION 'POSTING_CLAIM_ACTOR_INVALID' USING ERRCODE = '23514'; END IF;
  IF NEW."ledgerVersion" IS DISTINCT FROM dentabill_posting_claim_ledger(NEW."organizationId") THEN
    RAISE EXCEPTION 'POSTING_CLAIM_STALE' USING ERRCODE = '23514'; END IF;
  SELECT * INTO source_entry FROM "PostingSourceEntry" WHERE id = NEW."entryId"
    AND "organizationId" = NEW."organizationId" AND "receiptId" = NEW."receiptId"
    AND "evidenceId" = NEW."evidenceId" AND "reviewId" = NEW."reviewId";
  IF NOT FOUND OR source_entry."sourceEntryId" IS DISTINCT FROM NEW."sourceEntryId"
    OR source_entry."sourceClaimId" IS NULL OR source_entry."sourceClaimId" IS DISTINCT FROM NEW."sourceClaimId"
  THEN RAISE EXCEPTION 'POSTING_CLAIM_BINDING_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT * INTO source_evidence FROM "PostingSourceEvidence" WHERE id = NEW."evidenceId"
    AND "organizationId" = NEW."organizationId" AND "receiptId" = NEW."receiptId";
  IF NOT FOUND OR source_evidence."contentHash" IS DISTINCT FROM NEW."evidenceHash"
    OR source_evidence."sourceSystem" IS DISTINCT FROM NEW."sourceSystem"
    OR source_evidence."sourceNamespace" IS DISTINCT FROM NEW."sourceNamespace"
  THEN RAISE EXCEPTION 'POSTING_CLAIM_BINDING_INVALID' USING ERRCODE = '23514'; END IF;
  IF source_evidence."sourceSequence" IS DISTINCT FROM (
      SELECT max("sourceSequence") FROM "PostingSourceEvidence"
      WHERE "organizationId" = NEW."organizationId" AND "receiptId" = NEW."receiptId")
    OR NOT EXISTS (SELECT 1 FROM "PostingSourceReview" r WHERE r.id = NEW."reviewId"
      AND r."organizationId" = NEW."organizationId" AND r."receiptId" = NEW."receiptId"
      AND r."evidenceId" = NEW."evidenceId" AND r.decision = 'ACCEPT')
  THEN RAISE EXCEPTION 'POSTING_CLAIM_NOT_CURRENT' USING ERRCODE = '23514'; END IF;
  IF local_claim."updatedAt" IS DISTINCT FROM NEW."claimVersion"
    OR local_claim."sourceContentHash" IS DISTINCT FROM NEW."claimSourceContentHash"
  THEN RAISE EXCEPTION 'POSTING_CLAIM_CLAIM_CHANGED' USING ERRCODE = '23514'; END IF;
  IF local_claim."sourceSystem" IS DISTINCT FROM NEW."sourceSystem"
    OR local_claim."sourceNamespace" IS DISTINCT FROM NEW."sourceNamespace"
    OR local_claim."sourceClaimId" IS DISTINCT FROM NEW."sourceClaimId"
  THEN RAISE EXCEPTION 'POSTING_CLAIM_SOURCE_MISMATCH' USING ERRCODE = '23514'; END IF;
  IF source_entry."sourceLineId" IS NULL THEN
    -- A standalone procedure reference is retained, never guessed into a line.
    IF NEW."claimSourceLineId" IS NOT NULL THEN
      RAISE EXCEPTION 'POSTING_CLAIM_LINE_MISMATCH' USING ERRCODE = '23514'; END IF;
  ELSE
    SELECT * INTO local_line FROM "ClaimSourceLine" WHERE id = NEW."claimSourceLineId"
      AND "organizationId" = NEW."organizationId" AND "claimId" = NEW."claimId";
    IF NOT FOUND OR local_line."sourceLineId" IS DISTINCT FROM source_entry."sourceLineId"
      OR (source_entry."sourceProcedureId" IS NOT NULL
        AND local_line."sourceProcedureId" IS DISTINCT FROM source_entry."sourceProcedureId")
    THEN RAISE EXCEPTION 'POSTING_CLAIM_LINE_MISMATCH' USING ERRCODE = '23514'; END IF;
  END IF;
  -- Historical links reserve source identity even when evidence is omitted,
  -- removed, rejected, stale or has changed amount/kind. Only release frees it.
  IF EXISTS (SELECT 1 FROM "PostingClaimRelationship" r
    WHERE r."organizationId" = NEW."organizationId" AND r."sourceSystem" = NEW."sourceSystem"
      AND r."sourceNamespace" = NEW."sourceNamespace" AND r."sourceEntryId" = NEW."sourceEntryId"
      AND NOT EXISTS (SELECT 1 FROM "PostingClaimRelease" x
        WHERE x."organizationId" = r."organizationId" AND x."relationshipId" = r.id))
  THEN RAISE EXCEPTION 'POSTING_CLAIM_ENTRY_RESERVED' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PostingClaimRelationship_admission" BEFORE INSERT ON "PostingClaimRelationship"
  FOR EACH ROW EXECUTE FUNCTION dentabill_admit_posting_claim_relationship();

CREATE FUNCTION dentabill_admit_posting_claim_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE relationship "PostingClaimRelationship"%ROWTYPE; actor_role "UserRole";
BEGIN
  UPDATE "Organization" SET id = id WHERE id = NEW."organizationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTING_CLAIM_ORGANIZATION_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT role INTO actor_role FROM "User" WHERE id = NEW."reviewedByUserId" AND "organizationId" = NEW."organizationId" FOR SHARE;
  IF NOT FOUND OR actor_role IS DISTINCT FROM NEW."reviewedByRole" THEN
    RAISE EXCEPTION 'POSTING_CLAIM_ACTOR_INVALID' USING ERRCODE = '23514'; END IF;
  IF NEW."ledgerVersion" IS DISTINCT FROM dentabill_posting_claim_ledger(NEW."organizationId") THEN
    RAISE EXCEPTION 'POSTING_CLAIM_STALE' USING ERRCODE = '23514'; END IF;
  SELECT * INTO relationship FROM "PostingClaimRelationship" WHERE id = NEW."relationshipId" AND "organizationId" = NEW."organizationId";
  IF NOT FOUND OR relationship."requestHash" IS DISTINCT FROM NEW."relationshipRequestHash" THEN
    RAISE EXCEPTION 'POSTING_CLAIM_BINDING_INVALID' USING ERRCODE = '23514'; END IF;
  -- Stale source, removed entries and changed local claim versions all retain
  -- their correction path. No amount or workflow field is written by release.
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PostingClaimRelease_admission" BEFORE INSERT ON "PostingClaimRelease"
  FOR EACH ROW EXECUTE FUNCTION dentabill_admit_posting_claim_release();

COMMIT;

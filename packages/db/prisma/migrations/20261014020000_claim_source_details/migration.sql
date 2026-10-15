-- CreateTable
CREATE TABLE "ClaimSourceDetails" (
    "claimId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "importedClaimAmount" DECIMAL(10,2) NOT NULL,
    "lineCount" INTEGER NOT NULL,
    "coverageCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimSourceDetails_pkey" PRIMARY KEY ("claimId","organizationId")
);

-- CreateTable
CREATE TABLE "ClaimSourceLine" (
    "id" UUID NOT NULL,
    "claimId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceLineId" VARCHAR(200) NOT NULL,
    "sourceProcedureId" VARCHAR(200),
    "position" INTEGER NOT NULL,
    "procedureCode" VARCHAR(32) NOT NULL,
    "codeVersion" VARCHAR(32),
    "serviceDate" DATE NOT NULL,
    "billedAmount" DECIMAL(10,2) NOT NULL,
    "quantity" DECIMAL(12,3),
    "treatmentArea" VARCHAR(80),
    "tooth" VARCHAR(80),
    "surface" VARCHAR(80),
    "quadrant" VARCHAR(80),
    "toothRange" VARCHAR(80),
    "toothNumberingSystem" VARCHAR(80),

    CONSTRAINT "ClaimSourceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimSourceCoverage" (
    "id" UUID NOT NULL,
    "claimId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceCoverageId" VARCHAR(200) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "payerName" VARCHAR(200) NOT NULL,
    "payerIdentifier" VARCHAR(200),
    "payerIdentifierSystem" VARCHAR(80),
    "isClaimCoverage" BOOLEAN NOT NULL,
    "sourcePlanId" VARCHAR(200),
    "sourceSubscriptionId" VARCHAR(200),
    "subscriberId" VARCHAR(200),
    "patientMemberId" VARCHAR(200),
    "groupNumber" VARCHAR(200),
    "relationship" VARCHAR(80),
    "effectiveDate" DATE,
    "terminationDate" DATE,

    CONSTRAINT "ClaimSourceCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaimSourceDetails_organizationId_claimId_idx" ON "ClaimSourceDetails"("organizationId", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimSourceLine_organizationId_claimId_sourceLineId_key" ON "ClaimSourceLine"("organizationId", "claimId", "sourceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimSourceLine_organizationId_claimId_position_key" ON "ClaimSourceLine"("organizationId", "claimId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimSourceCoverage_organizationId_claimId_sourceCoverageId_key" ON "ClaimSourceCoverage"("organizationId", "claimId", "sourceCoverageId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimSourceCoverage_organizationId_claimId_sequence_key" ON "ClaimSourceCoverage"("organizationId", "claimId", "sequence");

-- AddForeignKey
ALTER TABLE "ClaimSourceDetails" ADD CONSTRAINT "ClaimSourceDetails_claimId_organizationId_fkey" FOREIGN KEY ("claimId", "organizationId") REFERENCES "Claim"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimSourceLine" ADD CONSTRAINT "ClaimSourceLine_claimId_organizationId_fkey" FOREIGN KEY ("claimId", "organizationId") REFERENCES "ClaimSourceDetails"("claimId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimSourceCoverage" ADD CONSTRAINT "ClaimSourceCoverage_claimId_organizationId_fkey" FOREIGN KEY ("claimId", "organizationId") REFERENCES "ClaimSourceDetails"("claimId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Expansion only: no legacy source facts are inferred or backfilled.
ALTER TABLE "ClaimSourceDetails" ADD CONSTRAINT "ClaimSourceDetails_shape_check" CHECK (
  "schemaVersion" = 1
  AND "lineCount" BETWEEN 0 AND 500
  AND "coverageCount" BETWEEN 0 AND 9
  AND "lineCount" + "coverageCount" > 0
  AND "importedClaimAmount" BETWEEN 0 AND 99999999.99
);

CREATE FUNCTION dentabill_source_token_valid(value TEXT, maximum INTEGER)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT value IS NULL OR (
    char_length(value) BETWEEN 1 AND maximum
    AND value = btrim(value) AND value !~ '[[:cntrl:]]'
  );
$$;

ALTER TABLE "ClaimSourceLine" ADD CONSTRAINT "ClaimSourceLine_facts_check" CHECK (
  "position" BETWEEN 0 AND 499
  AND dentabill_source_token_valid("sourceLineId", 200)
  AND dentabill_source_token_valid("sourceProcedureId", 200)
  AND dentabill_source_token_valid("procedureCode", 32)
  AND dentabill_source_token_valid("codeVersion", 32)
  AND dentabill_source_token_valid("treatmentArea", 80)
  AND dentabill_source_token_valid("tooth", 80)
  AND dentabill_source_token_valid("surface", 80)
  AND dentabill_source_token_valid("quadrant", 80)
  AND dentabill_source_token_valid("toothRange", 80)
  AND dentabill_source_token_valid("toothNumberingSystem", 80)
  AND "billedAmount" BETWEEN 0 AND 99999999.99
  AND ("quantity" IS NULL OR ("quantity" > 0 AND "quantity" <= 999999999.999))
  AND "serviceDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
);

ALTER TABLE "ClaimSourceCoverage" ADD CONSTRAINT "ClaimSourceCoverage_facts_check" CHECK (
  "sequence" BETWEEN 1 AND 9
  AND dentabill_source_token_valid("sourceCoverageId", 200)
  AND dentabill_source_token_valid("payerName", 200)
  AND dentabill_source_token_valid("payerIdentifier", 200)
  AND dentabill_source_token_valid("payerIdentifierSystem", 80)
  AND dentabill_source_token_valid("sourcePlanId", 200)
  AND dentabill_source_token_valid("sourceSubscriptionId", 200)
  AND dentabill_source_token_valid("subscriberId", 200)
  AND dentabill_source_token_valid("patientMemberId", 200)
  AND dentabill_source_token_valid("groupNumber", 200)
  AND dentabill_source_token_valid("relationship", 80)
  AND ("effectiveDate" IS NULL OR "effectiveDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
  AND ("terminationDate" IS NULL OR "terminationDate" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
  AND ("effectiveDate" IS NULL OR "terminationDate" IS NULL OR "terminationDate" >= "effectiveDate")
);

-- Only a proven source import can admit details. Equality is checked once,
-- preserving the original amount when billers later edit the local Claim.
CREATE FUNCTION dentabill_admit_claim_source_details() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Claim" c
    WHERE c.id = NEW."claimId" AND c."organizationId" = NEW."organizationId"
      AND c."sourceSystem" IS NOT NULL AND c."sourceNamespace" IS NOT NULL
      AND c."sourceClaimId" IS NOT NULL AND c."sourceContentHash" IS NOT NULL
      AND c."claimAmount" = NEW."importedClaimAmount"
  ) THEN
    RAISE EXCEPTION 'CLAIM_SOURCE_DETAILS_INVALID_PARENT' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ClaimSourceDetails_admission"
  BEFORE INSERT ON "ClaimSourceDetails" FOR EACH ROW
  EXECUTE FUNCTION dentabill_admit_claim_source_details();

-- Parent-Claim cascade deletes remain possible. Direct deletion/replacement of
-- imported evidence while the Claim exists never changes the saved snapshot.
CREATE FUNCTION dentabill_claim_source_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM "Claim" c
    WHERE c.id = OLD."claimId" AND c."organizationId" = OLD."organizationId"
  ) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'CLAIM_SOURCE_DETAILS_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "ClaimSourceDetails_immutable" BEFORE UPDATE OR DELETE ON "ClaimSourceDetails"
  FOR EACH ROW EXECUTE FUNCTION dentabill_claim_source_immutable();
CREATE TRIGGER "ClaimSourceLine_immutable" BEFORE UPDATE OR DELETE ON "ClaimSourceLine"
  FOR EACH ROW EXECUTE FUNCTION dentabill_claim_source_immutable();
CREATE TRIGGER "ClaimSourceCoverage_immutable" BEFORE UPDATE OR DELETE ON "ClaimSourceCoverage"
  FOR EACH ROW EXECUTE FUNCTION dentabill_claim_source_immutable();

-- Counts and totals are sealed at commit so the parent and complete children
-- can be admitted in one transaction. Frozen counts + immutable children also
-- reject all later additions without a mutable application-level seal flag.
CREATE FUNCTION dentabill_validate_claim_source_details() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  snapshot "ClaimSourceDetails"%ROWTYPE;
  actual_lines BIGINT;
  actual_coverages BIGINT;
  claim_coverages BIGINT;
  first_position INTEGER;
  last_position INTEGER;
  billed_total NUMERIC;
BEGIN
  SELECT * INTO snapshot FROM "ClaimSourceDetails"
    WHERE "claimId" = NEW."claimId" AND "organizationId" = NEW."organizationId";
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*), sum("billedAmount"), min("position"), max("position")
    INTO actual_lines, billed_total, first_position, last_position
    FROM "ClaimSourceLine"
    WHERE "claimId" = snapshot."claimId" AND "organizationId" = snapshot."organizationId";
  SELECT count(*), count(*) FILTER (WHERE "isClaimCoverage")
    INTO actual_coverages, claim_coverages
    FROM "ClaimSourceCoverage"
    WHERE "claimId" = snapshot."claimId" AND "organizationId" = snapshot."organizationId";

  IF actual_lines <> snapshot."lineCount" OR actual_coverages <> snapshot."coverageCount"
    OR (snapshot."lineCount" > 0 AND (
      billed_total <> snapshot."importedClaimAmount" OR first_position <> 0
      OR last_position <> snapshot."lineCount" - 1
    ))
    OR (snapshot."coverageCount" > 0 AND claim_coverages <> 1)
  THEN
    RAISE EXCEPTION 'CLAIM_SOURCE_DETAILS_INCOMPLETE' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "ClaimSourceDetails_complete"
  AFTER INSERT ON "ClaimSourceDetails" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION dentabill_validate_claim_source_details();
CREATE CONSTRAINT TRIGGER "ClaimSourceLine_complete"
  AFTER INSERT ON "ClaimSourceLine" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION dentabill_validate_claim_source_details();
CREATE CONSTRAINT TRIGGER "ClaimSourceCoverage_complete"
  AFTER INSERT ON "ClaimSourceCoverage" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION dentabill_validate_claim_source_details();

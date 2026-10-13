-- Expand only. Existing duplicates and reviewed work are retained verbatim.
-- No source identity can be inferred safely from legacy claim numbers.
ALTER TABLE "Claim"
  ADD COLUMN "sourceSystem" VARCHAR(32),
  ADD COLUMN "sourceNamespace" VARCHAR(80),
  ADD COLUMN "sourceClaimId" VARCHAR(200),
  ADD COLUMN "sourceVersion" VARCHAR(200),
  ADD COLUMN "sourceContentHash" VARCHAR(64);

ALTER TABLE "Claim" ADD CONSTRAINT "Claim_source_identity_complete" CHECK (
  ("sourceSystem" IS NULL AND "sourceNamespace" IS NULL AND "sourceClaimId" IS NULL
    AND "sourceVersion" IS NULL AND "sourceContentHash" IS NULL)
  OR
  ("sourceSystem" IS NOT NULL AND "sourceSystem" IN ('DENTRIX', 'EAGLESOFT', 'OPEN_DENTAL')
    AND "sourceNamespace" IS NOT NULL AND "sourceNamespace" ~ '^[a-z0-9][a-z0-9_-]{0,79}$'
    AND "sourceClaimId" IS NOT NULL AND length("sourceClaimId") BETWEEN 1 AND 200
    AND "sourceClaimId" = btrim("sourceClaimId") AND "sourceClaimId" !~ '[[:cntrl:]]'
    AND ("sourceVersion" IS NULL OR (length("sourceVersion") BETWEEN 1 AND 200
      AND "sourceVersion" = btrim("sourceVersion") AND "sourceVersion" !~ '[[:cntrl:]]'))
    AND "sourceContentHash" IS NOT NULL AND "sourceContentHash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "Claim_source_identity_key"
  ON "Claim" ("organizationId", "sourceSystem", "sourceNamespace", "sourceClaimId");
CREATE INDEX "Claim_organizationId_claimNumber_idx" ON "Claim" ("organizationId", "claimNumber");

-- Imported provenance is immutable even when billers change workflow state.
-- Future source reconciliation requires an explicit versioned workflow.
CREATE FUNCTION protect_claim_source_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."sourceSystem" IS NOT NULL AND
    ROW(OLD."organizationId", OLD."sourceSystem", OLD."sourceNamespace", OLD."sourceClaimId",
        OLD."sourceVersion", OLD."sourceContentHash") IS DISTINCT FROM
    ROW(NEW."organizationId", NEW."sourceSystem", NEW."sourceNamespace", NEW."sourceClaimId",
        NEW."sourceVersion", NEW."sourceContentHash") THEN
    RAISE EXCEPTION 'Imported claim provenance is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Claim_source_identity_immutable"
  BEFORE UPDATE ON "Claim" FOR EACH ROW EXECUTE FUNCTION protect_claim_source_identity();

-- CreateTable
CREATE TABLE "ClaimRemittanceEvidence" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "sourceNamespace" VARCHAR(80) NOT NULL,
    "sourceRecordId" VARCHAR(200) NOT NULL,
    "sourceDocumentId" VARCHAR(200) NOT NULL,
    "sourceVersion" VARCHAR(200),
    "kind" VARCHAR(8) NOT NULL,
    "reversesSourceRecordId" VARCHAR(200),
    "reportedAmount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimRemittanceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimRemittanceReview" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "evidenceId" UUID NOT NULL,
    "decision" VARCHAR(6) NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "reviewToken" CHAR(64) NOT NULL,
    "evidenceHash" CHAR(64) NOT NULL,
    "claimUpdatedAt" TIMESTAMP(3) NOT NULL,
    "ledgerVersion" VARCHAR(80) NOT NULL,
    "reversedEvidenceId" UUID,
    "reportedAmount" DECIMAL(10,2) NOT NULL,
    "allocationCount" INTEGER NOT NULL,
    "adjustmentCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimRemittanceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimRemittanceAllocation" (
    "id" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "sourceIndex" INTEGER NOT NULL,
    "lineId" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "ClaimRemittanceAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimRemittanceAdjustment" (
    "id" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "sourceIndex" INTEGER NOT NULL,
    "sourceAdjustmentId" VARCHAR(200) NOT NULL,
    "lineId" UUID,
    "codeSystem" VARCHAR(32) NOT NULL,
    "groupCode" VARCHAR(32),
    "reasonCode" VARCHAR(32) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "ClaimRemittanceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaimRemittanceEvidence_organizationId_claimId_createdAt_id_idx" ON "ClaimRemittanceEvidence"("organizationId", "claimId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimRemittanceEvidence_id_organizationId_claimId_key" ON "ClaimRemittanceEvidence"("id", "organizationId", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimRemittanceEvidence_source_key" ON "ClaimRemittanceEvidence"("organizationId", "sourceNamespace", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimRemittanceReview_evidenceId_key" ON "ClaimRemittanceReview"("evidenceId");

-- CreateIndex
CREATE INDEX "ClaimRemittanceReview_organizationId_claimId_createdAt_id_idx" ON "ClaimRemittanceReview"("organizationId", "claimId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ClaimRemittanceReview_reversedEvidenceId_organizationId_cla_idx" ON "ClaimRemittanceReview"("reversedEvidenceId", "organizationId", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimRemittanceReview_id_organizationId_claimId_key" ON "ClaimRemittanceReview"("id", "organizationId", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimRemittanceReview_organizationId_idempotencyKey_key" ON "ClaimRemittanceReview"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimRemittanceReview_evidenceId_organizationId_claimId_key" ON "ClaimRemittanceReview"("evidenceId", "organizationId", "claimId");

-- CreateIndex
CREATE INDEX "ClaimRemittanceAllocation_organizationId_claimId_idx" ON "ClaimRemittanceAllocation"("organizationId", "claimId");

-- CreateIndex
CREATE INDEX "ClaimRemittanceAllocation_lineId_organizationId_claimId_idx" ON "ClaimRemittanceAllocation"("lineId", "organizationId", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimRemittanceAllocation_reviewId_sourceIndex_key" ON "ClaimRemittanceAllocation"("reviewId", "sourceIndex");

-- CreateIndex
CREATE INDEX "ClaimRemittanceAdjustment_organizationId_claimId_idx" ON "ClaimRemittanceAdjustment"("organizationId", "claimId");

-- CreateIndex
CREATE INDEX "ClaimRemittanceAdjustment_lineId_organizationId_claimId_idx" ON "ClaimRemittanceAdjustment"("lineId", "organizationId", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimRemittanceAdjustment_reviewId_sourceIndex_key" ON "ClaimRemittanceAdjustment"("reviewId", "sourceIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimRemittanceAdjustment_reviewId_sourceAdjustmentId_key" ON "ClaimRemittanceAdjustment"("reviewId", "sourceAdjustmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimSourceLine_id_organizationId_claimId_key" ON "ClaimSourceLine"("id", "organizationId", "claimId");

-- AddForeignKey
ALTER TABLE "ClaimRemittanceEvidence" ADD CONSTRAINT "ClaimRemittanceEvidence_claimId_organizationId_fkey" FOREIGN KEY ("claimId", "organizationId") REFERENCES "Claim"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ClaimRemittanceReview" ADD CONSTRAINT "ClaimRemittanceReview_claimId_organizationId_fkey" FOREIGN KEY ("claimId", "organizationId") REFERENCES "Claim"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ClaimRemittanceReview" ADD CONSTRAINT "ClaimRemittanceReview_evidenceId_organizationId_claimId_fkey" FOREIGN KEY ("evidenceId", "organizationId", "claimId") REFERENCES "ClaimRemittanceEvidence"("id", "organizationId", "claimId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ClaimRemittanceReview" ADD CONSTRAINT "ClaimRemittanceReview_reversedEvidenceId_organizationId_cl_fkey" FOREIGN KEY ("reversedEvidenceId", "organizationId", "claimId") REFERENCES "ClaimRemittanceEvidence"("id", "organizationId", "claimId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ClaimRemittanceReview" ADD CONSTRAINT "ClaimRemittanceReview_reviewedByUserId_organizationId_fkey" FOREIGN KEY ("reviewedByUserId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ClaimRemittanceAllocation" ADD CONSTRAINT "ClaimRemittanceAllocation_reviewId_organizationId_claimId_fkey" FOREIGN KEY ("reviewId", "organizationId", "claimId") REFERENCES "ClaimRemittanceReview"("id", "organizationId", "claimId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ClaimRemittanceAllocation" ADD CONSTRAINT "ClaimRemittanceAllocation_lineId_organizationId_claimId_fkey" FOREIGN KEY ("lineId", "organizationId", "claimId") REFERENCES "ClaimSourceLine"("id", "organizationId", "claimId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ClaimRemittanceAdjustment" ADD CONSTRAINT "ClaimRemittanceAdjustment_reviewId_organizationId_claimId_fkey" FOREIGN KEY ("reviewId", "organizationId", "claimId") REFERENCES "ClaimRemittanceReview"("id", "organizationId", "claimId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ClaimRemittanceAdjustment" ADD CONSTRAINT "ClaimRemittanceAdjustment_lineId_organizationId_claimId_fkey" FOREIGN KEY ("lineId", "organizationId", "claimId") REFERENCES "ClaimSourceLine"("id", "organizationId", "claimId") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Additive evidence ledger only. No legacy backfill, financial posting, cash
-- confirmation, or claim status/amount mutation is performed by this migration.
CREATE FUNCTION dentabill_remittance_json_token(value JSONB, maximum INTEGER, nullable BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE((nullable AND value = 'null'::jsonb) OR (
    jsonb_typeof(value) = 'string' AND dentabill_source_token_valid(value #>> '{}', maximum)
  ), false);
$$;
CREATE FUNCTION dentabill_remittance_money(value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(jsonb_typeof(value) = 'string'
    AND (value #>> '{}') ~ '^-?(0|[1-9][0-9]{0,7})\.[0-9]{2}$'
    AND value <> '"-0.00"'::jsonb, false);
$$;
CREATE FUNCTION dentabill_remittance_object(value JSONB, keys TEXT[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(jsonb_typeof(value) = 'object' AND value ?& keys
    AND value - keys = '{}'::jsonb, false);
$$;

ALTER TABLE "ClaimRemittanceEvidence" ADD CONSTRAINT "ClaimRemittanceEvidence_shape_check" CHECK (
  "sourceNamespace" ~ '^[a-z0-9][a-z0-9_-]{0,79}$'
  AND dentabill_source_token_valid("sourceRecordId", 200)
  AND dentabill_source_token_valid("sourceDocumentId", 200)
  AND dentabill_source_token_valid("sourceVersion", 200)
  AND dentabill_source_token_valid("reversesSourceRecordId", 200)
  AND currency = 'USD' AND "contentHash" ~ '^[a-f0-9]{64}$'
  AND "reportedAmount" BETWEEN -99999999.99 AND 99999999.99
  AND ((kind = 'PAYMENT' AND "reportedAmount" >= 0 AND "reversesSourceRecordId" IS NULL)
    OR (kind = 'REVERSAL' AND "reportedAmount" <= 0 AND "reversesSourceRecordId" IS NOT NULL
      AND "reversesSourceRecordId" <> "sourceRecordId"))
);
ALTER TABLE "ClaimRemittanceReview" ADD CONSTRAINT "ClaimRemittanceReview_shape_check" CHECK (
  decision IN ('ACCEPT', 'REJECT')
  AND "requestHash" ~ '^[a-f0-9]{64}$' AND "reviewToken" ~ '^[a-f0-9]{64}$'
  AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "ledgerVersion" ~ '^[0-9]+:[0-9]+$'
  AND "reportedAmount" BETWEEN -99999999.99 AND 99999999.99
  AND "allocationCount" BETWEEN 0 AND 500 AND "adjustmentCount" BETWEEN 0 AND 500
  AND (decision <> 'REJECT' OR ("reportedAmount" = 0 AND "allocationCount" = 0
    AND "adjustmentCount" = 0 AND "reversedEvidenceId" IS NULL))
);
ALTER TABLE "ClaimRemittanceAllocation" ADD CONSTRAINT "ClaimRemittanceAllocation_shape_check" CHECK (
  "sourceIndex" BETWEEN 0 AND 499 AND amount BETWEEN -99999999.99 AND 99999999.99
);
ALTER TABLE "ClaimRemittanceAdjustment" ADD CONSTRAINT "ClaimRemittanceAdjustment_shape_check" CHECK (
  "sourceIndex" BETWEEN 0 AND 499 AND amount BETWEEN -99999999.99 AND 99999999.99
  AND dentabill_source_token_valid("sourceAdjustmentId", 200)
  AND dentabill_source_token_valid("codeSystem", 32)
  AND dentabill_source_token_valid("groupCode", 32)
  AND dentabill_source_token_valid("reasonCode", 32)
);

CREATE FUNCTION dentabill_validate_remittance_payload() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p JSONB := NEW.payload;
  item JSONB;
  key TEXT;
  allocated NUMERIC := 0;
  total NUMERIC;
  parsed_date DATE;
BEGIN
  IF NOT dentabill_remittance_object(p, ARRAY[
    'schemaVersion','sourceNamespace','sourceRecordId','sourceDocumentId','sourceVersion','kind',
    'reversesSourceRecordId','currency','reportedAmount','payerName','payerIdentifier',
    'payerIdentifierSystem','payerClaimControlNumber','sourceCoverageId','paymentTrace',
    'paymentTraceType','paymentTraceIssuer','reportedDate','sourceStatus','lineDetailCompleteness',
    'allocations','adjustments']) OR p->'schemaVersion' <> '1'::jsonb
    OR NOT dentabill_remittance_money(p->'reportedAmount')
    OR p->>'sourceNamespace' IS DISTINCT FROM NEW."sourceNamespace"
    OR p->>'sourceRecordId' IS DISTINCT FROM NEW."sourceRecordId"
    OR p->>'sourceDocumentId' IS DISTINCT FROM NEW."sourceDocumentId"
    OR p->>'sourceVersion' IS DISTINCT FROM NEW."sourceVersion"
    OR p->>'kind' IS DISTINCT FROM NEW.kind
    OR p->>'reversesSourceRecordId' IS DISTINCT FROM NEW."reversesSourceRecordId"
    OR p->>'currency' IS DISTINCT FROM NEW.currency
    OR NOT dentabill_remittance_json_token(p->'payerName',200)
    OR p->>'lineDetailCompleteness' NOT IN ('COMPLETE','PARTIAL','ABSENT')
    OR jsonb_typeof(p->'allocations') <> 'array' OR jsonb_typeof(p->'adjustments') <> 'array'
  THEN RAISE EXCEPTION 'INVALID'; END IF;
  total := (p->>'reportedAmount')::numeric;
  IF total <> NEW."reportedAmount" OR jsonb_array_length(p->'allocations') > 500
    OR jsonb_array_length(p->'adjustments') > 500 THEN RAISE EXCEPTION 'INVALID'; END IF;
  FOREACH key IN ARRAY ARRAY['sourceVersion','reversesSourceRecordId','payerIdentifier',
    'payerClaimControlNumber','sourceCoverageId','paymentTrace','paymentTraceIssuer'] LOOP
    IF NOT dentabill_remittance_json_token(p->key,200,true) THEN RAISE EXCEPTION 'INVALID'; END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['payerIdentifierSystem','paymentTraceType','sourceStatus'] LOOP
    IF NOT dentabill_remittance_json_token(p->key,80,true) THEN RAISE EXCEPTION 'INVALID'; END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['sourceNamespace','sourceRecordId','sourceDocumentId','kind','currency','lineDetailCompleteness'] LOOP
    IF jsonb_typeof(p->key) <> 'string' THEN RAISE EXCEPTION 'INVALID'; END IF;
  END LOOP;
  IF p->'reportedDate' <> 'null'::jsonb THEN
    IF jsonb_typeof(p->'reportedDate') <> 'string' OR p->>'reportedDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN RAISE EXCEPTION 'INVALID'; END IF;
    parsed_date := (p->>'reportedDate')::date;
    IF parsed_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
      OR to_char(parsed_date, 'YYYY-MM-DD') <> p->>'reportedDate' THEN RAISE EXCEPTION 'INVALID'; END IF;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p->'allocations') LOOP
    IF NOT dentabill_remittance_object(item, ARRAY['sourceLineId','amount','sourceStatus'])
      OR NOT dentabill_remittance_json_token(item->'sourceLineId',200)
      OR NOT dentabill_remittance_json_token(item->'sourceStatus',80,true)
      OR NOT dentabill_remittance_money(item->'amount') THEN RAISE EXCEPTION 'INVALID'; END IF;
    IF (NEW.kind = 'PAYMENT' AND (item->>'amount')::numeric < 0)
      OR (NEW.kind = 'REVERSAL' AND (item->>'amount')::numeric > 0) THEN RAISE EXCEPTION 'INVALID'; END IF;
    allocated := allocated + (item->>'amount')::numeric;
  END LOOP;
  IF abs(allocated) > abs(total)
    OR (p->>'lineDetailCompleteness' = 'COMPLETE' AND allocated <> total)
    OR (p->>'lineDetailCompleteness' = 'ABSENT' AND jsonb_array_length(p->'allocations') <> 0)
    OR (SELECT count(DISTINCT value->>'sourceLineId') FROM jsonb_array_elements(p->'allocations')) <> jsonb_array_length(p->'allocations')
  THEN RAISE EXCEPTION 'INVALID'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p->'adjustments') LOOP
    IF NOT dentabill_remittance_object(item, ARRAY['sourceAdjustmentId','sourceLineId','codeSystem','groupCode','reasonCode','amount','sourceReference'])
      OR NOT dentabill_remittance_json_token(item->'sourceAdjustmentId',200)
      OR NOT dentabill_remittance_json_token(item->'sourceLineId',200,true)
      OR NOT dentabill_remittance_json_token(item->'codeSystem',32)
      OR NOT dentabill_remittance_json_token(item->'groupCode',32,true)
      OR NOT dentabill_remittance_json_token(item->'reasonCode',32)
      OR NOT dentabill_remittance_json_token(item->'sourceReference',200,true)
      OR NOT dentabill_remittance_money(item->'amount') THEN RAISE EXCEPTION 'INVALID'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'sourceAdjustmentId') FROM jsonb_array_elements(p->'adjustments')) <> jsonb_array_length(p->'adjustments')
    THEN RAISE EXCEPTION 'INVALID'; END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'REMITTANCE_PAYLOAD_INVALID' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "ClaimRemittanceEvidence_payload" BEFORE INSERT ON "ClaimRemittanceEvidence"
  FOR EACH ROW EXECUTE FUNCTION dentabill_validate_remittance_payload();

CREATE FUNCTION dentabill_remittance_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'REMITTANCE_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "ClaimRemittanceEvidence_immutable" BEFORE UPDATE OR DELETE ON "ClaimRemittanceEvidence"
  FOR EACH ROW EXECUTE FUNCTION dentabill_remittance_immutable();
CREATE TRIGGER "ClaimRemittanceReview_immutable" BEFORE UPDATE OR DELETE ON "ClaimRemittanceReview"
  FOR EACH ROW EXECUTE FUNCTION dentabill_remittance_immutable();
CREATE TRIGGER "ClaimRemittanceAllocation_immutable" BEFORE UPDATE OR DELETE ON "ClaimRemittanceAllocation"
  FOR EACH ROW EXECUTE FUNCTION dentabill_remittance_immutable();
CREATE TRIGGER "ClaimRemittanceAdjustment_immutable" BEFORE UPDATE OR DELETE ON "ClaimRemittanceAdjustment"
  FOR EACH ROW EXECUTE FUNCTION dentabill_remittance_immutable();

-- A real tuple write serializes even transactions with older repeatable-read
-- snapshots. Raw SQL leaves Prisma's application-maintained updatedAt unchanged.
CREATE FUNCTION dentabill_admit_remittance_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_version TIMESTAMP(3);
  ledger_version TEXT;
BEGIN
  UPDATE "Claim" SET id = id WHERE id = NEW."claimId" AND "organizationId" = NEW."organizationId"
    RETURNING "updatedAt" INTO current_version;
  IF NOT FOUND OR current_version IS DISTINCT FROM NEW."claimUpdatedAt" THEN
    RAISE EXCEPTION 'REMITTANCE_REVIEW_STALE' USING ERRCODE = '23514';
  END IF;
  SELECT (SELECT count(*) FROM "ClaimRemittanceEvidence" WHERE "claimId" = NEW."claimId" AND "organizationId" = NEW."organizationId")::text
    || ':' || (SELECT count(*) FROM "ClaimRemittanceReview" WHERE "claimId" = NEW."claimId" AND "organizationId" = NEW."organizationId")::text
    INTO ledger_version;
  IF ledger_version IS DISTINCT FROM NEW."ledgerVersion" THEN
    RAISE EXCEPTION 'REMITTANCE_REVIEW_STALE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ClaimRemittanceReview_admission" BEFORE INSERT ON "ClaimRemittanceReview"
  FOR EACH ROW EXECUTE FUNCTION dentabill_admit_remittance_review();

CREATE FUNCTION dentabill_validate_remittance_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  review_id UUID;
  r "ClaimRemittanceReview"%ROWTYPE;
  e "ClaimRemittanceEvidence"%ROWTYPE;
  original "ClaimRemittanceEvidence"%ROWTYPE;
  original_review "ClaimRemittanceReview"%ROWTYPE;
  allocation_total NUMERIC;
  original_unallocated NUMERIC;
  reversed_unallocated NUMERIC;
  key TEXT;
BEGIN
  IF TG_TABLE_NAME = 'ClaimRemittanceReview' THEN review_id := NEW.id;
  ELSE review_id := NEW."reviewId"; END IF;
  SELECT * INTO STRICT r FROM "ClaimRemittanceReview"
    WHERE id = review_id AND "organizationId" = NEW."organizationId" AND "claimId" = NEW."claimId";
  SELECT * INTO STRICT e FROM "ClaimRemittanceEvidence"
    WHERE id = r."evidenceId" AND "organizationId" = r."organizationId" AND "claimId" = r."claimId";
  IF r."evidenceHash" <> e."contentHash"
    OR (SELECT count(*) FROM "ClaimRemittanceAllocation" WHERE "reviewId" = r.id AND "organizationId" = r."organizationId" AND "claimId" = r."claimId") <> r."allocationCount"
    OR (SELECT count(*) FROM "ClaimRemittanceAdjustment" WHERE "reviewId" = r.id AND "organizationId" = r."organizationId" AND "claimId" = r."claimId") <> r."adjustmentCount"
  THEN RAISE EXCEPTION 'REMITTANCE_REVIEW_INCOMPLETE' USING ERRCODE = '23514'; END IF;
  IF r.decision = 'REJECT' THEN RETURN NULL; END IF;

  IF r."reportedAmount" <> e."reportedAmount"
    OR r."allocationCount" <> jsonb_array_length(e.payload->'allocations')
    OR r."adjustmentCount" <> jsonb_array_length(e.payload->'adjustments')
    OR (e.payload->>'sourceCoverageId' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "ClaimSourceCoverage" WHERE "claimId" = r."claimId" AND "organizationId" = r."organizationId"
        AND "sourceCoverageId" = e.payload->>'sourceCoverageId'
    ))
    OR EXISTS (
      SELECT 1 FROM "ClaimRemittanceAllocation" a JOIN "ClaimSourceLine" l
        ON l.id = a."lineId" AND l."organizationId" = a."organizationId" AND l."claimId" = a."claimId"
      WHERE a."reviewId" = r.id AND a."organizationId" = r."organizationId" AND a."claimId" = r."claimId"
        AND (l."sourceLineId" IS DISTINCT FROM e.payload->'allocations'->a."sourceIndex"->>'sourceLineId'
          OR a.amount IS DISTINCT FROM (e.payload->'allocations'->a."sourceIndex"->>'amount')::numeric)
    ) OR EXISTS (
      SELECT 1 FROM "ClaimRemittanceAdjustment" a LEFT JOIN "ClaimSourceLine" l
        ON l.id = a."lineId" AND l."organizationId" = a."organizationId" AND l."claimId" = a."claimId"
      WHERE a."reviewId" = r.id AND a."organizationId" = r."organizationId" AND a."claimId" = r."claimId"
        AND (a."sourceAdjustmentId" IS DISTINCT FROM e.payload->'adjustments'->a."sourceIndex"->>'sourceAdjustmentId'
          OR l."sourceLineId" IS DISTINCT FROM e.payload->'adjustments'->a."sourceIndex"->>'sourceLineId'
          OR a."codeSystem" IS DISTINCT FROM e.payload->'adjustments'->a."sourceIndex"->>'codeSystem'
          OR a."groupCode" IS DISTINCT FROM e.payload->'adjustments'->a."sourceIndex"->>'groupCode'
          OR a."reasonCode" IS DISTINCT FROM e.payload->'adjustments'->a."sourceIndex"->>'reasonCode'
          OR a.amount IS DISTINCT FROM (e.payload->'adjustments'->a."sourceIndex"->>'amount')::numeric)
    )
  THEN RAISE EXCEPTION 'REMITTANCE_REVIEW_PAYLOAD_MISMATCH' USING ERRCODE = '23514'; END IF;
  SELECT COALESCE(sum(amount),0) INTO allocation_total FROM "ClaimRemittanceAllocation"
    WHERE "reviewId" = r.id AND "organizationId" = r."organizationId" AND "claimId" = r."claimId";
  IF abs(allocation_total) > abs(r."reportedAmount") THEN
    RAISE EXCEPTION 'REMITTANCE_ALLOCATION_EXCEEDS_AMOUNT' USING ERRCODE = '23514';
  END IF;
  IF e.kind = 'PAYMENT' THEN
    IF r."reversedEvidenceId" IS NOT NULL THEN
      RAISE EXCEPTION 'REMITTANCE_REVERSAL_TARGET_INVALID' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;

  SELECT * INTO original FROM "ClaimRemittanceEvidence"
    WHERE id = r."reversedEvidenceId" AND "organizationId" = r."organizationId" AND "claimId" = r."claimId"
      AND kind = 'PAYMENT' AND "sourceNamespace" = e."sourceNamespace"
      AND "sourceRecordId" = e."reversesSourceRecordId";
  IF NOT FOUND THEN RAISE EXCEPTION 'REMITTANCE_REVERSAL_TARGET_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT * INTO original_review FROM "ClaimRemittanceReview"
    WHERE "evidenceId" = original.id AND "organizationId" = r."organizationId" AND "claimId" = r."claimId" AND decision = 'ACCEPT';
  IF NOT FOUND THEN RAISE EXCEPTION 'REMITTANCE_REVERSAL_TARGET_INVALID' USING ERRCODE = '23514'; END IF;
  FOREACH key IN ARRAY ARRAY['sourceCoverageId','payerIdentifier','payerIdentifierSystem','payerName'] LOOP
    IF e.payload->key IS DISTINCT FROM original.payload->key THEN
      RAISE EXCEPTION 'REMITTANCE_REVERSAL_TARGET_INVALID' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF original_review."reportedAmount" + (
    SELECT COALESCE(sum("reportedAmount"),0) FROM "ClaimRemittanceReview"
    WHERE "reversedEvidenceId" = original.id AND "organizationId" = r."organizationId"
      AND "claimId" = r."claimId" AND decision = 'ACCEPT'
  ) < 0 THEN RAISE EXCEPTION 'REMITTANCE_REVERSAL_EXCEEDS_REMAINING' USING ERRCODE = '23514'; END IF;

  -- Unallocated evidence is a separate component, never inferred onto a line.
  SELECT original_review."reportedAmount" - COALESCE(sum(amount),0) INTO original_unallocated
    FROM "ClaimRemittanceAllocation" WHERE "reviewId" = original_review.id
      AND "organizationId" = r."organizationId" AND "claimId" = r."claimId";
  SELECT COALESCE(sum(rv."reportedAmount" - COALESCE((
      SELECT sum(a.amount) FROM "ClaimRemittanceAllocation" a
      WHERE a."reviewId" = rv.id AND a."organizationId" = r."organizationId" AND a."claimId" = r."claimId"
    ),0)),0) INTO reversed_unallocated
    FROM "ClaimRemittanceReview" rv WHERE rv."reversedEvidenceId" = original.id
      AND rv."organizationId" = r."organizationId" AND rv."claimId" = r."claimId" AND rv.decision = 'ACCEPT';
  IF original_unallocated + reversed_unallocated < 0 THEN
    RAISE EXCEPTION 'REMITTANCE_REVERSAL_EXCEEDS_REMAINING' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ClaimRemittanceAllocation" a
    LEFT JOIN "ClaimRemittanceAllocation" oa ON oa."reviewId" = original_review.id
      AND oa."lineId" = a."lineId" AND oa."organizationId" = r."organizationId" AND oa."claimId" = r."claimId"
    WHERE a."reviewId" = r.id AND a."organizationId" = r."organizationId" AND a."claimId" = r."claimId"
      AND (oa.id IS NULL OR oa.amount + (
        SELECT COALESCE(sum(ra.amount),0) FROM "ClaimRemittanceAllocation" ra JOIN "ClaimRemittanceReview" rr
          ON rr.id = ra."reviewId" AND rr."organizationId" = ra."organizationId" AND rr."claimId" = ra."claimId"
        WHERE rr."reversedEvidenceId" = original.id AND rr.decision = 'ACCEPT'
          AND ra."organizationId" = r."organizationId" AND ra."claimId" = r."claimId" AND ra."lineId" = a."lineId"
      ) < 0)
  ) THEN RAISE EXCEPTION 'REMITTANCE_REVERSAL_EXCEEDS_REMAINING' USING ERRCODE = '23514'; END IF;

  IF EXISTS (
    SELECT 1 FROM "ClaimRemittanceAdjustment" a
    LEFT JOIN "ClaimRemittanceAdjustment" oa ON oa."reviewId" = original_review.id
      AND oa."sourceAdjustmentId" = a."sourceAdjustmentId" AND oa."organizationId" = r."organizationId" AND oa."claimId" = r."claimId"
    WHERE a."reviewId" = r.id AND a."organizationId" = r."organizationId" AND a."claimId" = r."claimId"
      AND (oa.id IS NULL OR oa."lineId" IS DISTINCT FROM a."lineId" OR oa."codeSystem" <> a."codeSystem"
        OR oa."groupCode" IS DISTINCT FROM a."groupCode" OR oa."reasonCode" <> a."reasonCode"
        OR (oa.amount = 0 AND a.amount <> 0) OR (oa.amount > 0 AND a.amount > 0) OR (oa.amount < 0 AND a.amount < 0)
        OR abs((SELECT COALESCE(sum(ra.amount),0) FROM "ClaimRemittanceAdjustment" ra JOIN "ClaimRemittanceReview" rr
          ON rr.id = ra."reviewId" AND rr."organizationId" = ra."organizationId" AND rr."claimId" = ra."claimId"
          WHERE rr."reversedEvidenceId" = original.id AND rr.decision = 'ACCEPT'
            AND ra."organizationId" = r."organizationId" AND ra."claimId" = r."claimId"
            AND ra."sourceAdjustmentId" = a."sourceAdjustmentId")) > abs(oa.amount))
  ) THEN RAISE EXCEPTION 'REMITTANCE_REVERSAL_ADJUSTMENT_INVALID' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "ClaimRemittanceReview_complete" AFTER INSERT ON "ClaimRemittanceReview"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentabill_validate_remittance_review();
CREATE CONSTRAINT TRIGGER "ClaimRemittanceAllocation_complete" AFTER INSERT ON "ClaimRemittanceAllocation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentabill_validate_remittance_review();
CREATE CONSTRAINT TRIGGER "ClaimRemittanceAdjustment_complete" AFTER INSERT ON "ClaimRemittanceAdjustment"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentabill_validate_remittance_review();

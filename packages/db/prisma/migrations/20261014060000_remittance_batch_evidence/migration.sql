BEGIN;

-- CreateTable
CREATE TABLE "RemittanceBatchEvidence" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceNamespace" VARCHAR(80) NOT NULL,
    "sourceBatchId" VARCHAR(200) NOT NULL,
    "sourceRecordId" VARCHAR(200) NOT NULL,
    "sourceDocumentId" VARCHAR(200) NOT NULL,
    "sourceVersion" VARCHAR(200),
    "detailCompleteness" VARCHAR(8) NOT NULL,
    "reportedClaimAmount" DECIMAL(10,2),
    "reportedAdjustmentAmount" DECIMAL(10,2),
    "reportedNetAmount" DECIMAL(10,2),
    "payload" JSONB NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemittanceBatchEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemittanceBatchReview" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "evidenceId" UUID NOT NULL,
    "decision" VARCHAR(6) NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "reviewedByRole" "UserRole" NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "reviewToken" CHAR(64) NOT NULL,
    "evidenceHash" CHAR(64) NOT NULL,
    "ledgerVersion" VARCHAR(80) NOT NULL,
    "claimReportedAmount" DECIMAL(14,2),
    "providerAdjustmentAmount" DECIMAL(14,2),
    "netAmount" DECIMAL(14,2),
    "claimCount" INTEGER NOT NULL,
    "adjustmentCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemittanceBatchReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemittanceBatchClaim" (
    "id" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchEvidenceId" UUID NOT NULL,
    "sourceIndex" INTEGER NOT NULL,
    "claimId" TEXT NOT NULL,
    "remittanceEvidenceId" UUID NOT NULL,
    "remittanceReviewId" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "RemittanceBatchClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemittanceBatchAdjustment" (
    "id" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceIndex" INTEGER NOT NULL,
    "sourceAdjustmentId" VARCHAR(200) NOT NULL,
    "codeSystem" VARCHAR(32) NOT NULL,
    "reasonCode" VARCHAR(32) NOT NULL,
    "sourceReference" VARCHAR(200),
    "providerIdentifier" VARCHAR(200),
    "fiscalPeriodEnd" DATE,
    "amount" DECIMAL(10,2) NOT NULL,
    "sourceAmount" DECIMAL(10,2) NOT NULL,
    "sourceSignConvention" VARCHAR(20) NOT NULL,

    CONSTRAINT "RemittanceBatchAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemittanceBatchEvidence_organizationId_createdAt_id_idx" ON "RemittanceBatchEvidence"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchEvidence_id_organizationId_key" ON "RemittanceBatchEvidence"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchEvidence_batch_key" ON "RemittanceBatchEvidence"("organizationId", "sourceNamespace", "sourceBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchEvidence_source_key" ON "RemittanceBatchEvidence"("organizationId", "sourceNamespace", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchReview_evidenceId_key" ON "RemittanceBatchReview"("evidenceId");

-- CreateIndex
CREATE INDEX "RemittanceBatchReview_organizationId_createdAt_id_idx" ON "RemittanceBatchReview"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchReview_id_organizationId_key" ON "RemittanceBatchReview"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchReview_binding_key" ON "RemittanceBatchReview"("id", "organizationId", "evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchReview_evidenceId_organizationId_key" ON "RemittanceBatchReview"("evidenceId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchReview_organizationId_idempotencyKey_key" ON "RemittanceBatchReview"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "RemittanceBatchClaim_organizationId_claimId_idx" ON "RemittanceBatchClaim"("organizationId", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchClaim_reviewId_sourceIndex_key" ON "RemittanceBatchClaim"("reviewId", "sourceIndex");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchClaim_member_key" ON "RemittanceBatchClaim"("organizationId", "remittanceEvidenceId");

-- CreateIndex
CREATE INDEX "RemittanceBatchAdjustment_organizationId_idx" ON "RemittanceBatchAdjustment"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchAdjustment_reviewId_sourceIndex_key" ON "RemittanceBatchAdjustment"("reviewId", "sourceIndex");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchAdjustment_reviewId_sourceAdjustmentId_key" ON "RemittanceBatchAdjustment"("reviewId", "sourceAdjustmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimRemittanceReview_batch_binding_key" ON "ClaimRemittanceReview"("id", "organizationId", "claimId", "evidenceId");

-- AddForeignKey
ALTER TABLE "RemittanceBatchEvidence" ADD CONSTRAINT "RemittanceBatchEvidence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RemittanceBatchReview" ADD CONSTRAINT "RemittanceBatchReview_evidenceId_organizationId_fkey" FOREIGN KEY ("evidenceId", "organizationId") REFERENCES "RemittanceBatchEvidence"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RemittanceBatchReview" ADD CONSTRAINT "RemittanceBatchReview_reviewedByUserId_organizationId_fkey" FOREIGN KEY ("reviewedByUserId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RemittanceBatchClaim" ADD CONSTRAINT "RemittanceBatchClaim_reviewId_organizationId_batchEvidence_fkey" FOREIGN KEY ("reviewId", "organizationId", "batchEvidenceId") REFERENCES "RemittanceBatchReview"("id", "organizationId", "evidenceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RemittanceBatchClaim" ADD CONSTRAINT "RemittanceBatchClaim_batchEvidenceId_organizationId_fkey" FOREIGN KEY ("batchEvidenceId", "organizationId") REFERENCES "RemittanceBatchEvidence"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RemittanceBatchClaim" ADD CONSTRAINT "RemittanceBatchClaim_claimId_organizationId_fkey" FOREIGN KEY ("claimId", "organizationId") REFERENCES "Claim"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RemittanceBatchClaim" ADD CONSTRAINT "RemittanceBatchClaim_remittanceEvidenceId_organizationId_c_fkey" FOREIGN KEY ("remittanceEvidenceId", "organizationId", "claimId") REFERENCES "ClaimRemittanceEvidence"("id", "organizationId", "claimId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RemittanceBatchClaim" ADD CONSTRAINT "RemittanceBatchClaim_remittanceReviewId_organizationId_cla_fkey" FOREIGN KEY ("remittanceReviewId", "organizationId", "claimId", "remittanceEvidenceId") REFERENCES "ClaimRemittanceReview"("id", "organizationId", "claimId", "evidenceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RemittanceBatchAdjustment" ADD CONSTRAINT "RemittanceBatchAdjustment_reviewId_organizationId_fkey" FOREIGN KEY ("reviewId", "organizationId") REFERENCES "RemittanceBatchReview"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Additive evidence only; no existing ledger rows, source helpers or financial state change.
CREATE FUNCTION dentabill_batch_token_valid(value TEXT, maximum INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  characters INTEGER := char_length(value);
  units INTEGER := 0;
  position INTEGER;
  codepoint INTEGER;
BEGIN
  IF value IS NULL OR maximum IS NULL OR characters < 1 OR characters > maximum THEN
    RETURN false;
  END IF;
  FOR position IN 1..characters LOOP
    codepoint := ascii(substr(value,position,1));
    units := units + CASE WHEN codepoint > 65535 THEN 2 ELSE 1 END;
    IF units > maximum THEN RETURN false; END IF;
    IF codepoint BETWEEN 0 AND 31 OR codepoint BETWEEN 127 AND 159
      OR codepoint BETWEEN 55296 AND 57343
      OR codepoint IN (173,1564,1757,1807,2274,6158,65279,69821,69837,917505)
      OR codepoint BETWEEN 1536 AND 1541 OR codepoint BETWEEN 2192 AND 2193
      OR codepoint BETWEEN 8203 AND 8207 OR codepoint BETWEEN 8234 AND 8238
      OR codepoint BETWEEN 8288 AND 8292 OR codepoint BETWEEN 8294 AND 8303
      OR codepoint BETWEEN 65529 AND 65531 OR codepoint BETWEEN 78896 AND 78911
      OR codepoint BETWEEN 113824 AND 113827 OR codepoint BETWEEN 119155 AND 119162
      OR codepoint BETWEEN 917536 AND 917631
    THEN RETURN false; END IF;
    -- Cc/Cf above already rejects tab, CR/LF and BOM anywhere. Remaining JS
    -- whitespace is allowed internally but never at a token's edges.
    IF position IN (1,characters) AND (
      codepoint IN (32,160,5760,8232,8233,8239,8287,12288)
      OR codepoint BETWEEN 8192 AND 8202
    ) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE FUNCTION dentabill_batch_json_token(value JSONB, maximum INTEGER, allow_null BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE((allow_null AND value = 'null'::jsonb)
    OR (jsonb_typeof(value) = 'string' AND dentabill_batch_token_valid(value #>> '{}',maximum)),false);
$$;

CREATE FUNCTION dentabill_batch_json_date(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE parsed DATE;
BEGIN
  IF value = 'null'::jsonb THEN RETURN true; END IF;
  IF value IS NULL OR jsonb_typeof(value) <> 'string'
    OR value #>> '{}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
  parsed := (value #>> '{}')::date;
  RETURN parsed BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
    AND to_char(parsed,'YYYY-MM-DD') = value #>> '{}';
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

ALTER TABLE "RemittanceBatchEvidence" ADD CONSTRAINT "RemittanceBatchEvidence_shape_check" CHECK (
  "sourceNamespace" ~ '^[a-z0-9][a-z0-9_-]{0,79}$'
  AND dentabill_batch_token_valid("sourceBatchId",200)
  AND dentabill_batch_token_valid("sourceRecordId",200)
  AND dentabill_batch_token_valid("sourceDocumentId",200)
  AND ("sourceVersion" IS NULL OR dentabill_batch_token_valid("sourceVersion",200))
  AND "detailCompleteness" IN ('COMPLETE','PARTIAL','ABSENT')
  AND "contentHash" ~ '^[a-f0-9]{64}$' AND octet_length(payload::text) <= 262144
);
ALTER TABLE "RemittanceBatchReview" ADD CONSTRAINT "RemittanceBatchReview_shape_check" CHECK (
  decision IN ('ACCEPT','REJECT') AND "reviewedByRole" IN ('OWNER','ADMIN','BILLING_STAFF')
  AND "requestHash" ~ '^[a-f0-9]{64}$' AND "reviewToken" ~ '^[a-f0-9]{64}$'
  AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "ledgerVersion" ~ '^[0-9]+:[0-9]+$'
  AND "claimCount" BETWEEN 0 AND 100 AND "adjustmentCount" BETWEEN 0 AND 100
  AND ((decision = 'REJECT' AND "claimReportedAmount" IS NULL AND "providerAdjustmentAmount" IS NULL
      AND "netAmount" IS NULL AND "claimCount" = 0 AND "adjustmentCount" = 0)
    OR (decision = 'ACCEPT' AND "claimReportedAmount" IS NOT NULL AND "providerAdjustmentAmount" IS NOT NULL AND "netAmount" IS NOT NULL))
);
ALTER TABLE "RemittanceBatchClaim" ADD CONSTRAINT "RemittanceBatchClaim_shape_check" CHECK (
  "sourceIndex" BETWEEN 0 AND 99 AND amount BETWEEN -99999999.99 AND 99999999.99
);
ALTER TABLE "RemittanceBatchAdjustment" ADD CONSTRAINT "RemittanceBatchAdjustment_shape_check" CHECK (
  "sourceIndex" BETWEEN 0 AND 99 AND amount BETWEEN -99999999.99 AND 99999999.99
  AND "sourceAmount" BETWEEN -99999999.99 AND 99999999.99
  AND dentabill_batch_token_valid("sourceAdjustmentId",200)
  AND dentabill_batch_token_valid("codeSystem",32) AND dentabill_batch_token_valid("reasonCode",32)
  AND ("sourceReference" IS NULL OR dentabill_batch_token_valid("sourceReference",200))
  AND ("providerIdentifier" IS NULL OR dentabill_batch_token_valid("providerIdentifier",200))
  AND ("fiscalPeriodEnd" IS NULL OR "fiscalPeriodEnd" BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
  AND (("sourceSignConvention" = 'REDUCTION_POSITIVE' AND amount = -"sourceAmount")
    OR ("sourceSignConvention" = 'NET_EFFECT_POSITIVE' AND amount = "sourceAmount"))
);

CREATE FUNCTION dentabill_batch_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'REMITTANCE_BATCH_IMMUTABLE' USING ERRCODE = '23514'; END;
$$;
CREATE TRIGGER "RemittanceBatchEvidence_immutable" BEFORE UPDATE OR DELETE ON "RemittanceBatchEvidence"
  FOR EACH ROW EXECUTE FUNCTION dentabill_batch_immutable();
CREATE TRIGGER "RemittanceBatchReview_immutable" BEFORE UPDATE OR DELETE ON "RemittanceBatchReview"
  FOR EACH ROW EXECUTE FUNCTION dentabill_batch_immutable();
CREATE TRIGGER "RemittanceBatchClaim_immutable" BEFORE UPDATE OR DELETE ON "RemittanceBatchClaim"
  FOR EACH ROW EXECUTE FUNCTION dentabill_batch_immutable();
CREATE TRIGGER "RemittanceBatchAdjustment_immutable" BEFORE UPDATE OR DELETE ON "RemittanceBatchAdjustment"
  FOR EACH ROW EXECUTE FUNCTION dentabill_batch_immutable();

CREATE FUNCTION dentabill_admit_batch_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p JSONB := NEW.payload; item JSONB; key TEXT;
BEGIN
  -- Tuple writes make stale repeatable-read transactions fail and leave updatedAt unchanged.
  UPDATE "Organization" SET id = id WHERE id = NEW."organizationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'REMITTANCE_BATCH_ORGANIZATION_INVALID' USING ERRCODE = '23514'; END IF;
  BEGIN
    IF NOT dentabill_remittance_object(p,ARRAY['schemaVersion','evidenceBasis','sourceNamespace','sourceBatchId',
      'sourceRecordId','sourceDocumentId','sourceVersion','payerName','payerIdentifier','payerIdentifierSystem',
      'payeeIdentifier','payeeIdentifierSystem','currency','paymentTrace','paymentTraceType','paymentTraceIssuer',
      'reportedDate','sourceStatus','detailCompleteness','reportedClaimAmount','reportedAdjustmentAmount',
      'reportedNetAmount','claimRemittances','providerAdjustments'])
      OR p->'schemaVersion' IS DISTINCT FROM '1'::jsonb
      OR p->'evidenceBasis' IS DISTINCT FROM '"PAYER_REMITTANCE_BATCH"'::jsonb
      OR p->'currency' IS DISTINCT FROM '"USD"'::jsonb
      OR p->>'sourceNamespace' IS DISTINCT FROM NEW."sourceNamespace"
      OR p->>'sourceBatchId' IS DISTINCT FROM NEW."sourceBatchId"
      OR p->>'sourceRecordId' IS DISTINCT FROM NEW."sourceRecordId"
      OR p->>'sourceDocumentId' IS DISTINCT FROM NEW."sourceDocumentId"
      OR p->>'sourceVersion' IS DISTINCT FROM NEW."sourceVersion"
      OR p->>'detailCompleteness' IS DISTINCT FROM NEW."detailCompleteness"
      OR NOT dentabill_batch_json_date(p->'reportedDate')
      OR jsonb_typeof(p->'claimRemittances') IS DISTINCT FROM 'array'
      OR jsonb_typeof(p->'providerAdjustments') IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'INVALID'; END IF;
    FOREACH key IN ARRAY ARRAY['sourceBatchId','sourceRecordId','sourceDocumentId','payerName'] LOOP
      IF NOT dentabill_batch_json_token(p->key,200) THEN RAISE EXCEPTION 'INVALID'; END IF;
    END LOOP;
    FOREACH key IN ARRAY ARRAY['sourceVersion','payerIdentifier','payeeIdentifier','paymentTrace','paymentTraceIssuer'] LOOP
      IF NOT dentabill_batch_json_token(p->key,200,true) THEN RAISE EXCEPTION 'INVALID'; END IF;
    END LOOP;
    FOREACH key IN ARRAY ARRAY['payerIdentifierSystem','payeeIdentifierSystem','paymentTraceType','sourceStatus'] LOOP
      IF NOT dentabill_batch_json_token(p->key,80,true) THEN RAISE EXCEPTION 'INVALID'; END IF;
    END LOOP;
    FOREACH key IN ARRAY ARRAY['sourceNamespace','detailCompleteness'] LOOP
      IF jsonb_typeof(p->key) <> 'string' THEN RAISE EXCEPTION 'INVALID'; END IF;
    END LOOP;
    FOREACH key IN ARRAY ARRAY['reportedClaimAmount','reportedAdjustmentAmount','reportedNetAmount'] LOOP
      IF p->key <> 'null'::jsonb AND NOT dentabill_remittance_money(p->key) THEN RAISE EXCEPTION 'INVALID'; END IF;
    END LOOP;
    IF (p->>'reportedClaimAmount')::numeric IS DISTINCT FROM NEW."reportedClaimAmount"
      OR (p->>'reportedAdjustmentAmount')::numeric IS DISTINCT FROM NEW."reportedAdjustmentAmount"
      OR (p->>'reportedNetAmount')::numeric IS DISTINCT FROM NEW."reportedNetAmount"
      OR jsonb_array_length(p->'claimRemittances') > 100 OR jsonb_array_length(p->'providerAdjustments') > 100
      OR (NEW."detailCompleteness" = 'ABSENT' AND (jsonb_array_length(p->'claimRemittances') <> 0 OR jsonb_array_length(p->'providerAdjustments') <> 0))
    THEN RAISE EXCEPTION 'INVALID'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p->'claimRemittances') LOOP
      IF NOT dentabill_remittance_object(item,ARRAY['sourceNamespace','sourceRecordId','reportedAmount'])
        OR NOT dentabill_batch_json_token(item->'sourceNamespace',80)
        OR item->>'sourceNamespace' !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
        OR NOT dentabill_batch_json_token(item->'sourceRecordId',200)
        OR NOT dentabill_remittance_money(item->'reportedAmount') THEN RAISE EXCEPTION 'INVALID'; END IF;
    END LOOP;
    IF (SELECT count(DISTINCT (value->>'sourceNamespace',value->>'sourceRecordId')) FROM jsonb_array_elements(p->'claimRemittances')) <> jsonb_array_length(p->'claimRemittances') THEN RAISE EXCEPTION 'INVALID'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p->'providerAdjustments') LOOP
      IF NOT dentabill_remittance_object(item,ARRAY['sourceAdjustmentId','codeSystem','reasonCode','sourceReference','providerIdentifier','fiscalPeriodEnd','amount','sourceAmount','sourceSignConvention'])
        OR NOT dentabill_batch_json_token(item->'sourceAdjustmentId',200)
        OR NOT dentabill_batch_json_token(item->'codeSystem',32)
        OR NOT dentabill_batch_json_token(item->'reasonCode',32)
        OR NOT dentabill_batch_json_token(item->'sourceReference',200,true)
        OR NOT dentabill_batch_json_token(item->'providerIdentifier',200,true)
        OR NOT dentabill_batch_json_date(item->'fiscalPeriodEnd')
        OR NOT dentabill_remittance_money(item->'amount') OR NOT dentabill_remittance_money(item->'sourceAmount')
        OR item->'sourceSignConvention' NOT IN ('"REDUCTION_POSITIVE"'::jsonb,'"NET_EFFECT_POSITIVE"'::jsonb)
      THEN RAISE EXCEPTION 'INVALID'; END IF;
      IF (item->>'amount')::numeric <> (CASE WHEN item->>'sourceSignConvention' = 'REDUCTION_POSITIVE'
        THEN -(item->>'sourceAmount')::numeric ELSE (item->>'sourceAmount')::numeric END) THEN RAISE EXCEPTION 'INVALID'; END IF;
    END LOOP;
    IF (SELECT count(DISTINCT value->>'sourceAdjustmentId') FROM jsonb_array_elements(p->'providerAdjustments')) <> jsonb_array_length(p->'providerAdjustments') THEN RAISE EXCEPTION 'INVALID'; END IF;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'REMITTANCE_BATCH_PAYLOAD_INVALID' USING ERRCODE = '23514'; END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "RemittanceBatchEvidence_admission" BEFORE INSERT ON "RemittanceBatchEvidence"
  FOR EACH ROW EXECUTE FUNCTION dentabill_admit_batch_evidence();

CREATE FUNCTION dentabill_admit_batch_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e "RemittanceBatchEvidence"%ROWTYPE; actor_role "UserRole"; expected_ledger TEXT;
BEGIN
  UPDATE "Organization" SET id = id WHERE id = NEW."organizationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'REMITTANCE_BATCH_ORGANIZATION_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT role INTO actor_role FROM "User" WHERE id = NEW."reviewedByUserId" AND "organizationId" = NEW."organizationId" FOR SHARE;
  IF NOT FOUND OR actor_role IS DISTINCT FROM NEW."reviewedByRole" THEN
    RAISE EXCEPTION 'REMITTANCE_BATCH_REVIEW_ACTOR_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT * INTO e FROM "RemittanceBatchEvidence" WHERE id = NEW."evidenceId" AND "organizationId" = NEW."organizationId";
  IF NOT FOUND OR e."contentHash" <> NEW."evidenceHash" THEN
    RAISE EXCEPTION 'REMITTANCE_BATCH_REVIEW_BINDING_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT (SELECT count(*) FROM "RemittanceBatchEvidence" WHERE "organizationId" = NEW."organizationId")::text || ':' ||
    (SELECT count(*) FROM "RemittanceBatchReview" WHERE "organizationId" = NEW."organizationId")::text INTO expected_ledger;
  IF expected_ledger IS DISTINCT FROM NEW."ledgerVersion" THEN
    RAISE EXCEPTION 'REMITTANCE_BATCH_REVIEW_STALE' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "RemittanceBatchReview_admission" BEFORE INSERT ON "RemittanceBatchReview"
  FOR EACH ROW EXECUTE FUNCTION dentabill_admit_batch_review();

CREATE FUNCTION dentabill_admit_batch_child() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Organization" SET id = id WHERE id = NEW."organizationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'REMITTANCE_BATCH_ORGANIZATION_INVALID' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "RemittanceBatchClaim_admission" BEFORE INSERT ON "RemittanceBatchClaim"
  FOR EACH ROW EXECUTE FUNCTION dentabill_admit_batch_child();
CREATE TRIGGER "RemittanceBatchAdjustment_admission" BEFORE INSERT ON "RemittanceBatchAdjustment"
  FOR EACH ROW EXECUTE FUNCTION dentabill_admit_batch_child();

CREATE FUNCTION dentabill_seal_batch_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE review_id UUID; r "RemittanceBatchReview"%ROWTYPE; e "RemittanceBatchEvidence"%ROWTYPE;
  claim_total NUMERIC; adjustment_total NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'RemittanceBatchReview' THEN review_id := NEW.id; ELSE review_id := NEW."reviewId"; END IF;
  SELECT * INTO STRICT r FROM "RemittanceBatchReview" WHERE id = review_id AND "organizationId" = NEW."organizationId";
  SELECT * INTO STRICT e FROM "RemittanceBatchEvidence" WHERE id = r."evidenceId" AND "organizationId" = r."organizationId";
  IF (SELECT count(*) FROM "RemittanceBatchClaim" WHERE "reviewId" = r.id AND "organizationId" = r."organizationId") <> r."claimCount"
    OR (SELECT count(*) FROM "RemittanceBatchAdjustment" WHERE "reviewId" = r.id AND "organizationId" = r."organizationId") <> r."adjustmentCount"
  THEN RAISE EXCEPTION 'REMITTANCE_BATCH_REVIEW_INCOMPLETE' USING ERRCODE = '23514'; END IF;
  IF r.decision = 'REJECT' THEN RETURN NULL; END IF;
  SELECT COALESCE(sum((value->>'reportedAmount')::numeric),0) INTO claim_total FROM jsonb_array_elements(e.payload->'claimRemittances');
  SELECT COALESCE(sum((value->>'amount')::numeric),0) INTO adjustment_total FROM jsonb_array_elements(e.payload->'providerAdjustments');
  IF e."detailCompleteness" <> 'COMPLETE' OR e."reportedClaimAmount" IS NULL
    OR e."reportedAdjustmentAmount" IS NULL OR e."reportedNetAmount" IS NULL
    OR e."reportedClaimAmount" <> claim_total OR e."reportedAdjustmentAmount" <> adjustment_total
    OR e."reportedNetAmount" <> claim_total + adjustment_total
    OR r."claimReportedAmount" IS DISTINCT FROM claim_total OR r."providerAdjustmentAmount" IS DISTINCT FROM adjustment_total
    OR r."netAmount" IS DISTINCT FROM claim_total + adjustment_total
    OR r."claimCount" <> jsonb_array_length(e.payload->'claimRemittances')
    OR r."adjustmentCount" <> jsonb_array_length(e.payload->'providerAdjustments')
  THEN RAISE EXCEPTION 'REMITTANCE_BATCH_TOTALS_INVALID' USING ERRCODE = '23514'; END IF;
  -- Unique bounded sourceIndex plus full counts and exact source mirroring seals every index.
  IF EXISTS (
    SELECT 1 FROM "RemittanceBatchClaim" m
    JOIN "ClaimRemittanceEvidence" ce ON ce.id = m."remittanceEvidenceId" AND ce."organizationId" = m."organizationId" AND ce."claimId" = m."claimId"
    JOIN "ClaimRemittanceReview" cr ON cr.id = m."remittanceReviewId" AND cr."evidenceId" = ce.id AND cr."organizationId" = m."organizationId" AND cr."claimId" = m."claimId"
    WHERE m."reviewId" = r.id AND m."organizationId" = r."organizationId" AND (
      cr.decision <> 'ACCEPT' OR cr."reportedAmount" <> ce."reportedAmount" OR m.amount <> ce."reportedAmount"
      OR ce."sourceNamespace" IS DISTINCT FROM e.payload->'claimRemittances'->m."sourceIndex"->>'sourceNamespace'
      OR ce."sourceRecordId" IS DISTINCT FROM e.payload->'claimRemittances'->m."sourceIndex"->>'sourceRecordId'
      OR m.amount IS DISTINCT FROM (e.payload->'claimRemittances'->m."sourceIndex"->>'reportedAmount')::numeric)
  ) OR EXISTS (
    SELECT 1 FROM "RemittanceBatchAdjustment" a WHERE a."reviewId" = r.id AND a."organizationId" = r."organizationId" AND (
      a."sourceAdjustmentId" IS DISTINCT FROM e.payload->'providerAdjustments'->a."sourceIndex"->>'sourceAdjustmentId'
      OR a."codeSystem" IS DISTINCT FROM e.payload->'providerAdjustments'->a."sourceIndex"->>'codeSystem'
      OR a."reasonCode" IS DISTINCT FROM e.payload->'providerAdjustments'->a."sourceIndex"->>'reasonCode'
      OR a."sourceReference" IS DISTINCT FROM e.payload->'providerAdjustments'->a."sourceIndex"->>'sourceReference'
      OR a."providerIdentifier" IS DISTINCT FROM e.payload->'providerAdjustments'->a."sourceIndex"->>'providerIdentifier'
      OR a."fiscalPeriodEnd" IS DISTINCT FROM (e.payload->'providerAdjustments'->a."sourceIndex"->>'fiscalPeriodEnd')::date
      OR a.amount IS DISTINCT FROM (e.payload->'providerAdjustments'->a."sourceIndex"->>'amount')::numeric
      OR a."sourceAmount" IS DISTINCT FROM (e.payload->'providerAdjustments'->a."sourceIndex"->>'sourceAmount')::numeric
      OR a."sourceSignConvention" IS DISTINCT FROM e.payload->'providerAdjustments'->a."sourceIndex"->>'sourceSignConvention')
  ) THEN RAISE EXCEPTION 'REMITTANCE_BATCH_MEMBER_MISMATCH' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "RemittanceBatchReview_complete" AFTER INSERT ON "RemittanceBatchReview"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentabill_seal_batch_review();
CREATE CONSTRAINT TRIGGER "RemittanceBatchClaim_complete" AFTER INSERT ON "RemittanceBatchClaim"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentabill_seal_batch_review();
CREATE CONSTRAINT TRIGGER "RemittanceBatchAdjustment_complete" AFTER INSERT ON "RemittanceBatchAdjustment"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentabill_seal_batch_review();

COMMIT;

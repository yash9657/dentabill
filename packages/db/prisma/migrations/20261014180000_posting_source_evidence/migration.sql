BEGIN;

-- CreateTable
CREATE TABLE "PostingSourceReceipt" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceSystem" VARCHAR(32) NOT NULL,
    "sourceProduct" VARCHAR(80) NOT NULL,
    "sourceNamespace" VARCHAR(80) NOT NULL,
    "sourceReceiptId" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostingSourceReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostingSourceEvidence" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receiptId" UUID NOT NULL,
    "sourceNamespace" VARCHAR(80) NOT NULL,
    "sourceSystem" VARCHAR(32) NOT NULL,
    "sourceRecordId" VARCHAR(200) NOT NULL,
    "sourceSequence" INTEGER NOT NULL,
    "sourceVersion" VARCHAR(200),
    "sourceDocumentId" VARCHAR(200) NOT NULL,
    "status" VARCHAR(8) NOT NULL,
    "detailCompleteness" VARCHAR(8) NOT NULL,
    "amount" DECIMAL(10,2),
    "payload" JSONB NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostingSourceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostingSourceReview" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receiptId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "decision" VARCHAR(6) NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "reviewedByRole" "UserRole" NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "reviewToken" CHAR(64) NOT NULL,
    "evidenceHash" CHAR(64) NOT NULL,
    "ledgerVersion" VARCHAR(80) NOT NULL,
    "previousAcceptedEvidenceId" UUID,
    "sourceSequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostingSourceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostingSourceEntry" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reviewId" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "sourceIndex" INTEGER NOT NULL,
    "sourceEntryId" VARCHAR(200) NOT NULL,
    "sourceClaimId" VARCHAR(200),
    "sourceLineId" VARCHAR(200),
    "sourceProcedureId" VARCHAR(200),
    "sourceVersion" VARCHAR(200),
    "sourceIsTransfer" BOOLEAN,
    "entryKind" VARCHAR(10) NOT NULL,
    "sourceStatus" VARCHAR(80),
    "amount" DECIMAL(10,2),
    "sourceAmount" DECIMAL(10,2),
    "sourceSignConvention" VARCHAR(15) NOT NULL,

    CONSTRAINT "PostingSourceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostingSourceReceipt_source_scope_idx" ON "PostingSourceReceipt"("organizationId", "sourceSystem", "sourceNamespace");

-- CreateIndex
CREATE INDEX "PostingSourceReceipt_organizationId_createdAt_id_idx" ON "PostingSourceReceipt"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PostingSourceReceipt_id_organizationId_key" ON "PostingSourceReceipt"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PostingSourceReceipt_source_key" ON "PostingSourceReceipt"("organizationId", "sourceSystem", "sourceNamespace", "sourceReceiptId");

-- CreateIndex
CREATE INDEX "PostingSourceEvidence_organizationId_receiptId_sourceSequen_idx" ON "PostingSourceEvidence"("organizationId", "receiptId", "sourceSequence");

-- CreateIndex
CREATE UNIQUE INDEX "PostingSourceEvidence_id_organizationId_receiptId_key" ON "PostingSourceEvidence"("id", "organizationId", "receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "PostingSourceEvidence_source_event_key" ON "PostingSourceEvidence"("organizationId", "sourceSystem", "sourceNamespace", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "PostingSourceEvidence_receiptId_sourceSequence_key" ON "PostingSourceEvidence"("receiptId", "sourceSequence");

-- CreateIndex
CREATE UNIQUE INDEX "PostingSourceReview_evidenceId_key" ON "PostingSourceReview"("evidenceId");

-- CreateIndex
CREATE INDEX "PostingSourceReview_organizationId_receiptId_sourceSequence_idx" ON "PostingSourceReview"("organizationId", "receiptId", "sourceSequence");

-- CreateIndex
CREATE INDEX "PostingSourceReview_previous_idx" ON "PostingSourceReview"("previousAcceptedEvidenceId", "organizationId", "receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "PostingSourceReview_entry_binding_key" ON "PostingSourceReview"("id", "organizationId", "receiptId", "evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "PostingSourceReview_organizationId_idempotencyKey_key" ON "PostingSourceReview"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PostingSourceReview_evidenceId_organizationId_receiptId_key" ON "PostingSourceReview"("evidenceId", "organizationId", "receiptId");

-- CreateIndex
CREATE INDEX "PostingSourceEntry_organizationId_sourceEntryId_idx" ON "PostingSourceEntry"("organizationId", "sourceEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "PostingSourceEntry_reviewId_sourceIndex_key" ON "PostingSourceEntry"("reviewId", "sourceIndex");

-- CreateIndex
CREATE UNIQUE INDEX "PostingSourceEntry_reviewId_sourceEntryId_key" ON "PostingSourceEntry"("reviewId", "sourceEntryId");

-- AddForeignKey
ALTER TABLE "PostingSourceReceipt" ADD CONSTRAINT "PostingSourceReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PostingSourceEvidence" ADD CONSTRAINT "PostingSourceEvidence_receiptId_organizationId_fkey" FOREIGN KEY ("receiptId", "organizationId") REFERENCES "PostingSourceReceipt"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PostingSourceReview" ADD CONSTRAINT "PostingSourceReview_receiptId_organizationId_fkey" FOREIGN KEY ("receiptId", "organizationId") REFERENCES "PostingSourceReceipt"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PostingSourceReview" ADD CONSTRAINT "PostingSourceReview_evidenceId_organizationId_receiptId_fkey" FOREIGN KEY ("evidenceId", "organizationId", "receiptId") REFERENCES "PostingSourceEvidence"("id", "organizationId", "receiptId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PostingSourceReview" ADD CONSTRAINT "PostingSourceReview_previousAcceptedEvidenceId_organizatio_fkey" FOREIGN KEY ("previousAcceptedEvidenceId", "organizationId", "receiptId") REFERENCES "PostingSourceEvidence"("id", "organizationId", "receiptId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PostingSourceReview" ADD CONSTRAINT "PostingSourceReview_reviewedByUserId_organizationId_fkey" FOREIGN KEY ("reviewedByUserId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PostingSourceEntry" ADD CONSTRAINT "PostingSourceEntry_reviewId_organizationId_receiptId_evide_fkey" FOREIGN KEY ("reviewId", "organizationId", "receiptId", "evidenceId") REFERENCES "PostingSourceReview"("id", "organizationId", "receiptId", "evidenceId") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Additive independent PMS source observations, never financial allocations.
CREATE FUNCTION dentabill_posting_token_valid(value TEXT, maximum INTEGER)
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

CREATE FUNCTION dentabill_posting_json_token(value JSONB, maximum INTEGER, allow_null BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE((allow_null AND value = 'null'::jsonb)
    OR (jsonb_typeof(value) = 'string' AND dentabill_posting_token_valid(value #>> '{}',maximum)),false);
$$;


CREATE FUNCTION dentabill_posting_money_pair(p JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF jsonb_typeof(p->'sourceSignConvention') IS DISTINCT FROM 'string' OR p->>'sourceSignConvention' NOT IN ('CREDIT_POSITIVE','DEBIT_POSITIVE') THEN RETURN false; END IF;
  IF p->'amount' = 'null'::jsonb THEN RETURN p->'sourceAmount' = 'null'::jsonb; END IF;
  IF NOT dentabill_remittance_money(p->'amount') OR NOT dentabill_remittance_money(p->'sourceAmount') THEN RETURN false; END IF;
  RETURN (p->>'amount')::numeric = (CASE WHEN p->>'sourceSignConvention' = 'CREDIT_POSITIVE'
    THEN (p->>'sourceAmount')::numeric ELSE -(p->>'sourceAmount')::numeric END);
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

ALTER TABLE "PostingSourceReceipt" ADD CONSTRAINT "PostingSourceReceipt_identity_check" CHECK (
  dentabill_posting_token_valid("sourceSystem",32) AND dentabill_posting_token_valid("sourceProduct",80)
  AND "sourceNamespace" ~ '^[a-z0-9][a-z0-9_-]{0,79}$' AND dentabill_posting_token_valid("sourceReceiptId",200)
);
ALTER TABLE "PostingSourceEvidence" ADD CONSTRAINT "PostingSourceEvidence_shape_check" CHECK (
  dentabill_posting_token_valid("sourceSystem",32) AND "sourceNamespace" ~ '^[a-z0-9][a-z0-9_-]{0,79}$'
  AND dentabill_posting_token_valid("sourceRecordId",200) AND dentabill_posting_token_valid("sourceDocumentId",200)
  AND ("sourceVersion" IS NULL OR dentabill_posting_token_valid("sourceVersion",200))
  AND "sourceSequence" >= 1 AND status IN ('POSTED','PARTIAL','REMOVED','UNKNOWN')
  AND "detailCompleteness" IN ('COMPLETE','PARTIAL','ABSENT')
  AND "contentHash" ~ '^[a-f0-9]{64}$' AND octet_length(payload::text) <= 262144
);
ALTER TABLE "PostingSourceReview" ADD CONSTRAINT "PostingSourceReview_shape_check" CHECK (
  decision IN ('ACCEPT','REJECT') AND "sourceSequence" >= 1
  AND "reviewedByRole" IN ('OWNER','ADMIN','BILLING_STAFF')
  AND "requestHash" ~ '^[a-f0-9]{64}$' AND "reviewToken" ~ '^[a-f0-9]{64}$'
  AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "ledgerVersion" ~ '^[0-9]+:[0-9]+$'
);
ALTER TABLE "PostingSourceEntry" ADD CONSTRAINT "PostingSourceEntry_shape_check" CHECK (
  "sourceIndex" BETWEEN 0 AND 99 AND dentabill_posting_token_valid("sourceEntryId",200)
  AND ("sourceClaimId" IS NULL OR dentabill_posting_token_valid("sourceClaimId",200))
  AND ("sourceLineId" IS NULL OR dentabill_posting_token_valid("sourceLineId",200))
  AND ("sourceProcedureId" IS NULL OR dentabill_posting_token_valid("sourceProcedureId",200))
  AND ("sourceVersion" IS NULL OR dentabill_posting_token_valid("sourceVersion",200))
  AND ("sourceStatus" IS NULL OR dentabill_posting_token_valid("sourceStatus",80))
  AND "entryKind" IN ('PAYMENT','TRANSFER','ADJUSTMENT','UNKNOWN')
  AND "sourceSignConvention" IN ('CREDIT_POSITIVE','DEBIT_POSITIVE')
  AND ((amount IS NULL AND "sourceAmount" IS NULL) OR
    (amount IS NOT NULL AND "sourceAmount" IS NOT NULL AND amount =
      CASE WHEN "sourceSignConvention" = 'CREDIT_POSITIVE' THEN "sourceAmount" ELSE -"sourceAmount" END))
);
CREATE INDEX "PostingSourceReview_accepted_idx" ON "PostingSourceReview"
  ("organizationId","receiptId","sourceSequence" DESC) WHERE decision = 'ACCEPT';

CREATE FUNCTION dentabill_posting_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'POSTING_SOURCE_IMMUTABLE' USING ERRCODE = '23514'; END;
$$;
CREATE TRIGGER "PostingSourceReceipt_immutable" BEFORE UPDATE OR DELETE ON "PostingSourceReceipt"
  FOR EACH ROW EXECUTE FUNCTION dentabill_posting_immutable();
CREATE TRIGGER "PostingSourceEvidence_immutable" BEFORE UPDATE OR DELETE ON "PostingSourceEvidence"
  FOR EACH ROW EXECUTE FUNCTION dentabill_posting_immutable();
CREATE TRIGGER "PostingSourceReview_immutable" BEFORE UPDATE OR DELETE ON "PostingSourceReview"
  FOR EACH ROW EXECUTE FUNCTION dentabill_posting_immutable();
CREATE TRIGGER "PostingSourceEntry_immutable" BEFORE UPDATE OR DELETE ON "PostingSourceEntry"
  FOR EACH ROW EXECUTE FUNCTION dentabill_posting_immutable();

CREATE FUNCTION dentabill_admit_posting_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Organization" SET id = id WHERE id = NEW."organizationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTING_SOURCE_ORGANIZATION_INVALID' USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM "PostingSourceReceipt" r WHERE r."organizationId" = NEW."organizationId"
    AND r."sourceSystem" = NEW."sourceSystem" AND r."sourceNamespace" = NEW."sourceNamespace"
    AND r."sourceProduct" <> NEW."sourceProduct") THEN
    RAISE EXCEPTION 'POSTING_SOURCE_IDENTITY_CONFLICT' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PostingSourceReceipt_admission" BEFORE INSERT ON "PostingSourceReceipt"
  FOR EACH ROW EXECUTE FUNCTION dentabill_admit_posting_receipt();
CREATE FUNCTION dentabill_seal_posting_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "PostingSourceEvidence" WHERE "receiptId" = NEW.id AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'POSTING_SOURCE_RECEIPT_INCOMPLETE' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "PostingSourceReceipt_complete" AFTER INSERT ON "PostingSourceReceipt"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentabill_seal_posting_receipt();

CREATE FUNCTION dentabill_admit_posting_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p JSONB := NEW.payload; parent "PostingSourceReceipt"%ROWTYPE; item JSONB; key TEXT; parsed_observed TIMESTAMPTZ;
BEGIN
  UPDATE "Organization" SET id = id WHERE id = NEW."organizationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTING_SOURCE_ORGANIZATION_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT * INTO parent FROM "PostingSourceReceipt" WHERE id = NEW."receiptId" AND "organizationId" = NEW."organizationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTING_SOURCE_RECEIPT_INVALID' USING ERRCODE = '23514'; END IF;
  BEGIN
    IF NOT dentabill_remittance_object(p,ARRAY['schemaVersion','evidenceBasis','sourceSystem','sourceProduct',
      'sourceNamespace','sourceReceiptId','sourceRecordId','sourceSequence','sourceVersion','sourceDocumentId',
      'observedAt','status','sourceStatus','sourceIsPartial','currency','amount','sourceAmount','sourceSignConvention',
      'sourceEntryDate','sourceIssuedDate','paymentTrace','sourceDepositId','detailCompleteness','entries'])
      OR p->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR p->'evidenceBasis' IS DISTINCT FROM '"PMS_PAYMENT_RECEIPT"'::jsonb
      OR p->'currency' IS DISTINCT FROM '"USD"'::jsonb
      OR p->>'sourceSystem' IS DISTINCT FROM parent."sourceSystem" OR NEW."sourceSystem" <> parent."sourceSystem"
      OR p->>'sourceProduct' IS DISTINCT FROM parent."sourceProduct"
      OR p->>'sourceNamespace' IS DISTINCT FROM parent."sourceNamespace" OR NEW."sourceNamespace" <> parent."sourceNamespace"
      OR p->>'sourceReceiptId' IS DISTINCT FROM parent."sourceReceiptId"
      OR p->>'sourceRecordId' IS DISTINCT FROM NEW."sourceRecordId"
      OR p->'sourceSequence' IS DISTINCT FROM to_jsonb(NEW."sourceSequence")
      OR p->>'sourceVersion' IS DISTINCT FROM NEW."sourceVersion"
      OR p->>'sourceDocumentId' IS DISTINCT FROM NEW."sourceDocumentId"
      OR p->>'status' IS DISTINCT FROM NEW.status
      OR p->>'detailCompleteness' IS DISTINCT FROM NEW."detailCompleteness"
      OR NOT dentabill_posting_json_token(p->'sourceSystem',32)
      OR NOT dentabill_posting_json_token(p->'sourceProduct',80)
      OR NOT dentabill_posting_json_token(p->'sourceNamespace',80)
      OR NOT dentabill_posting_json_token(p->'sourceStatus',80,true)
      OR jsonb_typeof(p->'sourceIsPartial') NOT IN ('boolean','null')
      OR NOT dentabill_batch_json_date(p->'sourceEntryDate') OR NOT dentabill_batch_json_date(p->'sourceIssuedDate')
      OR NOT dentabill_posting_money_pair(p)
      OR (p->>'amount')::numeric IS DISTINCT FROM NEW.amount
      OR jsonb_typeof(p->'entries') IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'INVALID'; END IF;
    FOREACH key IN ARRAY ARRAY['sourceReceiptId','sourceRecordId','sourceDocumentId'] LOOP
      IF NOT dentabill_posting_json_token(p->key,200) THEN RAISE EXCEPTION 'INVALID'; END IF;
    END LOOP;
    FOREACH key IN ARRAY ARRAY['sourceVersion','paymentTrace','sourceDepositId'] LOOP
      IF NOT dentabill_posting_json_token(p->key,200,true) THEN RAISE EXCEPTION 'INVALID'; END IF;
    END LOOP;
    IF jsonb_array_length(p->'entries') > 100
      OR (p->>'detailCompleteness' = 'ABSENT' AND jsonb_array_length(p->'entries') <> 0)
      OR (p->>'status' = 'REMOVED' AND (p->'amount' <> 'null'::jsonb OR jsonb_array_length(p->'entries') <> 0))
      OR (SELECT count(DISTINCT el->>'sourceEntryId') FROM jsonb_array_elements(p->'entries') el) <> jsonb_array_length(p->'entries')
    THEN RAISE EXCEPTION 'INVALID'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p->'entries') LOOP
      IF NOT dentabill_remittance_object(item,ARRAY['sourceEntryId','sourceClaimId','sourceLineId','sourceProcedureId',
        'entryKind','sourceStatus','sourceVersion','sourceIsTransfer','amount','sourceAmount','sourceSignConvention'])
        OR NOT dentabill_posting_json_token(item->'sourceEntryId',200)
        OR NOT dentabill_posting_json_token(item->'sourceStatus',80,true)
        OR jsonb_typeof(item->'entryKind') IS DISTINCT FROM 'string' OR item->>'entryKind' NOT IN ('PAYMENT','TRANSFER','ADJUSTMENT','UNKNOWN')
        OR jsonb_typeof(item->'sourceIsTransfer') NOT IN ('boolean','null')
        OR NOT dentabill_posting_money_pair(item)
      THEN RAISE EXCEPTION 'INVALID'; END IF;
      FOREACH key IN ARRAY ARRAY['sourceClaimId','sourceLineId','sourceProcedureId','sourceVersion'] LOOP
        IF NOT dentabill_posting_json_token(item->key,200,true) THEN RAISE EXCEPTION 'INVALID'; END IF;
      END LOOP;
    END LOOP;
    IF jsonb_typeof(p->'observedAt') <> 'string' OR char_length(p->>'observedAt') > 64
      OR p->>'observedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?Z$'
      OR NOT dentabill_batch_json_date(to_jsonb(left(p->>'observedAt',10)))
    THEN RAISE EXCEPTION 'INVALID'; END IF;
    parsed_observed := (p->>'observedAt')::timestamptz;
    IF NOT isfinite(parsed_observed) THEN RAISE EXCEPTION 'INVALID'; END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'POSTING_SOURCE_PAYLOAD_INVALID' USING ERRCODE = '23514';
  END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PostingSourceEvidence_admission" BEFORE INSERT ON "PostingSourceEvidence"
  FOR EACH ROW EXECUTE FUNCTION dentabill_admit_posting_evidence();

-- Entry ownership is source identity only, never a monetary reservation. Complete
-- accepted snapshots replace membership; removal clears it. Incomplete accepted
-- snapshots retain every entry observed after that boundary, including unknowns.
-- Read payloads so same-transaction reviews are fenced before deferred mirrors exist.
CREATE FUNCTION dentabill_posting_entry_conflict(org TEXT, evidence UUID)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE AS $$
DECLARE candidate "PostingSourceEvidence"%ROWTYPE;
BEGIN
  SELECT * INTO candidate FROM "PostingSourceEvidence" WHERE id = evidence AND "organizationId" = org;
  IF NOT FOUND THEN RETURN true; END IF;
  IF candidate.status = 'REMOVED' THEN RETURN false; END IF;
  RETURN EXISTS (
    WITH accepted AS (
      SELECT e.* FROM "PostingSourceEvidence" e JOIN "PostingSourceReview" r
        ON r."evidenceId" = e.id AND r."organizationId" = e."organizationId" AND r."receiptId" = e."receiptId"
      WHERE e."organizationId" = org AND e."sourceSystem" = candidate."sourceSystem"
        AND e."sourceNamespace" = candidate."sourceNamespace" AND r.decision = 'ACCEPT'
    ), boundaries AS (
      SELECT "receiptId", max("sourceSequence") AS sequence FROM accepted
      WHERE "detailCompleteness" = 'COMPLETE' OR status = 'REMOVED' GROUP BY "receiptId"
    ), retained AS (
      SELECT a."receiptId", entry->>'sourceEntryId' AS entry_id
      FROM accepted a LEFT JOIN boundaries b ON b."receiptId" = a."receiptId"
      CROSS JOIN LATERAL jsonb_array_elements(a.payload->'entries') entry
      WHERE a.status <> 'REMOVED' AND a."sourceSequence" >= COALESCE(b.sequence,0)
    ), proposed AS (
      SELECT entry->>'sourceEntryId' AS entry_id FROM jsonb_array_elements(candidate.payload->'entries') entry
      UNION SELECT entry_id FROM retained WHERE "receiptId" = candidate."receiptId"
        AND candidate."detailCompleteness" <> 'COMPLETE'
    ) SELECT 1 FROM proposed p JOIN retained r ON r.entry_id = p.entry_id
      WHERE r."receiptId" <> candidate."receiptId"
  );
END;
$$;

CREATE FUNCTION dentabill_admit_posting_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e "PostingSourceEvidence"%ROWTYPE; previous_id UUID; previous_sequence INTEGER;
  latest_sequence INTEGER; expected_ledger TEXT; actor_role "UserRole";
BEGIN
  UPDATE "Organization" SET id = id WHERE id = NEW."organizationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTING_SOURCE_ORGANIZATION_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT role INTO actor_role FROM "User" WHERE id = NEW."reviewedByUserId" AND "organizationId" = NEW."organizationId" FOR SHARE;
  IF NOT FOUND OR actor_role NOT IN ('OWNER','ADMIN','BILLING_STAFF') OR actor_role IS DISTINCT FROM NEW."reviewedByRole" THEN
    RAISE EXCEPTION 'POSTING_SOURCE_REVIEW_ACTOR_INVALID' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO e FROM "PostingSourceEvidence" WHERE id = NEW."evidenceId"
    AND "organizationId" = NEW."organizationId" AND "receiptId" = NEW."receiptId";
  IF NOT FOUND OR e."contentHash" <> NEW."evidenceHash" OR e."sourceSequence" <> NEW."sourceSequence" THEN
    RAISE EXCEPTION 'POSTING_SOURCE_REVIEW_BINDING_INVALID' USING ERRCODE = '23514';
  END IF;
  SELECT "evidenceId", "sourceSequence" INTO previous_id, previous_sequence FROM "PostingSourceReview"
    WHERE "organizationId" = NEW."organizationId" AND "receiptId" = NEW."receiptId" AND decision = 'ACCEPT'
    ORDER BY "sourceSequence" DESC LIMIT 1;
  IF previous_id IS DISTINCT FROM NEW."previousAcceptedEvidenceId" THEN
    RAISE EXCEPTION 'POSTING_SOURCE_REVIEW_STALE' USING ERRCODE = '23514';
  END IF;
  SELECT (SELECT count(*) FROM "PostingSourceEvidence" WHERE "organizationId" = NEW."organizationId")::text || ':' ||
    (SELECT count(*) FROM "PostingSourceReview" WHERE "organizationId" = NEW."organizationId")::text INTO expected_ledger;
  IF expected_ledger IS DISTINCT FROM NEW."ledgerVersion" THEN
    RAISE EXCEPTION 'POSTING_SOURCE_REVIEW_STALE' USING ERRCODE = '23514';
  END IF;
  IF NEW.decision = 'ACCEPT' THEN
    SELECT max("sourceSequence") INTO latest_sequence FROM "PostingSourceEvidence"
      WHERE "organizationId" = NEW."organizationId" AND "receiptId" = NEW."receiptId";
    IF e."sourceSequence" <> latest_sequence OR e."sourceSequence" <= COALESCE(previous_sequence,0) THEN
      RAISE EXCEPTION 'POSTING_SOURCE_REVIEW_STALE' USING ERRCODE = '23514';
    END IF;
    IF dentabill_posting_entry_conflict(NEW."organizationId",NEW."evidenceId") THEN
      RAISE EXCEPTION 'POSTING_SOURCE_ENTRY_CONFLICT' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PostingSourceReview_admission" BEFORE INSERT ON "PostingSourceReview"
  FOR EACH ROW EXECUTE FUNCTION dentabill_admit_posting_review();

CREATE FUNCTION dentabill_admit_posting_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "PostingSourceReview"%ROWTYPE; item JSONB;
BEGIN
  UPDATE "Organization" SET id = id WHERE id = NEW."organizationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'POSTING_SOURCE_ORGANIZATION_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT * INTO r FROM "PostingSourceReview" WHERE id = NEW."reviewId" AND "organizationId" = NEW."organizationId"
    AND "receiptId" = NEW."receiptId" AND "evidenceId" = NEW."evidenceId";
  IF NOT FOUND OR r.decision <> 'ACCEPT' THEN
    RAISE EXCEPTION 'POSTING_SOURCE_ENTRY_BINDING_INVALID' USING ERRCODE = '23514';
  END IF;
  SELECT payload->'entries'->NEW."sourceIndex" INTO item FROM "PostingSourceEvidence"
    WHERE id = r."evidenceId" AND "organizationId" = r."organizationId" AND "receiptId" = r."receiptId";
  IF item IS NULL OR NEW."sourceIndex" < 0
    OR item->>'sourceEntryId' IS DISTINCT FROM NEW."sourceEntryId"
    OR item->>'sourceClaimId' IS DISTINCT FROM NEW."sourceClaimId"
    OR item->>'sourceLineId' IS DISTINCT FROM NEW."sourceLineId"
    OR item->>'sourceProcedureId' IS DISTINCT FROM NEW."sourceProcedureId"
    OR item->>'sourceVersion' IS DISTINCT FROM NEW."sourceVersion"
    OR (item->>'sourceIsTransfer')::boolean IS DISTINCT FROM NEW."sourceIsTransfer"
    OR item->>'entryKind' IS DISTINCT FROM NEW."entryKind"
    OR item->>'sourceStatus' IS DISTINCT FROM NEW."sourceStatus"
    OR (item->>'amount')::numeric IS DISTINCT FROM NEW.amount
    OR (item->>'sourceAmount')::numeric IS DISTINCT FROM NEW."sourceAmount"
    OR item->>'sourceSignConvention' IS DISTINCT FROM NEW."sourceSignConvention"
  THEN RAISE EXCEPTION 'POSTING_SOURCE_ENTRY_MISMATCH' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PostingSourceEntry_admission" BEFORE INSERT ON "PostingSourceEntry"
  FOR EACH ROW EXECUTE FUNCTION dentabill_admit_posting_entry();

CREATE FUNCTION dentabill_seal_posting_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected INTEGER; actual INTEGER;
BEGIN
  SELECT CASE WHEN NEW.decision = 'ACCEPT' THEN jsonb_array_length(payload->'entries') ELSE 0 END INTO expected
    FROM "PostingSourceEvidence" WHERE id = NEW."evidenceId" AND "organizationId" = NEW."organizationId" AND "receiptId" = NEW."receiptId";
  SELECT count(*) INTO actual FROM "PostingSourceEntry" WHERE "reviewId" = NEW.id AND "organizationId" = NEW."organizationId";
  IF expected IS DISTINCT FROM actual THEN RAISE EXCEPTION 'POSTING_SOURCE_REVIEW_INCOMPLETE' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "PostingSourceReview_complete" AFTER INSERT ON "PostingSourceReview"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentabill_seal_posting_review();

COMMIT;

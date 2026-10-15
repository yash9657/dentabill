-- CreateTable
CREATE TABLE "CashSourceTransaction" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceSystem" VARCHAR(80) NOT NULL,
    "sourceProduct" VARCHAR(80) NOT NULL,
    "sourceNamespace" VARCHAR(80) NOT NULL,
    "sourceAccountId" VARCHAR(200) NOT NULL,
    "sourceTransactionId" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashSourceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashSourceEvidence" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "transactionId" UUID NOT NULL,
    "sourceNamespace" VARCHAR(80) NOT NULL,
    "sourceAccountId" VARCHAR(200) NOT NULL,
    "sourceRecordId" VARCHAR(200) NOT NULL,
    "sourceSequence" INTEGER NOT NULL,
    "sourceVersion" VARCHAR(200),
    "sourceDocumentId" VARCHAR(200) NOT NULL,
    "status" VARCHAR(8) NOT NULL,
    "amount" DECIMAL(10,2),
    "payload" JSONB NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashSourceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashSourceReview" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "transactionId" UUID NOT NULL,
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

    CONSTRAINT "CashSourceReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashSourceTransaction_account_idx" ON "CashSourceTransaction"("organizationId", "sourceNamespace", "sourceAccountId");

-- CreateIndex
CREATE INDEX "CashSourceTransaction_organizationId_createdAt_id_idx" ON "CashSourceTransaction"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CashSourceTransaction_id_organizationId_key" ON "CashSourceTransaction"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CashSourceTransaction_source_key" ON "CashSourceTransaction"("organizationId", "sourceNamespace", "sourceAccountId", "sourceTransactionId");

-- CreateIndex
CREATE INDEX "CashSourceEvidence_organizationId_transactionId_sourceSeque_idx" ON "CashSourceEvidence"("organizationId", "transactionId", "sourceSequence");

-- CreateIndex
CREATE UNIQUE INDEX "CashSourceEvidence_id_organizationId_transactionId_key" ON "CashSourceEvidence"("id", "organizationId", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "CashSourceEvidence_source_event_key" ON "CashSourceEvidence"("organizationId", "sourceNamespace", "sourceAccountId", "sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "CashSourceEvidence_transactionId_sourceSequence_key" ON "CashSourceEvidence"("transactionId", "sourceSequence");

-- CreateIndex
CREATE UNIQUE INDEX "CashSourceReview_evidenceId_key" ON "CashSourceReview"("evidenceId");

-- CreateIndex
CREATE INDEX "CashSourceReview_organizationId_transactionId_sourceSequenc_idx" ON "CashSourceReview"("organizationId", "transactionId", "sourceSequence");

-- CreateIndex
CREATE INDEX "CashSourceReview_previous_idx" ON "CashSourceReview"("previousAcceptedEvidenceId", "organizationId", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "CashSourceReview_organizationId_idempotencyKey_key" ON "CashSourceReview"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CashSourceReview_evidenceId_organizationId_transactionId_key" ON "CashSourceReview"("evidenceId", "organizationId", "transactionId");

-- AddForeignKey
ALTER TABLE "CashSourceTransaction" ADD CONSTRAINT "CashSourceTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CashSourceEvidence" ADD CONSTRAINT "CashSourceEvidence_transactionId_organizationId_fkey" FOREIGN KEY ("transactionId", "organizationId") REFERENCES "CashSourceTransaction"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CashSourceReview" ADD CONSTRAINT "CashSourceReview_transactionId_organizationId_fkey" FOREIGN KEY ("transactionId", "organizationId") REFERENCES "CashSourceTransaction"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CashSourceReview" ADD CONSTRAINT "CashSourceReview_evidenceId_organizationId_transactionId_fkey" FOREIGN KEY ("evidenceId", "organizationId", "transactionId") REFERENCES "CashSourceEvidence"("id", "organizationId", "transactionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CashSourceReview" ADD CONSTRAINT "CashSourceReview_previousAcceptedEvidenceId_organizationId_fkey" FOREIGN KEY ("previousAcceptedEvidenceId", "organizationId", "transactionId") REFERENCES "CashSourceEvidence"("id", "organizationId", "transactionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CashSourceReview" ADD CONSTRAINT "CashSourceReview_reviewedByUserId_organizationId_fkey" FOREIGN KEY ("reviewedByUserId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Expansion only: no existing claim, remittance, posting, or cash facts are
-- inferred. These immutable rows describe source observations and review.
ALTER TABLE "CashSourceTransaction" ADD CONSTRAINT "CashSourceTransaction_identity_check" CHECK (
  dentabill_source_token_valid("sourceSystem",80) AND dentabill_source_token_valid("sourceProduct",80)
  AND "sourceNamespace" ~ '^[a-z0-9][a-z0-9_-]{0,79}$'
  AND dentabill_source_token_valid("sourceAccountId",200)
  AND dentabill_source_token_valid("sourceTransactionId",200)
);
ALTER TABLE "CashSourceEvidence" ADD CONSTRAINT "CashSourceEvidence_shape_check" CHECK (
  "sourceNamespace" ~ '^[a-z0-9][a-z0-9_-]{0,79}$'
  AND dentabill_source_token_valid("sourceAccountId",200)
  AND dentabill_source_token_valid("sourceRecordId",200)
  AND dentabill_source_token_valid("sourceVersion",200)
  AND dentabill_source_token_valid("sourceDocumentId",200)
  AND "sourceSequence" >= 1 AND status IN ('PENDING','POSTED','REMOVED','UNKNOWN')
  AND (amount IS NULL OR amount BETWEEN -99999999.99 AND 99999999.99)
  AND (status <> 'POSTED' OR amount IS NOT NULL)
  AND (status <> 'REMOVED' OR amount IS NULL)
  AND "contentHash" ~ '^[a-f0-9]{64}$'
);
ALTER TABLE "CashSourceReview" ADD CONSTRAINT "CashSourceReview_shape_check" CHECK (
  decision IN ('ACCEPT','REJECT') AND "sourceSequence" >= 1
  AND "reviewedByRole" IN ('OWNER','ADMIN','BILLING_STAFF')
  AND "requestHash" ~ '^[a-f0-9]{64}$' AND "reviewToken" ~ '^[a-f0-9]{64}$'
  AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "ledgerVersion" ~ '^[0-9]+:[0-9]+$'
);
CREATE INDEX "CashSourceEvidence_pending_idx" ON "CashSourceEvidence"
  ("organizationId", "sourceNamespace", "sourceAccountId", (payload->>'pendingSourceTransactionId'))
  WHERE payload->>'pendingSourceTransactionId' IS NOT NULL;
CREATE INDEX "CashSourceReview_accepted_idx" ON "CashSourceReview"
  ("organizationId", "transactionId", "sourceSequence" DESC) WHERE decision = 'ACCEPT';

CREATE FUNCTION dentabill_cash_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CASH_SOURCE_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "CashSourceTransaction_immutable" BEFORE UPDATE OR DELETE ON "CashSourceTransaction"
  FOR EACH ROW EXECUTE FUNCTION dentabill_cash_immutable();
CREATE TRIGGER "CashSourceEvidence_immutable" BEFORE UPDATE OR DELETE ON "CashSourceEvidence"
  FOR EACH ROW EXECUTE FUNCTION dentabill_cash_immutable();
CREATE TRIGGER "CashSourceReview_immutable" BEFORE UPDATE OR DELETE ON "CashSourceReview"
  FOR EACH ROW EXECUTE FUNCTION dentabill_cash_immutable();

CREATE FUNCTION dentabill_admit_cash_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A tuple write also rejects stale RepeatableRead writers; lock-only
  -- serialization cannot make their prior snapshots fresh. updatedAt is untouched.
  UPDATE "Organization" SET id = id WHERE id = NEW."organizationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'CASH_SOURCE_ORGANIZATION_INVALID' USING ERRCODE = '23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM "CashSourceTransaction" t WHERE t."organizationId" = NEW."organizationId"
      AND t."sourceNamespace" = NEW."sourceNamespace" AND t."sourceAccountId" = NEW."sourceAccountId"
      AND (t."sourceSystem" <> NEW."sourceSystem" OR t."sourceProduct" <> NEW."sourceProduct")
  ) THEN RAISE EXCEPTION 'CASH_SOURCE_ACCOUNT_IDENTITY_CONFLICT' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CashSourceTransaction_admission" BEFORE INSERT ON "CashSourceTransaction"
  FOR EACH ROW EXECUTE FUNCTION dentabill_admit_cash_transaction();
CREATE FUNCTION dentabill_seal_cash_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CashSourceEvidence" WHERE "transactionId" = NEW.id AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'CASH_SOURCE_TRANSACTION_INCOMPLETE' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "CashSourceTransaction_complete" AFTER INSERT ON "CashSourceTransaction"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentabill_seal_cash_transaction();

CREATE FUNCTION dentabill_admit_cash_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p JSONB := NEW.payload;
  parent "CashSourceTransaction"%ROWTYPE;
  key TEXT;
  parsed_date DATE;
  parsed_observed TIMESTAMPTZ;
BEGIN
  UPDATE "Organization" SET id = id WHERE id = NEW."organizationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'CASH_SOURCE_ORGANIZATION_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT * INTO parent FROM "CashSourceTransaction" WHERE id = NEW."transactionId" AND "organizationId" = NEW."organizationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'CASH_SOURCE_TRANSACTION_INVALID' USING ERRCODE = '23514'; END IF;
  BEGIN
    IF NOT dentabill_remittance_object(p, ARRAY['schemaVersion','evidenceBasis','sourceSystem','sourceProduct',
      'sourceNamespace','sourceAccountId','sourceTransactionId','sourceRecordId','sourceSequence','sourceVersion',
      'sourceDocumentId','observedAt','status','currency','amount','sourceAmount','sourceSignConvention',
      'transactionDate','postingDate','counterpartyName','paymentTrace','sourceStatus','sourceDescription','pendingSourceTransactionId'])
      OR p->'schemaVersion' <> '1'::jsonb OR p->'evidenceBasis' <> '"BANK_ACCOUNT_TRANSACTION"'::jsonb
      OR p->'currency' <> '"USD"'::jsonb
      OR p->'sourceSignConvention' NOT IN ('"CREDIT_POSITIVE"'::jsonb,'"DEBIT_POSITIVE"'::jsonb)
      OR p->'sourceSequence' IS DISTINCT FROM to_jsonb(NEW."sourceSequence")
      OR p->>'sourceSystem' IS DISTINCT FROM parent."sourceSystem"
      OR p->>'sourceProduct' IS DISTINCT FROM parent."sourceProduct"
      OR p->>'sourceNamespace' IS DISTINCT FROM parent."sourceNamespace"
      OR p->>'sourceAccountId' IS DISTINCT FROM parent."sourceAccountId"
      OR p->>'sourceTransactionId' IS DISTINCT FROM parent."sourceTransactionId"
      OR NEW."sourceNamespace" <> parent."sourceNamespace" OR NEW."sourceAccountId" <> parent."sourceAccountId"
      OR p->>'sourceRecordId' IS DISTINCT FROM NEW."sourceRecordId"
      OR p->>'sourceDocumentId' IS DISTINCT FROM NEW."sourceDocumentId"
      OR p->>'sourceVersion' IS DISTINCT FROM NEW."sourceVersion"
      OR p->>'status' IS DISTINCT FROM NEW.status
    THEN RAISE EXCEPTION 'INVALID'; END IF;
    FOREACH key IN ARRAY ARRAY['sourceSystem','sourceProduct','sourceNamespace'] LOOP
      IF NOT dentabill_remittance_json_token(p->key,80) THEN RAISE EXCEPTION 'INVALID'; END IF;
    END LOOP;
    FOREACH key IN ARRAY ARRAY['sourceAccountId','sourceTransactionId','sourceRecordId','sourceDocumentId'] LOOP
      IF NOT dentabill_remittance_json_token(p->key,200) THEN RAISE EXCEPTION 'INVALID'; END IF;
    END LOOP;
    FOREACH key IN ARRAY ARRAY['sourceVersion','counterpartyName','paymentTrace','pendingSourceTransactionId'] LOOP
      IF NOT dentabill_remittance_json_token(p->key,200,true) THEN RAISE EXCEPTION 'INVALID'; END IF;
    END LOOP;
    IF NOT dentabill_remittance_json_token(p->'sourceStatus',80,true)
      OR NOT dentabill_remittance_json_token(p->'sourceDescription',500,true)
      OR p->>'pendingSourceTransactionId' = parent."sourceTransactionId"
    THEN RAISE EXCEPTION 'INVALID'; END IF;
    IF p->'amount' = 'null'::jsonb THEN
      IF NEW.amount IS NOT NULL OR p->'sourceAmount' <> 'null'::jsonb THEN RAISE EXCEPTION 'INVALID'; END IF;
    ELSE
      IF NOT dentabill_remittance_money(p->'amount') OR NOT dentabill_remittance_money(p->'sourceAmount')
        THEN RAISE EXCEPTION 'INVALID'; END IF;
      IF (p->>'amount')::numeric IS DISTINCT FROM NEW.amount
        OR (p->>'amount')::numeric <> (CASE WHEN p->>'sourceSignConvention' = 'CREDIT_POSITIVE'
          THEN (p->>'sourceAmount')::numeric ELSE -(p->>'sourceAmount')::numeric END)
      THEN RAISE EXCEPTION 'INVALID'; END IF;
    END IF;
    FOREACH key IN ARRAY ARRAY['transactionDate','postingDate'] LOOP
      IF p->key <> 'null'::jsonb THEN
        IF jsonb_typeof(p->key) <> 'string' OR p->>key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'INVALID'; END IF;
        parsed_date := (p->>key)::date;
        IF parsed_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
          OR to_char(parsed_date,'YYYY-MM-DD') <> p->>key THEN RAISE EXCEPTION 'INVALID'; END IF;
      END IF;
    END LOOP;
    IF jsonb_typeof(p->'observedAt') <> 'string' OR char_length(p->>'observedAt') > 64
      OR p->>'observedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?Z$'
    THEN RAISE EXCEPTION 'INVALID'; END IF;
    parsed_date := left(p->>'observedAt',10)::date;
    parsed_observed := (p->>'observedAt')::timestamptz;
    IF parsed_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
      OR to_char(parsed_date,'YYYY-MM-DD') <> left(p->>'observedAt',10) OR NOT isfinite(parsed_observed)
    THEN RAISE EXCEPTION 'INVALID'; END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'CASH_SOURCE_PAYLOAD_INVALID' USING ERRCODE = '23514';
  END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CashSourceEvidence_admission" BEFORE INSERT ON "CashSourceEvidence"
  FOR EACH ROW EXECUTE FUNCTION dentabill_admit_cash_evidence();

-- Historical accepted links are permanent identity evidence. Null in a newer
-- observation supplies no replacement identity, so it never erases an old edge.
-- At most 100 distinct source IDs are visited, including not-yet-imported IDs.
CREATE FUNCTION dentabill_cash_link_blocker(org TEXT, txn UUID, pending_id TEXT, proposed_status TEXT)
RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  parent "CashSourceTransaction"%ROWTYPE;
  visited TEXT[];
  position INTEGER := 1;
  current_id TEXT;
  neighbor TEXT;
  posted_count INTEGER;
BEGIN
  SELECT * INTO parent FROM "CashSourceTransaction" WHERE id = txn AND "organizationId" = org;
  IF NOT FOUND THEN RETURN 'SOURCE_LINK_LIMIT'; END IF;
  IF pending_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM "CashSourceEvidence" e JOIN "CashSourceReview" r
      ON r."evidenceId" = e.id AND r."organizationId" = e."organizationId" AND r."transactionId" = e."transactionId"
    WHERE e."organizationId" = org AND e."transactionId" = txn AND r.decision = 'ACCEPT'
      AND e.payload->>'pendingSourceTransactionId' IS NOT NULL
      AND e.payload->>'pendingSourceTransactionId' <> pending_id
  ) THEN RETURN 'PENDING_LINK_CHANGED'; END IF;
  visited := ARRAY[parent."sourceTransactionId"];
  IF pending_id IS NOT NULL AND pending_id <> parent."sourceTransactionId" THEN visited := array_append(visited,pending_id); END IF;
  WHILE position <= cardinality(visited) LOOP
    current_id := visited[position];
    FOR neighbor IN
      SELECT DISTINCT CASE WHEN t."sourceTransactionId" = current_id
        THEN e.payload->>'pendingSourceTransactionId' ELSE t."sourceTransactionId" END
      FROM "CashSourceEvidence" e JOIN "CashSourceReview" r
        ON r."evidenceId" = e.id AND r."organizationId" = e."organizationId" AND r."transactionId" = e."transactionId"
      JOIN "CashSourceTransaction" t ON t.id = e."transactionId" AND t."organizationId" = e."organizationId"
      WHERE e."organizationId" = org AND e."sourceNamespace" = parent."sourceNamespace" AND e."sourceAccountId" = parent."sourceAccountId"
        AND r.decision = 'ACCEPT' AND e.payload->>'pendingSourceTransactionId' IS NOT NULL
        AND (t."sourceTransactionId" = current_id OR e.payload->>'pendingSourceTransactionId' = current_id)
        AND NOT (CASE WHEN t."sourceTransactionId" = current_id THEN e.payload->>'pendingSourceTransactionId' ELSE t."sourceTransactionId" END = ANY(visited))
      LIMIT 101
    LOOP
      IF NOT neighbor = ANY(visited) THEN
        visited := array_append(visited,neighbor);
        IF cardinality(visited) > 100 THEN RETURN 'SOURCE_LINK_LIMIT'; END IF;
      END IF;
    END LOOP;
    position := position + 1;
  END LOOP;
  SELECT count(*) INTO posted_count FROM "CashSourceTransaction" t
    JOIN LATERAL (
      SELECT e.status FROM "CashSourceReview" r JOIN "CashSourceEvidence" e
        ON e.id = r."evidenceId" AND e."organizationId" = r."organizationId" AND e."transactionId" = r."transactionId"
      WHERE r."organizationId" = org AND r."transactionId" = t.id AND r.decision = 'ACCEPT'
      ORDER BY r."sourceSequence" DESC LIMIT 1
    ) current_accepted ON true
    WHERE t."organizationId" = org AND t."sourceNamespace" = parent."sourceNamespace" AND t."sourceAccountId" = parent."sourceAccountId"
      AND t."sourceTransactionId" = ANY(visited) AND t.id <> txn AND current_accepted.status = 'POSTED';
  IF proposed_status = 'POSTED' THEN posted_count := posted_count + 1; END IF;
  IF posted_count > 1 THEN RETURN 'POSTED_REPLACEMENT_OVERLAP'; END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION dentabill_admit_cash_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  e "CashSourceEvidence"%ROWTYPE;
  previous_id UUID;
  previous_sequence INTEGER;
  latest_sequence INTEGER;
  expected_ledger TEXT;
  actor_role "UserRole";
  blocker TEXT;
BEGIN
  UPDATE "Organization" SET id = id WHERE id = NEW."organizationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'CASH_SOURCE_ORGANIZATION_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT role INTO actor_role FROM "User" WHERE id = NEW."reviewedByUserId" AND "organizationId" = NEW."organizationId" FOR SHARE;
  IF NOT FOUND OR actor_role NOT IN ('OWNER','ADMIN','BILLING_STAFF') OR actor_role IS DISTINCT FROM NEW."reviewedByRole" THEN
    RAISE EXCEPTION 'CASH_SOURCE_REVIEW_ACTOR_INVALID' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO e FROM "CashSourceEvidence" WHERE id = NEW."evidenceId"
    AND "organizationId" = NEW."organizationId" AND "transactionId" = NEW."transactionId";
  IF NOT FOUND OR e."contentHash" <> NEW."evidenceHash" OR e."sourceSequence" <> NEW."sourceSequence" THEN
    RAISE EXCEPTION 'CASH_SOURCE_REVIEW_BINDING_INVALID' USING ERRCODE = '23514';
  END IF;
  SELECT "evidenceId", "sourceSequence" INTO previous_id, previous_sequence FROM "CashSourceReview"
    WHERE "organizationId" = NEW."organizationId" AND "transactionId" = NEW."transactionId" AND decision = 'ACCEPT'
    ORDER BY "sourceSequence" DESC LIMIT 1;
  IF previous_id IS DISTINCT FROM NEW."previousAcceptedEvidenceId" THEN
    RAISE EXCEPTION 'CASH_SOURCE_REVIEW_STALE' USING ERRCODE = '23514';
  END IF;
  SELECT (SELECT count(*) FROM "CashSourceEvidence" WHERE "organizationId" = NEW."organizationId")::text || ':' ||
    (SELECT count(*) FROM "CashSourceReview" WHERE "organizationId" = NEW."organizationId")::text INTO expected_ledger;
  IF expected_ledger IS DISTINCT FROM NEW."ledgerVersion" THEN
    RAISE EXCEPTION 'CASH_SOURCE_REVIEW_STALE' USING ERRCODE = '23514';
  END IF;
  IF NEW.decision = 'ACCEPT' THEN
    SELECT max("sourceSequence") INTO latest_sequence FROM "CashSourceEvidence"
      WHERE "organizationId" = NEW."organizationId" AND "transactionId" = NEW."transactionId";
    IF e."sourceSequence" <> latest_sequence OR e."sourceSequence" <= COALESCE(previous_sequence,0) THEN
      RAISE EXCEPTION 'CASH_SOURCE_REVIEW_STALE' USING ERRCODE = '23514';
    END IF;
    blocker := dentabill_cash_link_blocker(NEW."organizationId", NEW."transactionId", e.payload->>'pendingSourceTransactionId', e.status);
    IF blocker IS NOT NULL THEN RAISE EXCEPTION 'CASH_SOURCE_LINK_CONFLICT' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CashSourceReview_admission" BEFORE INSERT ON "CashSourceReview"
  FOR EACH ROW EXECUTE FUNCTION dentabill_admit_cash_review();

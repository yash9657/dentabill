BEGIN;

-- CreateTable
CREATE TABLE "CashBatchMatch" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cashTransactionId" UUID NOT NULL,
    "cashEvidenceId" UUID NOT NULL,
    "cashReviewId" UUID NOT NULL,
    "batchEvidenceId" UUID NOT NULL,
    "batchReviewId" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "reviewedByRole" "UserRole" NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "reviewToken" CHAR(64) NOT NULL,
    "ledgerVersion" VARCHAR(160) NOT NULL,
    "cashEvidenceHash" CHAR(64) NOT NULL,
    "batchEvidenceHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashBatchMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashBatchRelease" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "matchId" UUID NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "reviewedByRole" "UserRole" NOT NULL,
    "reason" VARCHAR(20) NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "reviewToken" CHAR(64) NOT NULL,
    "ledgerVersion" VARCHAR(160) NOT NULL,
    "matchRequestHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashBatchRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashBatchMatch_organizationId_cashTransactionId_idx" ON "CashBatchMatch"("organizationId", "cashTransactionId");

-- CreateIndex
CREATE INDEX "CashBatchMatch_organizationId_batchEvidenceId_idx" ON "CashBatchMatch"("organizationId", "batchEvidenceId");

-- CreateIndex
CREATE INDEX "CashBatchMatch_organizationId_createdAt_id_idx" ON "CashBatchMatch"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CashBatchMatch_id_organizationId_key" ON "CashBatchMatch"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CashBatchMatch_organizationId_idempotencyKey_key" ON "CashBatchMatch"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CashBatchRelease_matchId_key" ON "CashBatchRelease"("matchId");

-- CreateIndex
CREATE INDEX "CashBatchRelease_organizationId_createdAt_id_idx" ON "CashBatchRelease"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CashBatchRelease_matchId_organizationId_key" ON "CashBatchRelease"("matchId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CashBatchRelease_organizationId_idempotencyKey_key" ON "CashBatchRelease"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CashSourceReview_match_binding_key" ON "CashSourceReview"("id", "organizationId", "transactionId", "evidenceId");

-- AddForeignKey
ALTER TABLE "CashBatchMatch" ADD CONSTRAINT "CashBatchMatch_cashTransactionId_organizationId_fkey" FOREIGN KEY ("cashTransactionId", "organizationId") REFERENCES "CashSourceTransaction"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CashBatchMatch" ADD CONSTRAINT "CashBatchMatch_cashEvidenceId_organizationId_cashTransacti_fkey" FOREIGN KEY ("cashEvidenceId", "organizationId", "cashTransactionId") REFERENCES "CashSourceEvidence"("id", "organizationId", "transactionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CashBatchMatch" ADD CONSTRAINT "CashBatchMatch_cashReviewId_organizationId_cashTransaction_fkey" FOREIGN KEY ("cashReviewId", "organizationId", "cashTransactionId", "cashEvidenceId") REFERENCES "CashSourceReview"("id", "organizationId", "transactionId", "evidenceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CashBatchMatch" ADD CONSTRAINT "CashBatchMatch_batchEvidenceId_organizationId_fkey" FOREIGN KEY ("batchEvidenceId", "organizationId") REFERENCES "RemittanceBatchEvidence"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CashBatchMatch" ADD CONSTRAINT "CashBatchMatch_batchReviewId_organizationId_batchEvidenceI_fkey" FOREIGN KEY ("batchReviewId", "organizationId", "batchEvidenceId") REFERENCES "RemittanceBatchReview"("id", "organizationId", "evidenceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CashBatchMatch" ADD CONSTRAINT "CashBatchMatch_reviewedByUserId_organizationId_fkey" FOREIGN KEY ("reviewedByUserId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CashBatchRelease" ADD CONSTRAINT "CashBatchRelease_matchId_organizationId_fkey" FOREIGN KEY ("matchId", "organizationId") REFERENCES "CashBatchMatch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CashBatchRelease" ADD CONSTRAINT "CashBatchRelease_reviewedByUserId_organizationId_fkey" FOREIGN KEY ("reviewedByUserId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Additive human reconciliation only. No source records, claim allocations,
-- posting, settlement, or bank-verification facts are inferred or changed.
ALTER TABLE "CashBatchMatch" ADD CONSTRAINT "CashBatchMatch_shape_check" CHECK (
  amount <> 0 AND amount BETWEEN -99999999.99 AND 99999999.99
  AND "reviewedByRole" IN ('OWNER','ADMIN','BILLING_STAFF')
  AND "requestHash" ~ '^[a-f0-9]{64}$' AND "reviewToken" ~ '^[a-f0-9]{64}$'
  AND "cashEvidenceHash" ~ '^[a-f0-9]{64}$' AND "batchEvidenceHash" ~ '^[a-f0-9]{64}$'
  AND "ledgerVersion" ~ '^[0-9]+:[0-9]+:[0-9]+:[0-9]+:[0-9]+:[0-9]+$'
);
ALTER TABLE "CashBatchRelease" ADD CONSTRAINT "CashBatchRelease_shape_check" CHECK (
  reason IN ('WRONG_MATCH','SOURCE_CHANGED','OTHER_REVIEWED_ERROR')
  AND "reviewedByRole" IN ('OWNER','ADMIN','BILLING_STAFF')
  AND "requestHash" ~ '^[a-f0-9]{64}$' AND "reviewToken" ~ '^[a-f0-9]{64}$'
  AND "matchRequestHash" ~ '^[a-f0-9]{64}$'
  AND "ledgerVersion" ~ '^[0-9]+:[0-9]+:[0-9]+:[0-9]+:[0-9]+:[0-9]+$'
);
CREATE FUNCTION dentabill_cash_batch_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'CASH_BATCH_IMMUTABLE' USING ERRCODE = '23514'; END;
$$;
CREATE TRIGGER "CashBatchMatch_immutable" BEFORE UPDATE OR DELETE ON "CashBatchMatch"
  FOR EACH ROW EXECUTE FUNCTION dentabill_cash_batch_immutable();
CREATE TRIGGER "CashBatchRelease_immutable" BEFORE UPDATE OR DELETE ON "CashBatchRelease"
  FOR EACH ROW EXECUTE FUNCTION dentabill_cash_batch_immutable();

-- Full accepted historical source-link component, including source IDs that do
-- not yet have local transactions. Later null links never erase earlier edges.
-- Overflow returns one sentinel; callers must not treat a truncated traversal
-- as a complete component. Existing cash admission helpers remain unchanged.
CREATE FUNCTION dentabill_cash_match_component(org TEXT, txn UUID)
RETURNS TABLE(transaction_id UUID, source_id TEXT, overflow BOOLEAN) LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  parent "CashSourceTransaction"%ROWTYPE;
  visited TEXT[];
  position INTEGER := 1;
  current_id TEXT;
  neighbor TEXT;
BEGIN
  SELECT * INTO parent FROM "CashSourceTransaction" WHERE id = txn AND "organizationId" = org;
  IF NOT FOUND THEN RETURN QUERY SELECT NULL::UUID, NULL::TEXT, true; RETURN; END IF;
  visited := ARRAY[parent."sourceTransactionId"];
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
        IF cardinality(visited) > 100 THEN RETURN QUERY SELECT NULL::UUID, NULL::TEXT, true; RETURN; END IF;
      END IF;
    END LOOP;
    position := position + 1;
  END LOOP;
  RETURN QUERY SELECT t.id, v.source_id, false FROM unnest(visited) AS v(source_id)
    LEFT JOIN "CashSourceTransaction" t ON t."organizationId" = org
      AND t."sourceNamespace" = parent."sourceNamespace" AND t."sourceAccountId" = parent."sourceAccountId"
      AND t."sourceTransactionId" = v.source_id;
END;
$$;
CREATE FUNCTION dentabill_cash_batch_ledger(org TEXT)
RETURNS TEXT LANGUAGE sql VOLATILE AS $$
  SELECT (SELECT count(*) FROM "CashSourceEvidence" WHERE "organizationId" = org)::text || ':' ||
    (SELECT count(*) FROM "CashSourceReview" WHERE "organizationId" = org)::text || ':' ||
    (SELECT count(*) FROM "RemittanceBatchEvidence" WHERE "organizationId" = org)::text || ':' ||
    (SELECT count(*) FROM "RemittanceBatchReview" WHERE "organizationId" = org)::text || ':' ||
    (SELECT count(*) FROM "CashBatchMatch" WHERE "organizationId" = org)::text || ':' ||
    (SELECT count(*) FROM "CashBatchRelease" WHERE "organizationId" = org)::text;
$$;
CREATE FUNCTION dentabill_admit_cash_batch_match() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ce "CashSourceEvidence"%ROWTYPE;
  cr "CashSourceReview"%ROWTYPE;
  be "RemittanceBatchEvidence"%ROWTYPE;
  br "RemittanceBatchReview"%ROWTYPE;
  actor_role "UserRole";
  component_transactions UUID[];
  component_overflow BOOLEAN;
  cash_reserved NUMERIC;
  batch_reserved NUMERIC;
BEGIN
  -- A tuple write, rather than a lock-only read, rejects stale repeatable-read
  -- snapshots after concurrent source/review/match/release changes. updatedAt stays intact.
  UPDATE "Organization" SET id = id WHERE id = NEW."organizationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'CASH_BATCH_ORGANIZATION_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT role INTO actor_role FROM "User" WHERE id = NEW."reviewedByUserId" AND "organizationId" = NEW."organizationId" FOR SHARE;
  IF NOT FOUND OR actor_role IS DISTINCT FROM NEW."reviewedByRole" THEN
    RAISE EXCEPTION 'CASH_BATCH_ACTOR_INVALID' USING ERRCODE = '23514'; END IF;
  IF NEW."ledgerVersion" IS DISTINCT FROM dentabill_cash_batch_ledger(NEW."organizationId") THEN
    RAISE EXCEPTION 'CASH_BATCH_STALE' USING ERRCODE = '23514'; END IF;
  SELECT * INTO ce FROM "CashSourceEvidence" WHERE id = NEW."cashEvidenceId"
    AND "organizationId" = NEW."organizationId" AND "transactionId" = NEW."cashTransactionId";
  IF NOT FOUND OR ce."contentHash" <> NEW."cashEvidenceHash" THEN
    RAISE EXCEPTION 'CASH_BATCH_BINDING_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT * INTO cr FROM "CashSourceReview" WHERE id = NEW."cashReviewId"
    AND "organizationId" = NEW."organizationId" AND "transactionId" = NEW."cashTransactionId" AND "evidenceId" = ce.id;
  IF NOT FOUND OR cr.decision <> 'ACCEPT' OR ce.status <> 'POSTED' OR ce.amount IS NULL
    OR ce."sourceSequence" <> (SELECT max("sourceSequence") FROM "CashSourceEvidence"
      WHERE "organizationId" = NEW."organizationId" AND "transactionId" = NEW."cashTransactionId")
  THEN RAISE EXCEPTION 'CASH_BATCH_CASH_NOT_CURRENT' USING ERRCODE = '23514'; END IF;
  SELECT * INTO be FROM "RemittanceBatchEvidence" WHERE id = NEW."batchEvidenceId" AND "organizationId" = NEW."organizationId";
  IF NOT FOUND OR be."contentHash" <> NEW."batchEvidenceHash" THEN
    RAISE EXCEPTION 'CASH_BATCH_BINDING_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT * INTO br FROM "RemittanceBatchReview" WHERE id = NEW."batchReviewId"
    AND "organizationId" = NEW."organizationId" AND "evidenceId" = be.id;
  IF NOT FOUND OR br.decision <> 'ACCEPT' OR be."detailCompleteness" <> 'COMPLETE'
    OR br."netAmount" IS NULL OR br."netAmount" IS DISTINCT FROM be."reportedNetAmount"
  THEN RAISE EXCEPTION 'CASH_BATCH_BATCH_NOT_ACCEPTED' USING ERRCODE = '23514'; END IF;
  IF NEW.amount = 0 OR ce.amount = 0 OR br."netAmount" = 0
    OR sign(NEW.amount) <> sign(ce.amount) OR sign(NEW.amount) <> sign(br."netAmount")
  THEN RAISE EXCEPTION 'CASH_BATCH_SIGN_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT array_agg(c.transaction_id) FILTER (WHERE c.transaction_id IS NOT NULL), bool_or(c.overflow)
    INTO component_transactions, component_overflow FROM dentabill_cash_match_component(NEW."organizationId",NEW."cashTransactionId") c;
  IF component_overflow THEN RAISE EXCEPTION 'CASH_BATCH_COMPONENT_LIMIT' USING ERRCODE = '23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM "CashBatchMatch" m WHERE m."organizationId" = NEW."organizationId"
      AND m."cashTransactionId" = ANY(component_transactions) AND m."cashEvidenceId" <> ce.id
      AND NOT EXISTS (SELECT 1 FROM "CashBatchRelease" x WHERE x."matchId" = m.id AND x."organizationId" = m."organizationId")
  ) THEN RAISE EXCEPTION 'CASH_BATCH_COMPONENT_RESERVED' USING ERRCODE = '23514'; END IF;
  SELECT COALESCE(sum(abs(m.amount)),0) INTO cash_reserved FROM "CashBatchMatch" m
    WHERE m."organizationId" = NEW."organizationId" AND m."cashTransactionId" = NEW."cashTransactionId"
      AND NOT EXISTS (SELECT 1 FROM "CashBatchRelease" x WHERE x."matchId" = m.id AND x."organizationId" = m."organizationId");
  SELECT COALESCE(sum(abs(m.amount)),0) INTO batch_reserved FROM "CashBatchMatch" m
    WHERE m."organizationId" = NEW."organizationId" AND m."batchEvidenceId" = NEW."batchEvidenceId"
      AND NOT EXISTS (SELECT 1 FROM "CashBatchRelease" x WHERE x."matchId" = m.id AND x."organizationId" = m."organizationId");
  IF abs(NEW.amount) + cash_reserved > abs(ce.amount) OR abs(NEW.amount) + batch_reserved > abs(br."netAmount") THEN
    RAISE EXCEPTION 'CASH_BATCH_CAPACITY_EXCEEDED' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CashBatchMatch_admission" BEFORE INSERT ON "CashBatchMatch"
  FOR EACH ROW EXECUTE FUNCTION dentabill_admit_cash_batch_match();
CREATE FUNCTION dentabill_admit_cash_batch_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m "CashBatchMatch"%ROWTYPE; actor_role "UserRole";
BEGIN
  UPDATE "Organization" SET id = id WHERE id = NEW."organizationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'CASH_BATCH_ORGANIZATION_INVALID' USING ERRCODE = '23514'; END IF;
  SELECT role INTO actor_role FROM "User" WHERE id = NEW."reviewedByUserId" AND "organizationId" = NEW."organizationId" FOR SHARE;
  IF NOT FOUND OR actor_role IS DISTINCT FROM NEW."reviewedByRole" THEN
    RAISE EXCEPTION 'CASH_BATCH_ACTOR_INVALID' USING ERRCODE = '23514'; END IF;
  IF NEW."ledgerVersion" IS DISTINCT FROM dentabill_cash_batch_ledger(NEW."organizationId") THEN
    RAISE EXCEPTION 'CASH_BATCH_STALE' USING ERRCODE = '23514'; END IF;
  SELECT * INTO m FROM "CashBatchMatch" WHERE id = NEW."matchId" AND "organizationId" = NEW."organizationId";
  IF NOT FOUND OR m."requestHash" <> NEW."matchRequestHash" THEN
    RAISE EXCEPTION 'CASH_BATCH_BINDING_INVALID' USING ERRCODE = '23514'; END IF;
  -- Releases deliberately need no current-source or graph traversal admission:
  -- stale and oversized components must retain a human correction path.
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CashBatchRelease_admission" BEFORE INSERT ON "CashBatchRelease"
  FOR EACH ROW EXECUTE FUNCTION dentabill_admit_cash_batch_release();

COMMIT;

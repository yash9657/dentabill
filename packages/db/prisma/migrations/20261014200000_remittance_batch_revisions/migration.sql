BEGIN;

-- DropIndex
DROP INDEX "RemittanceBatchEvidence_batch_key";

-- DropIndex
DROP INDEX "RemittanceBatchClaim_member_key";

-- CreateTable
CREATE TABLE "RemittanceBatch" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceNamespace" VARCHAR(80) NOT NULL,
    "sourceBatchId" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemittanceBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemittanceBatchRevision" (
    "evidenceId" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" UUID NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "sourceSequence" INTEGER,

    CONSTRAINT "RemittanceBatchRevision_pkey" PRIMARY KEY ("evidenceId")
);

-- CreateTable
CREATE TABLE "RemittanceBatchMemberOwnership" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "remittanceEvidenceId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "firstMemberId" UUID NOT NULL,

    CONSTRAINT "RemittanceBatchMemberOwnership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemittanceBatch_organizationId_createdAt_id_idx" ON "RemittanceBatch"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatch_id_organizationId_key" ON "RemittanceBatch"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatch_source_key" ON "RemittanceBatch"("organizationId", "sourceNamespace", "sourceBatchId");

-- CreateIndex
CREATE INDEX "RemittanceBatchRevision_organizationId_batchId_sourceSequen_idx" ON "RemittanceBatchRevision"("organizationId", "batchId", "sourceSequence");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchRevision_evidenceId_organizationId_key" ON "RemittanceBatchRevision"("evidenceId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchRevision_batchId_sourceSequence_key" ON "RemittanceBatchRevision"("batchId", "sourceSequence");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchMemberOwnership_firstMemberId_key" ON "RemittanceBatchMemberOwnership"("firstMemberId");

-- CreateIndex
CREATE INDEX "RemittanceBatchMemberOwnership_organizationId_batchId_idx" ON "RemittanceBatchMemberOwnership"("organizationId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchMemberOwnership_event_key" ON "RemittanceBatchMemberOwnership"("organizationId", "remittanceEvidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchMemberOwnership_firstMemberId_organizationId_key" ON "RemittanceBatchMemberOwnership"("firstMemberId", "organizationId", "remittanceEvidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchClaim_ownership_binding_key" ON "RemittanceBatchClaim"("id", "organizationId", "remittanceEvidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceBatchClaim_reviewId_remittanceEvidenceId_key" ON "RemittanceBatchClaim"("reviewId", "remittanceEvidenceId");

-- AddForeignKey
ALTER TABLE "RemittanceBatch" ADD CONSTRAINT "RemittanceBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RemittanceBatchRevision" ADD CONSTRAINT "RemittanceBatchRevision_evidenceId_organizationId_fkey" FOREIGN KEY ("evidenceId", "organizationId") REFERENCES "RemittanceBatchEvidence"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RemittanceBatchRevision" ADD CONSTRAINT "RemittanceBatchRevision_batchId_organizationId_fkey" FOREIGN KEY ("batchId", "organizationId") REFERENCES "RemittanceBatch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RemittanceBatchMemberOwnership" ADD CONSTRAINT "RemittanceBatchMemberOwnership_batchId_organizationId_fkey" FOREIGN KEY ("batchId", "organizationId") REFERENCES "RemittanceBatch"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RemittanceBatchMemberOwnership" ADD CONSTRAINT "RemittanceBatchMemberOwnership_firstMemberId_organizationI_fkey" FOREIGN KEY ("firstMemberId", "organizationId", "remittanceEvidenceId") REFERENCES "RemittanceBatchClaim"("id", "organizationId", "remittanceEvidenceId") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Only new structural metadata is backfilled. Existing payloads, hashes, reviews,
-- first membership rows, matches, releases and timestamps are not rewritten.
INSERT INTO "RemittanceBatch" (id,"organizationId","sourceNamespace","sourceBatchId","createdAt")
 SELECT id,"organizationId","sourceNamespace","sourceBatchId","createdAt" FROM "RemittanceBatchEvidence";
INSERT INTO "RemittanceBatchRevision" ("evidenceId","organizationId","batchId","schemaVersion","sourceSequence")
 SELECT id,"organizationId",id,1,NULL FROM "RemittanceBatchEvidence";
INSERT INTO "RemittanceBatchMemberOwnership" (id,"organizationId","remittanceEvidenceId","batchId","firstMemberId")
 SELECT m.id,m."organizationId",m."remittanceEvidenceId",r."batchId",m.id FROM "RemittanceBatchClaim" m
 JOIN "RemittanceBatchRevision" r ON r."evidenceId"=m."batchEvidenceId" AND r."organizationId"=m."organizationId";

ALTER TABLE "RemittanceBatch" ADD CONSTRAINT "RemittanceBatch_shape" CHECK (
 "sourceNamespace" ~ '^[a-z0-9][a-z0-9_-]{0,79}$' AND dentabill_batch_token_valid("sourceBatchId",200) AND isfinite("createdAt"));
ALTER TABLE "RemittanceBatchRevision" ADD CONSTRAINT "RemittanceBatchRevision_shape" CHECK (
 ("schemaVersion"=1 AND "sourceSequence" IS NULL) OR ("schemaVersion"=2 AND "sourceSequence" IS NOT NULL AND "sourceSequence">=1));
CREATE UNIQUE INDEX "RemittanceBatchRevision_baseline_key" ON "RemittanceBatchRevision"("batchId") WHERE "schemaVersion"=1;
CREATE TRIGGER "RemittanceBatch_immutable" BEFORE UPDATE OR DELETE ON "RemittanceBatch" FOR EACH ROW EXECUTE FUNCTION dentabill_batch_immutable();
CREATE TRIGGER "RemittanceBatchRevision_immutable" BEFORE UPDATE OR DELETE ON "RemittanceBatchRevision" FOR EACH ROW EXECUTE FUNCTION dentabill_batch_immutable();
CREATE TRIGGER "RemittanceBatchMemberOwnership_immutable" BEFORE UPDATE OR DELETE ON "RemittanceBatchMemberOwnership" FOR EACH ROW EXECUTE FUNCTION dentabill_batch_immutable();

CREATE FUNCTION dentabill_batch_latest_evidence(org TEXT,batch UUID) RETURNS UUID LANGUAGE sql VOLATILE AS $$
 SELECT "evidenceId" FROM "RemittanceBatchRevision" WHERE "organizationId"=org AND "batchId"=batch
 ORDER BY "sourceSequence" DESC NULLS LAST LIMIT 1;
$$;
CREATE FUNCTION dentabill_admit_batch_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "Organization" SET id=id WHERE id=NEW."organizationId";
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM "RemittanceBatchEvidence" e WHERE e."organizationId"=NEW."organizationId"
   AND e."sourceNamespace"=NEW."sourceNamespace" AND e."sourceBatchId"=NEW."sourceBatchId" AND e."createdAt"=NEW."createdAt") THEN
   RAISE EXCEPTION 'REMITTANCE_BATCH_IDENTITY_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "RemittanceBatch_admission" BEFORE INSERT ON "RemittanceBatch" FOR EACH ROW EXECUTE FUNCTION dentabill_admit_batch_identity();
CREATE FUNCTION dentabill_admit_batch_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e "RemittanceBatchEvidence"%ROWTYPE; b "RemittanceBatch"%ROWTYPE;
BEGIN
 UPDATE "Organization" SET id=id WHERE id=NEW."organizationId";
 SELECT * INTO e FROM "RemittanceBatchEvidence" WHERE id=NEW."evidenceId" AND "organizationId"=NEW."organizationId";
 SELECT * INTO b FROM "RemittanceBatch" WHERE id=NEW."batchId" AND "organizationId"=NEW."organizationId";
 IF e.id IS NULL OR b.id IS NULL OR ROW(e."sourceNamespace",e."sourceBatchId") IS DISTINCT FROM ROW(b."sourceNamespace",b."sourceBatchId")
   OR e.payload->'schemaVersion' IS DISTINCT FROM to_jsonb(NEW."schemaVersion")
   OR (NEW."schemaVersion"=1 AND (NEW."sourceSequence" IS NOT NULL OR e.payload ? 'sourceSequence'))
   OR (NEW."schemaVersion"=2 AND e.payload->'sourceSequence' IS DISTINCT FROM to_jsonb(NEW."sourceSequence")) THEN
   RAISE EXCEPTION 'REMITTANCE_BATCH_REVISION_BINDING_INVALID' USING ERRCODE='23514'; END IF;
 IF NEW."schemaVersion"=1 AND EXISTS(SELECT 1 FROM "RemittanceBatchRevision" WHERE "organizationId"=NEW."organizationId" AND "batchId"=NEW."batchId") THEN
   RAISE EXCEPTION 'REMITTANCE_BATCH_BASELINE_CONFLICT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "RemittanceBatchRevision_admission" BEFORE INSERT ON "RemittanceBatchRevision" FOR EACH ROW EXECUTE FUNCTION dentabill_admit_batch_revision();
CREATE FUNCTION dentabill_link_batch_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch_id UUID;
BEGIN
 SELECT id INTO batch_id FROM "RemittanceBatch" WHERE "organizationId"=NEW."organizationId" AND "sourceNamespace"=NEW."sourceNamespace" AND "sourceBatchId"=NEW."sourceBatchId";
 IF batch_id IS NULL THEN
   batch_id:=gen_random_uuid();
   INSERT INTO "RemittanceBatch" (id,"organizationId","sourceNamespace","sourceBatchId","createdAt")
     VALUES (batch_id,NEW."organizationId",NEW."sourceNamespace",NEW."sourceBatchId",NEW."createdAt");
 END IF;
 INSERT INTO "RemittanceBatchRevision" ("evidenceId","organizationId","batchId","schemaVersion","sourceSequence")
   VALUES (NEW.id,NEW."organizationId",batch_id,((NEW.payload->>'schemaVersion')::numeric)::integer,((NEW.payload->>'sourceSequence')::numeric)::integer);
 RETURN NULL;
END;
$$;
CREATE TRIGGER "RemittanceBatchEvidence_revision_link" AFTER INSERT ON "RemittanceBatchEvidence" FOR EACH ROW EXECUTE FUNCTION dentabill_link_batch_revision();
CREATE FUNCTION dentabill_seal_batch_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "RemittanceBatchRevision" r JOIN "RemittanceBatchEvidence" e ON e.id=r."evidenceId" AND e."organizationId"=r."organizationId"
   WHERE r."batchId"=NEW.id AND r."organizationId"=NEW."organizationId" AND e."sourceNamespace"=NEW."sourceNamespace" AND e."sourceBatchId"=NEW."sourceBatchId") THEN
   RAISE EXCEPTION 'REMITTANCE_BATCH_IDENTITY_INCOMPLETE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "RemittanceBatch_complete" AFTER INSERT ON "RemittanceBatch" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentabill_seal_batch_identity();
CREATE FUNCTION dentabill_seal_batch_evidence_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "RemittanceBatchRevision" WHERE "evidenceId"=NEW.id AND "organizationId"=NEW."organizationId") THEN
   RAISE EXCEPTION 'REMITTANCE_BATCH_REVISION_INCOMPLETE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "RemittanceBatchEvidence_revision_complete" AFTER INSERT ON "RemittanceBatchEvidence" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentabill_seal_batch_evidence_revision();

CREATE FUNCTION dentabill_admit_batch_member_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "Organization" SET id=id WHERE id=NEW."organizationId";
 IF NOT EXISTS(SELECT 1 FROM "RemittanceBatchClaim" m JOIN "RemittanceBatchReview" v
   ON v.id=m."reviewId" AND v."organizationId"=m."organizationId" AND v."evidenceId"=m."batchEvidenceId"
   JOIN "RemittanceBatchRevision" r ON r."evidenceId"=m."batchEvidenceId" AND r."organizationId"=m."organizationId"
   WHERE m.id=NEW."firstMemberId" AND m."organizationId"=NEW."organizationId" AND m."remittanceEvidenceId"=NEW."remittanceEvidenceId"
     AND r."batchId"=NEW."batchId" AND v.decision='ACCEPT') THEN
   RAISE EXCEPTION 'REMITTANCE_BATCH_OWNER_BINDING_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "RemittanceBatchMemberOwnership_admission" BEFORE INSERT ON "RemittanceBatchMemberOwnership" FOR EACH ROW EXECUTE FUNCTION dentabill_admit_batch_member_ownership();
CREATE FUNCTION dentabill_link_batch_member_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch_id UUID; owner_batch UUID;
BEGIN
 SELECT "batchId" INTO batch_id FROM "RemittanceBatchRevision" WHERE "evidenceId"=NEW."batchEvidenceId" AND "organizationId"=NEW."organizationId";
 SELECT "batchId" INTO owner_batch FROM "RemittanceBatchMemberOwnership" WHERE "organizationId"=NEW."organizationId" AND "remittanceEvidenceId"=NEW."remittanceEvidenceId";
 IF batch_id IS NULL THEN RAISE EXCEPTION 'REMITTANCE_BATCH_REVISION_INCOMPLETE' USING ERRCODE='23514'; END IF;
 IF owner_batch IS NOT NULL AND owner_batch<>batch_id THEN RAISE EXCEPTION 'REMITTANCE_BATCH_MEMBER_OWNED' USING ERRCODE='23514'; END IF;
 IF owner_batch IS NULL THEN
   INSERT INTO "RemittanceBatchMemberOwnership" (id,"organizationId","remittanceEvidenceId","batchId","firstMemberId")
     VALUES (gen_random_uuid(),NEW."organizationId",NEW."remittanceEvidenceId",batch_id,NEW.id);
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER "RemittanceBatchClaim_owner_link" AFTER INSERT ON "RemittanceBatchClaim" FOR EACH ROW EXECUTE FUNCTION dentabill_link_batch_member_owner();
CREATE FUNCTION dentabill_seal_batch_member_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "RemittanceBatchMemberOwnership" o JOIN "RemittanceBatchRevision" r ON r."batchId"=o."batchId" AND r."organizationId"=o."organizationId"
   WHERE o."organizationId"=NEW."organizationId" AND o."remittanceEvidenceId"=NEW."remittanceEvidenceId" AND r."evidenceId"=NEW."batchEvidenceId") THEN
   RAISE EXCEPTION 'REMITTANCE_BATCH_OWNER_INCOMPLETE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "RemittanceBatchClaim_owner_complete" AFTER INSERT ON "RemittanceBatchClaim" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentabill_seal_batch_member_owner();

CREATE FUNCTION dentabill_admit_batch_current_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch_id UUID;
BEGIN
 UPDATE "Organization" SET id=id WHERE id=NEW."organizationId";
 SELECT "batchId" INTO batch_id FROM "RemittanceBatchRevision" WHERE "evidenceId"=NEW."evidenceId" AND "organizationId"=NEW."organizationId";
 IF batch_id IS NULL OR (NEW.decision='ACCEPT' AND NEW."evidenceId" IS DISTINCT FROM dentabill_batch_latest_evidence(NEW."organizationId",batch_id)) THEN
   RAISE EXCEPTION 'REMITTANCE_BATCH_NOT_CURRENT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "RemittanceBatchReview_revision_admission" BEFORE INSERT ON "RemittanceBatchReview" FOR EACH ROW EXECUTE FUNCTION dentabill_admit_batch_current_review();
CREATE FUNCTION dentabill_admit_cash_batch_revision_match() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch_id UUID; batch_reserved NUMERIC; net NUMERIC;
BEGIN
 UPDATE "Organization" SET id=id WHERE id=NEW."organizationId";
 SELECT "batchId" INTO batch_id FROM "RemittanceBatchRevision" WHERE "evidenceId"=NEW."batchEvidenceId" AND "organizationId"=NEW."organizationId";
 IF batch_id IS NULL OR NEW."batchEvidenceId" IS DISTINCT FROM dentabill_batch_latest_evidence(NEW."organizationId",batch_id) THEN
   RAISE EXCEPTION 'CASH_BATCH_BATCH_NOT_CURRENT' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "CashBatchMatch" m JOIN "RemittanceBatchRevision" r ON r."evidenceId"=m."batchEvidenceId" AND r."organizationId"=m."organizationId"
   WHERE r."batchId"=batch_id AND m."organizationId"=NEW."organizationId" AND m."batchEvidenceId"<>NEW."batchEvidenceId"
     AND NOT EXISTS(SELECT 1 FROM "CashBatchRelease" x WHERE x."matchId"=m.id AND x."organizationId"=m."organizationId")) THEN
   RAISE EXCEPTION 'CASH_BATCH_BATCH_RESERVED' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(abs(m.amount)),0) INTO batch_reserved FROM "CashBatchMatch" m
   JOIN "RemittanceBatchRevision" r ON r."evidenceId"=m."batchEvidenceId" AND r."organizationId"=m."organizationId"
   WHERE r."batchId"=batch_id AND m."organizationId"=NEW."organizationId"
     AND NOT EXISTS(SELECT 1 FROM "CashBatchRelease" x WHERE x."matchId"=m.id AND x."organizationId"=m."organizationId");
 SELECT "netAmount" INTO net FROM "RemittanceBatchReview" WHERE id=NEW."batchReviewId" AND "evidenceId"=NEW."batchEvidenceId" AND "organizationId"=NEW."organizationId";
 IF abs(NEW.amount)+batch_reserved>abs(net) THEN RAISE EXCEPTION 'CASH_BATCH_CAPACITY_EXCEEDED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "CashBatchMatch_revision_admission" BEFORE INSERT ON "CashBatchMatch" FOR EACH ROW EXECUTE FUNCTION dentabill_admit_cash_batch_revision_match();

-- Preserve the original v1 validator function; only its trigger is redirected.
CREATE FUNCTION dentabill_admit_batch_evidence_v2() RETURNS trigger LANGUAGE plpgsql AS $$
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
      'reportedNetAmount','claimRemittances','providerAdjustments'] || CASE WHEN p->'schemaVersion'='2'::jsonb THEN ARRAY['sourceSequence'] ELSE ARRAY[]::text[] END)
      OR (p->'schemaVersion' IS DISTINCT FROM '1'::jsonb AND p->'schemaVersion' IS DISTINCT FROM '2'::jsonb)
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
    IF p->'schemaVersion'='2'::jsonb AND (jsonb_typeof(p->'sourceSequence') IS DISTINCT FROM 'number' OR (p->>'sourceSequence')::numeric NOT BETWEEN 1 AND 2147483647 OR trunc((p->>'sourceSequence')::numeric) <> (p->>'sourceSequence')::numeric) THEN RAISE EXCEPTION 'INVALID'; END IF;
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
DROP TRIGGER "RemittanceBatchEvidence_admission" ON "RemittanceBatchEvidence";
CREATE TRIGGER "RemittanceBatchEvidence_admission" BEFORE INSERT ON "RemittanceBatchEvidence" FOR EACH ROW EXECUTE FUNCTION dentabill_admit_batch_evidence_v2();

COMMIT;

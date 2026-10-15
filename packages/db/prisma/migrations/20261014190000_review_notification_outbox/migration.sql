BEGIN;

-- CreateTable
CREATE TABLE "ReviewNotificationIntent" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inferenceRunId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "sourceHash" CHAR(64) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "claimVersion" TIMESTAMP(3) NOT NULL,
    "resultingClaimVersion" TIMESTAMP(3) NOT NULL,
    "sourceMarkerAt" TIMESTAMP(3) NOT NULL,
    "purpose" VARCHAR(32) NOT NULL,
    "observationId" TEXT,
    "summaryId" TEXT,
    "regenerationId" TEXT,
    "actorKind" VARCHAR(6) NOT NULL,
    "actorUserId" TEXT,
    "actorRole" "UserRole",
    "recipientUserId" TEXT,
    "recipientRole" "UserRole",
    "recipientEmail" VARCHAR(254),
    "recipientSelectionVersion" VARCHAR(32) NOT NULL,
    "templateVersion" VARCHAR(32) NOT NULL,
    "payload" JSONB,
    "payloadHash" CHAR(64),
    "deliveryKey" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewNotificationIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewNotificationDelivery" (
    "notificationId" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "state" VARCHAR(12) NOT NULL,
    "reason" VARCHAR(32),
    "mode" VARCHAR(16),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "activeAttemptId" UUID,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMP(3),
    "firstSubmissionAt" TIMESTAMP(3),
    "retryDeadlineAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL,
    "ambiguous" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewNotificationDelivery_pkey" PRIMARY KEY ("notificationId")
);

-- CreateTable
CREATE TABLE "ReviewNotificationAttempt" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "notificationId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "mode" VARCHAR(16) NOT NULL,
    "deliveryKey" UUID NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "leaseToken" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewNotificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewNotificationReceipt" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "notificationId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "outcome" VARCHAR(9) NOT NULL,
    "code" VARCHAR(32),
    "providerReceiptId" VARCHAR(200),
    "acceptedAt" TIMESTAMP(3),
    "retryAfterMs" INTEGER,
    "receiptHash" CHAR(64) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewNotificationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewNotificationIntent_deliveryKey_key" ON "ReviewNotificationIntent"("deliveryKey");

-- CreateIndex
CREATE INDEX "ReviewNotificationIntent_organizationId_createdAt_id_idx" ON "ReviewNotificationIntent"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewNotificationIntent_id_organizationId_key" ON "ReviewNotificationIntent"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewNotificationIntent_purpose_key" ON "ReviewNotificationIntent"("organizationId", "inferenceRunId", "purpose");

-- CreateIndex
CREATE INDEX "ReviewNotificationDelivery_organizationId_state_availableAt_idx" ON "ReviewNotificationDelivery"("organizationId", "state", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewNotificationDelivery_notificationId_organizationId_key" ON "ReviewNotificationDelivery"("notificationId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewNotificationAttempt_leaseToken_key" ON "ReviewNotificationAttempt"("leaseToken");

-- CreateIndex
CREATE INDEX "ReviewNotificationAttempt_organizationId_startedAt_idx" ON "ReviewNotificationAttempt"("organizationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewNotificationAttempt_id_organizationId_notificationId_key" ON "ReviewNotificationAttempt"("id", "organizationId", "notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewNotificationAttempt_notificationId_attemptNumber_key" ON "ReviewNotificationAttempt"("notificationId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewNotificationReceipt_attemptId_key" ON "ReviewNotificationReceipt"("attemptId");

-- CreateIndex
CREATE INDEX "ReviewNotificationReceipt_organizationId_completedAt_idx" ON "ReviewNotificationReceipt"("organizationId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewNotificationReceipt_attemptId_organizationId_notifica_key" ON "ReviewNotificationReceipt"("attemptId", "organizationId", "notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "CallSummary_notification_binding_key" ON "CallSummary"("id", "callId", "organizationId");

-- AddForeignKey
ALTER TABLE "ReviewNotificationIntent" ADD CONSTRAINT "ReviewNotificationIntent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReviewNotificationIntent" ADD CONSTRAINT "ReviewNotificationIntent_inferenceRunId_claimId_callId_org_fkey" FOREIGN KEY ("inferenceRunId", "claimId", "callId", "organizationId", "generation") REFERENCES "InferenceRun"("id", "claimId", "callId", "organizationId", "generation") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReviewNotificationIntent" ADD CONSTRAINT "ReviewNotificationIntent_observationId_claimId_callId_orga_fkey" FOREIGN KEY ("observationId", "claimId", "callId", "organizationId") REFERENCES "ClaimObservation"("id", "claimId", "callId", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReviewNotificationIntent" ADD CONSTRAINT "ReviewNotificationIntent_summaryId_callId_organizationId_fkey" FOREIGN KEY ("summaryId", "callId", "organizationId") REFERENCES "CallSummary"("id", "callId", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReviewNotificationIntent" ADD CONSTRAINT "ReviewNotificationIntent_regenerationId_claimId_callId_org_fkey" FOREIGN KEY ("regenerationId", "claimId", "callId", "organizationId", "generation") REFERENCES "ObservationRegeneration"("id", "claimId", "callId", "organizationId", "generation") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReviewNotificationIntent" ADD CONSTRAINT "ReviewNotificationIntent_actorUserId_organizationId_fkey" FOREIGN KEY ("actorUserId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReviewNotificationIntent" ADD CONSTRAINT "ReviewNotificationIntent_recipientUserId_organizationId_fkey" FOREIGN KEY ("recipientUserId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReviewNotificationDelivery" ADD CONSTRAINT "ReviewNotificationDelivery_notificationId_organizationId_fkey" FOREIGN KEY ("notificationId", "organizationId") REFERENCES "ReviewNotificationIntent"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReviewNotificationAttempt" ADD CONSTRAINT "ReviewNotificationAttempt_notificationId_organizationId_fkey" FOREIGN KEY ("notificationId", "organizationId") REFERENCES "ReviewNotificationIntent"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReviewNotificationReceipt" ADD CONSTRAINT "ReviewNotificationReceipt_notificationId_organizationId_fkey" FOREIGN KEY ("notificationId", "organizationId") REFERENCES "ReviewNotificationIntent"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ReviewNotificationReceipt" ADD CONSTRAINT "ReviewNotificationReceipt_attemptId_organizationId_notific_fkey" FOREIGN KEY ("attemptId", "organizationId", "notificationId") REFERENCES "ReviewNotificationAttempt"("id", "organizationId", "notificationId") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Generic frozen content only. Hashing follows the exact field order of the
-- dispatcher JSON.stringify contract, independently of JSONB key ordering.
CREATE FUNCTION dentabill_notification_payload(email TEXT) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN email IS NULL THEN NULL ELSE jsonb_build_object('to',email,'templateVersion','review-available.v1',
 'subject','Review available in DentaBill','text','A review is available. Sign in to DentaBill and open Claims to review it.',
 'appPath','/dashboard/claims') END;
$$;
CREATE FUNCTION dentabill_notification_payload_hash(email TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN email IS NULL THEN NULL ELSE encode(sha256(convert_to(
 '{"to":'||to_json(email)::text||',"templateVersion":"review-available.v1","subject":"Review available in DentaBill","text":"A review is available. Sign in to DentaBill and open Claims to review it.","appPath":"/dashboard/claims"}', 'UTF8')),'hex') END;
$$;
CREATE FUNCTION dentabill_notification_email_valid(email TEXT) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
 -- Matches the notifier's Zod 3 email grammar (ASCII, no leading or repeated dots).
 SELECT COALESCE(length(email) BETWEEN 3 AND 254 AND email ~* '^(?!\.)(?!.*\.\.)([A-Z0-9_''+\.\-]*)[A-Z0-9_+\-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$',false);
$$;
CREATE FUNCTION dentabill_notification_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'REVIEW_NOTIFICATION_IMMUTABLE' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER "ReviewNotificationIntent_immutable" BEFORE UPDATE OR DELETE ON "ReviewNotificationIntent" FOR EACH ROW EXECUTE FUNCTION dentabill_notification_immutable();
CREATE TRIGGER "ReviewNotificationAttempt_immutable" BEFORE UPDATE OR DELETE ON "ReviewNotificationAttempt" FOR EACH ROW EXECUTE FUNCTION dentabill_notification_immutable();
CREATE TRIGGER "ReviewNotificationReceipt_immutable" BEFORE UPDATE OR DELETE ON "ReviewNotificationReceipt" FOR EACH ROW EXECUTE FUNCTION dentabill_notification_immutable();
CREATE TRIGGER "ReviewNotificationDelivery_retained" BEFORE DELETE ON "ReviewNotificationDelivery" FOR EACH ROW EXECUTE FUNCTION dentabill_notification_immutable();
ALTER TABLE "ReviewNotificationIntent" ADD CONSTRAINT "ReviewNotificationIntent_shape" CHECK (
 purpose IN ('REVIEW_AVAILABLE','INFERENCE_REVIEW_REQUIRED') AND generation>=1
 AND "sourceHash" ~ '^[a-f0-9]{64}$' AND "requestHash" ~ '^[a-f0-9]{64}$'
 AND "recipientSelectionVersion"='oldest-owner-admin.v1' AND "templateVersion"='review-available.v1'
 AND (("actorKind"='SYSTEM' AND "actorUserId" IS NULL AND "actorRole" IS NULL AND "regenerationId" IS NULL)
   OR ("actorKind"='USER' AND "actorUserId" IS NOT NULL AND "actorRole" IN ('OWNER','ADMIN') AND "regenerationId" IS NOT NULL))
 AND (("recipientUserId" IS NULL AND "recipientRole" IS NULL AND "recipientEmail" IS NULL AND payload IS NULL AND "payloadHash" IS NULL)
   OR ("recipientUserId" IS NOT NULL AND "recipientRole" IN ('OWNER','ADMIN') AND dentabill_notification_email_valid("recipientEmail")
    AND payload IS NOT DISTINCT FROM dentabill_notification_payload("recipientEmail")
    AND "payloadHash" IS NOT DISTINCT FROM dentabill_notification_payload_hash("recipientEmail")))
);
ALTER TABLE "ReviewNotificationDelivery" ADD CONSTRAINT "ReviewNotificationDelivery_shape" CHECK (
 state IN ('PENDING','SENDING','SIMULATED','ACCEPTED','BLOCKED','QUARANTINED','SUPPRESSED')
 AND (reason IS NULL OR reason IN ('MISSING_RECIPIENT','RECIPIENT_CHANGED','SOURCE_NOT_READY','SOURCE_REVIEWED','SOURCE_SUPERSEDED','SOURCE_CHANGED','DEADLINE_EXPIRED','ATTEMPTS_EXHAUSTED','TRANSPORT_UNKNOWN','TRANSPORT_RETRYABLE','IDEMPOTENCY_CONFLICT','PAYLOAD_INVALID','TRANSPORT_REJECTED','LEASE_EXPIRED'))
 AND (mode IS NULL OR mode='SYNTHETIC') AND "attemptCount" BETWEEN 0 AND 5
 AND (("firstSubmissionAt" IS NULL AND "retryDeadlineAt" IS NULL AND "attemptCount"=0 AND mode IS NULL AND NOT ambiguous)
   OR ("firstSubmissionAt" IS NOT NULL AND "retryDeadlineAt" IS NOT NULL AND mode IS NOT NULL AND "retryDeadlineAt"="firstSubmissionAt"+interval '23 hours' AND "attemptCount">0 AND mode='SYNTHETIC'))
 AND ((state='SENDING' AND "activeAttemptId" IS NOT NULL AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
   OR (state<>'SENDING' AND "activeAttemptId" IS NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL))
 AND (state<>'SUPPRESSED' OR "firstSubmissionAt" IS NULL)
);
ALTER TABLE "ReviewNotificationAttempt" ADD CONSTRAINT "ReviewNotificationAttempt_shape" CHECK (
 "attemptNumber" BETWEEN 1 AND 5 AND mode='SYNTHETIC' AND "payloadHash" ~ '^[a-f0-9]{64}$'
 AND "leaseExpiresAt"="startedAt"+interval '1 minute'
);
ALTER TABLE "ReviewNotificationReceipt" ADD CONSTRAINT "ReviewNotificationReceipt_shape" CHECK (
 outcome IN ('SIMULATED','ACCEPTED','UNKNOWN','RETRYABLE','CONFLICT')
 AND (code IS NULL OR code IN ('TRANSPORT_UNKNOWN','TRANSPORT_RETRYABLE','IDEMPOTENCY_CONFLICT','PAYLOAD_INVALID','TRANSPORT_REJECTED','DEADLINE_EXPIRED'))
 AND "receiptHash" ~ '^[a-f0-9]{64}$'
 AND ("providerReceiptId" IS NULL OR dentabill_posting_token_valid("providerReceiptId",200))
 AND ("retryAfterMs" IS NULL OR "retryAfterMs" BETWEEN 1 AND 82800000)
 AND ((outcome IN ('SIMULATED','ACCEPTED') AND code IS NULL AND "providerReceiptId" IS NOT NULL AND "acceptedAt" IS NOT NULL AND "retryAfterMs" IS NULL)
   OR (outcome IN ('UNKNOWN','RETRYABLE','CONFLICT') AND code IS NOT NULL AND "providerReceiptId" IS NULL AND "acceptedAt" IS NULL))
);

CREATE FUNCTION dentabill_notification_source_current(run_id TEXT, org TEXT) RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE AS $$
DECLARE r "InferenceRun"%ROWTYPE; ev "CallEvent"%ROWTYPE; src JSONB; turns JSONB; raw TEXT; snap JSONB;
BEGIN
 SELECT * INTO r FROM "InferenceRun" WHERE id=run_id AND "organizationId"=org;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO ev FROM "CallEvent" WHERE "callId"=r."callId" AND "eventType" IN ('call.ended','webhook.call.ended') AND data ? 'transcript'
   ORDER BY timestamp DESC,id DESC LIMIT 1 FOR SHARE;
 IF ev.id IS NOT NULL THEN
   snap:=ev.data->'transcript';
   IF jsonb_typeof(snap) IS DISTINCT FROM 'object'
     OR COALESCE(jsonb_typeof(snap->'text'),'missing') NOT IN ('string','null')
     OR COALESCE(jsonb_typeof(snap->'turns'),'missing') NOT IN ('array','null') THEN RETURN false; END IF;
   IF jsonb_typeof(snap->'turns')='array' AND EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'turns') x(t)
     WHERE jsonb_typeof(t) IS DISTINCT FROM 'object' OR COALESCE(t->>'role','') NOT IN ('agent','user')
       OR jsonb_typeof(t->'text') IS DISTINCT FROM 'string'
       OR COALESCE(jsonb_typeof(t->'startOffsetSeconds'),'missing') NOT IN ('number','null')
       OR (jsonb_typeof(t->'startOffsetSeconds')='number' AND (t->>'startOffsetSeconds')::numeric<0)) THEN RETURN false; END IF;
 END IF;
 IF r.provider='FIREWORKS' THEN
   src:=r."requestPayload"->'sources'->0;
   RETURN COALESCE(ev.id IS NOT NULL AND src->>'id'='transcript.'||ev.id AND src->>'text'=ev.data->'transcript'->>'text'
     AND src->>'version'=encode(sha256(convert_to(ev.data->'transcript'->>'text','UTF8')),'hex'),false);
 END IF;
 IF ev.id IS NOT NULL THEN
   raw:=ev.data->'transcript'->>'text';
   IF jsonb_typeof(ev.data->'transcript'->'turns')='array' AND jsonb_array_length(ev.data->'transcript'->'turns')>0 THEN
     SELECT jsonb_agg(jsonb_build_object('role',CASE el->>'role' WHEN 'user' THEN 'remote' ELSE el->>'role' END,
       'text',el->>'text','timestamp',to_char(ev.timestamp,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY position),
       COALESCE(raw,string_agg('['||(CASE el->>'role' WHEN 'user' THEN 'remote' ELSE el->>'role' END)||'] '||(el->>'text'),E'\n' ORDER BY position))
       INTO turns,raw FROM jsonb_array_elements(ev.data->'transcript'->'turns') WITH ORDINALITY x(el,position);
   ELSE
     turns:=CASE WHEN raw IS NOT NULL AND length(raw)>0 THEN jsonb_build_array(jsonb_build_object('role','source','text',raw,
       'timestamp',to_char(ev.timestamp,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) ELSE '[]'::jsonb END;
   END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM "CallEvent" WHERE "callId"=r."callId" AND ("eventType" LIKE 'webhook.call.%' OR "eventType"='call.transcript_snapshot')) THEN RETURN false; END IF;
   SELECT jsonb_agg(jsonb_build_object('role',role,'text',text,'timestamp',to_char(timestamp,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY timestamp,id),
     string_agg('['||role||'] '||text,E'\n' ORDER BY timestamp,id) INTO turns,raw FROM (
       SELECT id,timestamp,data->>'text' AS text,CASE data->>'role' WHEN 'user' THEN 'remote' WHEN 'rep' THEN 'representative' WHEN 'human' THEN 'representative' ELSE data->>'role' END AS role
       FROM "CallEvent" WHERE "callId"=r."callId" AND "eventType"='call.transcript' AND jsonb_typeof(data->'text')='string' AND length(data->>'text')>0
         AND data->>'role' IN ('agent','system','representative','user','rep','human')) selected;
 END IF;
 RETURN COALESCE(raw IS NOT NULL AND r."requestPayload"->'call'->>'rawTranscript'=raw
   AND r."requestPayload"->'input'->'transcriptTurns'=turns,false);
END;
$$;

CREATE FUNCTION dentabill_notification_blocker(org TEXT, notification UUID, at_time TIMESTAMP)
RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE n "ReviewNotificationIntent"%ROWTYPE; r "InferenceRun"%ROWTYPE; u "User"%ROWTYPE; source_order TIMESTAMP;
BEGIN
 SELECT * INTO n FROM "ReviewNotificationIntent" WHERE id=notification AND "organizationId"=org;
 IF NOT FOUND THEN RETURN 'SOURCE_NOT_READY'; END IF;
 SELECT * INTO r FROM "InferenceRun" WHERE id=n."inferenceRunId" AND "organizationId"=org;
 IF (n.purpose='REVIEW_AVAILABLE' AND (r.state<>'APPLIED' OR r."appliedAt" IS DISTINCT FROM n."sourceMarkerAt"))
 OR (n.purpose='INFERENCE_REVIEW_REQUIRED' AND (r.state NOT IN ('UNKNOWN','REJECTED') OR r."reviewAppliedAt" IS DISTINCT FROM n."sourceMarkerAt")) THEN RETURN 'SOURCE_NOT_READY'; END IF;
 IF EXISTS(SELECT 1 FROM "ClaimObservationReview" WHERE "organizationId"=org AND "observationId"=n."observationId") THEN RETURN 'SOURCE_REVIEWED'; END IF;
 IF EXISTS(SELECT 1 FROM "Claim" WHERE id=n."claimId" AND "organizationId"=org AND "updatedAt"<>n."resultingClaimVersion") THEN RETURN 'SOURCE_CHANGED'; END IF;
 IF r."claimVersion"<>n."resultingClaimVersion" AND (r.provider='FIREWORKS' OR
   (n.purpose='INFERENCE_REVIEW_REQUIRED' AND NOT EXISTS(SELECT 1 FROM "AuditLog"
     WHERE "organizationId"=org AND "resourceType"='Call' AND "resourceId"=n."callId"
       AND action IN ('summary.dlq','summary.inference_review_required') AND metadata->>'runId'=r.id
       AND metadata->'transitionApplied'='true'::jsonb))) THEN RETURN 'SOURCE_CHANGED'; END IF;
 SELECT COALESCE(i."createdAt",c."createdAt") INTO source_order FROM "Call" c LEFT JOIN "CallIntent" i ON i."callId"=c.id AND i."organizationId"=org
   WHERE c.id=n."callId" AND c."claimId"=n."claimId" AND c."organizationId"=org;
 IF EXISTS(SELECT 1 FROM "Call" c LEFT JOIN "CallIntent" i ON i."callId"=c.id AND i."organizationId"=org
   WHERE c."claimId"=n."claimId" AND c."organizationId"=org AND
   (COALESCE(i."createdAt",c."createdAt")>source_order OR (COALESCE(i."createdAt",c."createdAt")=source_order AND c.id>n."callId")))
 OR EXISTS(SELECT 1 FROM "InferenceRun" WHERE "organizationId"=org AND "callId"=n."callId" AND generation>n.generation)
 OR EXISTS(SELECT 1 FROM "ObservationRegeneration" WHERE "organizationId"=org AND "callId"=n."callId" AND generation>n.generation AND "expiresAt">at_time)
 THEN RETURN 'SOURCE_SUPERSEDED'; END IF;
 IF NOT dentabill_notification_source_current(n."inferenceRunId",org) THEN RETURN 'SOURCE_CHANGED'; END IF;
 IF n."recipientUserId" IS NULL THEN RETURN 'MISSING_RECIPIENT'; END IF;
 SELECT * INTO u FROM "User" WHERE id=n."recipientUserId" AND "organizationId"=org FOR SHARE;
 IF NOT FOUND OR u.role IS DISTINCT FROM n."recipientRole" OR u.email IS DISTINCT FROM n."recipientEmail" THEN RETURN 'RECIPIENT_CHANGED'; END IF;
 RETURN NULL;
END;
$$;

CREATE FUNCTION dentabill_admit_notification_intent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "InferenceRun"%ROWTYPE; u "User"%ROWTYPE; a "ObservationRegeneration"%ROWTYPE; obs TEXT; marker TIMESTAMP;
BEGIN
 UPDATE "Organization" SET id=id WHERE id=NEW."organizationId";
 IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_NOTIFICATION_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM "InferenceRun" WHERE id=NEW."inferenceRunId" AND "organizationId"=NEW."organizationId" FOR SHARE;
 IF NOT FOUND OR ROW(r."claimId",r."callId",r.generation,r."sourceHash",r."requestHash",r."claimVersion",r."regenerationId") IS DISTINCT FROM
 ROW(NEW."claimId",NEW."callId",NEW.generation,NEW."sourceHash"::text,NEW."requestHash"::text,NEW."claimVersion",NEW."regenerationId")
 THEN RAISE EXCEPTION 'REVIEW_NOTIFICATION_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 SELECT id INTO obs FROM "ClaimObservation" WHERE "inferenceRunId"=r.id AND "organizationId"=r."organizationId" AND "sourceHash"=r."sourceHash" AND "requestHash"=r."requestHash" AND "claimVersion"=r."claimVersion";
 IF NEW.purpose='REVIEW_AVAILABLE' THEN
   marker:=r."appliedAt";
   IF r.state<>'APPLIED' OR marker IS NULL OR (r.provider='FIREWORKS' AND (obs IS NULL OR NEW."observationId" IS DISTINCT FROM obs OR NEW."summaryId" IS NOT NULL))
     OR (r.provider='SYNTHETIC' AND (r."summaryId" IS NULL OR NEW."summaryId" IS DISTINCT FROM r."summaryId" OR NEW."observationId" IS NOT NULL
       OR NOT EXISTS(SELECT 1 FROM "AuditLog" WHERE "organizationId"=r."organizationId" AND action='claim.transition' AND "resourceType"='Claim' AND "resourceId"=r."claimId" AND metadata->>'summaryId'=r."summaryId")))
   THEN RAISE EXCEPTION 'REVIEW_NOTIFICATION_SOURCE_NOT_READY' USING ERRCODE='23514'; END IF;
 ELSE
   marker:=r."reviewAppliedAt";
   IF r.state NOT IN ('UNKNOWN','REJECTED') OR marker IS NULL OR NEW."summaryId" IS NOT NULL OR NEW."observationId" IS NOT NULL THEN
     RAISE EXCEPTION 'REVIEW_NOTIFICATION_SOURCE_NOT_READY' USING ERRCODE='23514'; END IF;
 END IF;
 IF marker IS DISTINCT FROM NEW."sourceMarkerAt" OR NOT EXISTS(SELECT 1 FROM "Claim" WHERE id=r."claimId" AND "organizationId"=r."organizationId" AND "updatedAt"=NEW."resultingClaimVersion") THEN
   RAISE EXCEPTION 'REVIEW_NOTIFICATION_VERSION_INVALID' USING ERRCODE='23514'; END IF;
 IF r."regenerationId" IS NULL THEN
   IF NEW."actorKind"<>'SYSTEM' THEN RAISE EXCEPTION 'REVIEW_NOTIFICATION_ACTOR_INVALID' USING ERRCODE='23514'; END IF;
 ELSE
   SELECT * INTO a FROM "ObservationRegeneration" WHERE id=r."regenerationId" AND "organizationId"=r."organizationId";
   IF NEW."actorKind"<>'USER' OR NEW."actorUserId" IS DISTINCT FROM a."createdByUserId" OR NEW."actorRole" IS DISTINCT FROM a."createdByRole" THEN
     RAISE EXCEPTION 'REVIEW_NOTIFICATION_ACTOR_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT * INTO u FROM "User" WHERE "organizationId"=NEW."organizationId" AND role IN ('OWNER','ADMIN') AND dentabill_notification_email_valid(email) ORDER BY "createdAt",id LIMIT 1 FOR SHARE;
 IF ROW(NEW."recipientUserId",NEW."recipientRole",NEW."recipientEmail") IS DISTINCT FROM ROW(u.id,u.role,u.email) THEN
   RAISE EXCEPTION 'REVIEW_NOTIFICATION_RECIPIENT_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "ReviewNotificationIntent_admission" BEFORE INSERT ON "ReviewNotificationIntent" FOR EACH ROW EXECUTE FUNCTION dentabill_admit_notification_intent();
CREATE FUNCTION dentabill_seal_notification_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NOT EXISTS(SELECT 1 FROM "ReviewNotificationDelivery" WHERE "notificationId"=NEW.id AND "organizationId"=NEW."organizationId") THEN RAISE EXCEPTION 'REVIEW_NOTIFICATION_INCOMPLETE' USING ERRCODE='23514'; END IF; RETURN NULL; END;
$$;
CREATE CONSTRAINT TRIGGER "ReviewNotificationIntent_complete" AFTER INSERT ON "ReviewNotificationIntent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentabill_seal_notification_intent();

CREATE FUNCTION dentabill_admit_notification_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n "ReviewNotificationIntent"%ROWTYPE; d "ReviewNotificationDelivery"%ROWTYPE;
BEGIN
 UPDATE "Organization" SET id=id WHERE id=NEW."organizationId";
 SELECT * INTO n FROM "ReviewNotificationIntent" WHERE id=NEW."notificationId" AND "organizationId"=NEW."organizationId";
 SELECT * INTO d FROM "ReviewNotificationDelivery" WHERE "notificationId"=NEW."notificationId" AND "organizationId"=NEW."organizationId";
 IF n.id IS NULL OR d."notificationId" IS NULL OR NOT isfinite(NEW."startedAt")
   OR (d.state<>'PENDING' AND NOT(d.state='SENDING' AND d."leaseExpiresAt"<=NEW."startedAt"))
   OR NEW."startedAt"<d."availableAt" OR NEW."startedAt"<d."updatedAt" OR d."attemptCount">=5
   OR (d."retryDeadlineAt" IS NOT NULL AND NEW."startedAt">=d."retryDeadlineAt")
   OR NEW."attemptNumber"<>d."attemptCount"+1 OR NEW."deliveryKey"<>n."deliveryKey" OR NEW."payloadHash" IS DISTINCT FROM n."payloadHash"
   OR dentabill_notification_blocker(NEW."organizationId",NEW."notificationId",NEW."startedAt") IS NOT NULL
 THEN RAISE EXCEPTION 'REVIEW_NOTIFICATION_ATTEMPT_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "ReviewNotificationAttempt_admission" BEFORE INSERT ON "ReviewNotificationAttempt" FOR EACH ROW EXECUTE FUNCTION dentabill_admit_notification_attempt();

CREATE FUNCTION dentabill_admit_notification_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "ReviewNotificationAttempt"%ROWTYPE; d "ReviewNotificationDelivery"%ROWTYPE; expected TEXT;
BEGIN
 UPDATE "Organization" SET id=id WHERE id=NEW."organizationId";
 SELECT * INTO a FROM "ReviewNotificationAttempt" WHERE id=NEW."attemptId" AND "notificationId"=NEW."notificationId" AND "organizationId"=NEW."organizationId";
 SELECT * INTO d FROM "ReviewNotificationDelivery" WHERE "notificationId"=NEW."notificationId" AND "organizationId"=NEW."organizationId";
 IF a.id IS NULL OR d.state IS DISTINCT FROM 'SENDING' OR d."activeAttemptId" IS DISTINCT FROM a.id OR d."leaseToken" IS DISTINCT FROM a."leaseToken"
   OR NEW."completedAt"<a."startedAt" OR NEW."completedAt">=d."leaseExpiresAt" OR NOT isfinite(NEW."completedAt")
   OR NEW.outcome='ACCEPTED' OR (NEW."acceptedAt" IS NOT NULL AND (NEW."acceptedAt"<d."firstSubmissionAt" OR NEW."acceptedAt">NEW."completedAt"))
   OR (NEW.outcome='UNKNOWN' AND NEW.code<>'TRANSPORT_UNKNOWN')
   OR (NEW.outcome='RETRYABLE' AND NEW.code<>'TRANSPORT_RETRYABLE')
   OR (NEW.outcome='CONFLICT' AND NEW.code NOT IN ('IDEMPOTENCY_CONFLICT','PAYLOAD_INVALID','TRANSPORT_REJECTED','DEADLINE_EXPIRED'))
 THEN RAISE EXCEPTION 'REVIEW_NOTIFICATION_RECEIPT_INVALID' USING ERRCODE='23514'; END IF;
 expected:=encode(sha256(convert_to('{"outcome":'||to_json(NEW.outcome)::text||',"code":'||COALESCE(to_json(NEW.code)::text,'null')||
   ',"providerReceiptId":'||COALESCE(to_json(NEW."providerReceiptId")::text,'null')||',"acceptedAt":'||
   COALESCE(to_json(to_char(NEW."acceptedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text,'null')||',"retryAfterMs":'||COALESCE(NEW."retryAfterMs"::text,'null')||'}','UTF8')),'hex');
 IF NEW."receiptHash"<>expected THEN RAISE EXCEPTION 'REVIEW_NOTIFICATION_RECEIPT_HASH_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "ReviewNotificationReceipt_admission" BEFORE INSERT ON "ReviewNotificationReceipt" FOR EACH ROW EXECUTE FUNCTION dentabill_admit_notification_receipt();

CREATE FUNCTION dentabill_guard_notification_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n "ReviewNotificationIntent"%ROWTYPE; a "ReviewNotificationAttempt"%ROWTYPE; r "ReviewNotificationReceipt"%ROWTYPE;
 blocker TEXT; expected_state TEXT; expected_reason TEXT; expected_available TIMESTAMP; expected_ambiguous BOOLEAN;
BEGIN
 UPDATE "Organization" SET id=id WHERE id=NEW."organizationId";
 SELECT * INTO n FROM "ReviewNotificationIntent" WHERE id=NEW."notificationId" AND "organizationId"=NEW."organizationId";
 IF n.id IS NULL OR NOT isfinite(NEW."updatedAt") OR NOT isfinite(NEW."availableAt") THEN
   RAISE EXCEPTION 'REVIEW_NOTIFICATION_DELIVERY_INVALID' USING ERRCODE='23514'; END IF;
 blocker:=CASE WHEN n."recipientUserId" IS NULL THEN 'MISSING_RECIPIENT' ELSE dentabill_notification_blocker(NEW."organizationId",NEW."notificationId",NEW."updatedAt") END;
 IF TG_OP='INSERT' THEN
   expected_state:=CASE WHEN blocker IS NULL THEN 'PENDING' WHEN blocker IN ('MISSING_RECIPIENT','RECIPIENT_CHANGED') THEN 'BLOCKED' ELSE 'SUPPRESSED' END;
   IF NEW.state<>expected_state OR NEW.reason IS DISTINCT FROM blocker OR NEW."attemptCount"<>0 OR NEW."firstSubmissionAt" IS NOT NULL
     OR NEW."updatedAt"<>n."createdAt" OR NEW."availableAt"<>n."createdAt" OR NEW."activeAttemptId" IS NOT NULL THEN
     RAISE EXCEPTION 'REVIEW_NOTIFICATION_INITIAL_STATE_INVALID' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF NEW."organizationId"<>OLD."organizationId" OR NEW."notificationId"<>OLD."notificationId"
   OR NEW."updatedAt"<OLD."updatedAt" OR OLD.state IN ('SIMULATED','ACCEPTED','SUPPRESSED','QUARANTINED')
   OR (OLD."firstSubmissionAt" IS NOT NULL AND ROW(NEW."firstSubmissionAt",NEW."retryDeadlineAt",NEW.mode) IS DISTINCT FROM ROW(OLD."firstSubmissionAt",OLD."retryDeadlineAt",OLD.mode))
 THEN RAISE EXCEPTION 'REVIEW_NOTIFICATION_STATE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF NEW.state='SENDING' THEN
   SELECT * INTO a FROM "ReviewNotificationAttempt" WHERE id=NEW."activeAttemptId" AND "notificationId"=NEW."notificationId" AND "organizationId"=NEW."organizationId";
   IF a.id IS NULL OR a."attemptNumber"<>OLD."attemptCount"+1 OR NEW."attemptCount"<>a."attemptNumber"
     OR NEW."leaseToken"<>a."leaseToken" OR NEW."leaseExpiresAt"<>a."leaseExpiresAt" OR NEW."updatedAt"<>a."startedAt"
     OR NEW."availableAt"<>a."startedAt" OR NEW.reason IS NOT NULL OR blocker IS NOT NULL
     OR NEW.mode<>'SYNTHETIC' OR NEW."firstSubmissionAt"<>COALESCE(OLD."firstSubmissionAt",a."startedAt")
     OR NEW.ambiguous<>(OLD.ambiguous OR OLD.state='SENDING')
     OR (OLD.state<>'PENDING' AND NOT(OLD.state='SENDING' AND OLD."leaseExpiresAt"<=a."startedAt"))
   THEN RAISE EXCEPTION 'REVIEW_NOTIFICATION_LEASE_INVALID' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF NEW."attemptCount"<>OLD."attemptCount" OR NEW."firstSubmissionAt" IS DISTINCT FROM OLD."firstSubmissionAt"
   OR NEW."retryDeadlineAt" IS DISTINCT FROM OLD."retryDeadlineAt" OR NEW.mode IS DISTINCT FROM OLD.mode THEN
   RAISE EXCEPTION 'REVIEW_NOTIFICATION_COUNTER_INVALID' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM "ReviewNotificationReceipt" WHERE "attemptId"=OLD."activeAttemptId" AND "organizationId"=OLD."organizationId";
 IF OLD.state='SENDING' AND r.id IS NOT NULL THEN
   expected_available:=r."completedAt";
   expected_ambiguous:=OLD.ambiguous OR r.outcome IN ('UNKNOWN','CONFLICT');
   expected_reason:=r.code;
   IF r.outcome='SIMULATED' THEN expected_state:='SIMULATED'; expected_ambiguous:=false;
   ELSIF r.outcome='CONFLICT' THEN expected_state:='QUARANTINED';
   ELSIF OLD."attemptCount">=5 THEN expected_state:='QUARANTINED'; expected_reason:='ATTEMPTS_EXHAUSTED';
   ELSE
     expected_available:=r."completedAt"+make_interval(secs=>GREATEST(60000,COALESCE(r."retryAfterMs",0))::double precision/1000);
     IF expected_available>=OLD."retryDeadlineAt" THEN expected_state:='QUARANTINED'; expected_reason:='DEADLINE_EXPIRED'; expected_available:=r."completedAt";
     ELSE expected_state:='PENDING'; END IF;
   END IF;
   IF ROW(NEW.state,NEW.reason,NEW."availableAt",NEW.ambiguous,NEW."updatedAt") IS DISTINCT FROM ROW(expected_state,expected_reason,expected_available,expected_ambiguous,r."completedAt") THEN
     RAISE EXCEPTION 'REVIEW_NOTIFICATION_RESULT_STATE_INVALID' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF OLD.state='SENDING' AND OLD."leaseExpiresAt">NEW."updatedAt" THEN RAISE EXCEPTION 'REVIEW_NOTIFICATION_BUSY' USING ERRCODE='23514'; END IF;
 -- Human acknowledgement can suppress even a recipientless blocked intent, but
 -- never one that crossed a submission boundary.
 IF NEW.state='SUPPRESSED' AND OLD."firstSubmissionAt" IS NULL AND NEW.reason='SOURCE_REVIEWED'
   AND EXISTS(SELECT 1 FROM "ClaimObservationReview" WHERE "organizationId"=NEW."organizationId" AND "observationId"=n."observationId") THEN
   expected_state:='SUPPRESSED'; expected_reason:='SOURCE_REVIEWED';
 ELSIF blocker IS NOT NULL THEN
   expected_state:=CASE WHEN OLD."firstSubmissionAt" IS NOT NULL THEN 'QUARANTINED' WHEN blocker IN ('MISSING_RECIPIENT','RECIPIENT_CHANGED') THEN 'BLOCKED' ELSE 'SUPPRESSED' END;
   expected_reason:=blocker;
 ELSIF OLD."retryDeadlineAt"<=NEW."updatedAt" THEN expected_state:='QUARANTINED'; expected_reason:='DEADLINE_EXPIRED';
 ELSIF OLD."attemptCount">=5 THEN expected_state:='QUARANTINED'; expected_reason:='ATTEMPTS_EXHAUSTED';
 ELSE RAISE EXCEPTION 'REVIEW_NOTIFICATION_TRANSITION_INVALID' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.state,NEW.reason,NEW."availableAt",NEW.ambiguous) IS DISTINCT FROM
   ROW(expected_state,expected_reason,NEW."updatedAt",OLD.ambiguous OR OLD.state='SENDING') THEN
   RAISE EXCEPTION 'REVIEW_NOTIFICATION_DISPOSITION_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "ReviewNotificationDelivery_guard" BEFORE INSERT OR UPDATE ON "ReviewNotificationDelivery" FOR EACH ROW EXECUTE FUNCTION dentabill_guard_notification_delivery();
CREATE FUNCTION dentabill_seal_notification_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "ReviewNotificationDelivery" d WHERE d."notificationId"=NEW."notificationId" AND d."organizationId"=NEW."organizationId"
   AND d."attemptCount">=NEW."attemptNumber" AND d."firstSubmissionAt" IS NOT NULL
   AND (d."activeAttemptId"=NEW.id OR EXISTS(SELECT 1 FROM "ReviewNotificationReceipt" WHERE "attemptId"=NEW.id AND "organizationId"=NEW."organizationId"))) THEN
   RAISE EXCEPTION 'REVIEW_NOTIFICATION_ATTEMPT_INCOMPLETE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "ReviewNotificationAttempt_complete" AFTER INSERT ON "ReviewNotificationAttempt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentabill_seal_notification_attempt();
CREATE FUNCTION dentabill_seal_notification_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "ReviewNotificationDelivery" WHERE "notificationId"=NEW."notificationId" AND "organizationId"=NEW."organizationId" AND "activeAttemptId"=NEW."attemptId") THEN
   RAISE EXCEPTION 'REVIEW_NOTIFICATION_RECEIPT_INCOMPLETE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "ReviewNotificationReceipt_complete" AFTER INSERT ON "ReviewNotificationReceipt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dentabill_seal_notification_receipt();

COMMIT;

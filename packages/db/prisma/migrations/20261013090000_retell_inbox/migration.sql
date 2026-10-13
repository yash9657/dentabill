ALTER TABLE "RetellWebhookEvent"
  ADD COLUMN "payload" JSONB,
  ADD COLUMN "payloadHash" TEXT,
  ADD COLUMN "processedAt" TIMESTAMP(3),
  ADD COLUMN "organizationId" TEXT;

-- Historical markers have no recoverable event payload. Never fabricate it.
UPDATE "RetellWebhookEvent" SET "processedAt" = "receivedAt";

CREATE INDEX "RetellWebhookEvent_retellCallId_processedAt_idx"
  ON "RetellWebhookEvent"("retellCallId", "processedAt");

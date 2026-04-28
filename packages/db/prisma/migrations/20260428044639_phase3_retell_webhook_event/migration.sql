-- CreateTable
CREATE TABLE "RetellWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "retellCallId" TEXT,
    "eventType" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetellWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetellWebhookEvent_eventId_key" ON "RetellWebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "RetellWebhookEvent_retellCallId_idx" ON "RetellWebhookEvent"("retellCallId");

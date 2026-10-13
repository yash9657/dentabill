-- DropForeignKey
ALTER TABLE "CallIntent" DROP CONSTRAINT "CallIntent_callId_fkey";

-- DropForeignKey
ALTER TABLE "CallIntent" DROP CONSTRAINT "CallIntent_claimId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "Call_id_claimId_organizationId_key" ON "Call"("id", "claimId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CallIntent_callId_claimId_organizationId_key" ON "CallIntent"("callId", "claimId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_id_organizationId_key" ON "Claim"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "CallIntent" ADD CONSTRAINT "CallIntent_claimId_organizationId_fkey" FOREIGN KEY ("claimId", "organizationId") REFERENCES "Claim"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallIntent" ADD CONSTRAINT "CallIntent_callId_claimId_organizationId_fkey" FOREIGN KEY ("callId", "claimId", "organizationId") REFERENCES "Call"("id", "claimId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


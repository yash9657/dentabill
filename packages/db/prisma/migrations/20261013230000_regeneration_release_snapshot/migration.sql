-- Pre-snapshot approvals cannot authorize additional spending: the helper rejects {}.
ALTER TABLE "ObservationRegeneration" ADD COLUMN "releaseSnapshot" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ObservationRegeneration" ALTER COLUMN "releaseSnapshot" DROP DEFAULT;

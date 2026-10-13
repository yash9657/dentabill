-- Review disposition and its claim/audit effects must commit before delivery acknowledgement.
ALTER TABLE "InferenceRun" ADD COLUMN "reviewAppliedAt" TIMESTAMP(3);

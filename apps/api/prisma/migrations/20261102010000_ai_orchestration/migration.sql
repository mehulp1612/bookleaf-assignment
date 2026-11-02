ALTER TYPE "JobTask" ADD VALUE 'DRAFT';
ALTER TABLE "Ticket" ADD COLUMN "draftJobId" TEXT;
ALTER TABLE "AiRun" ADD COLUMN "jobId" TEXT REFERENCES "AiJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AiRun_jobId_idx" ON "AiRun"("jobId");
ALTER TABLE "AiJob"
  ADD COLUMN "contextFingerprint" TEXT,
  ADD COLUMN "providerKey" TEXT,
  ADD COLUMN "resultRunId" TEXT REFERENCES "AiRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "stale" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "force" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "AiJob_providerKey_state_leaseExpiresAt_idx" ON "AiJob"("providerKey", "state", "leaseExpiresAt");
-- Existing M04 records have one active classification generation per ticket.
CREATE UNIQUE INDEX "AiJob_one_active_task" ON "AiJob"("ticketId", "task") WHERE state IN ('QUEUED', 'RUNNING');
CREATE TABLE "AiProviderState" (
  id TEXT PRIMARY KEY,
  "windowStartedAt" TIMESTAMPTZ(3) NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  paused BOOLEAN NOT NULL DEFAULT false,
  "pauseReason" TEXT,
  "resumeAt" TIMESTAMPTZ(3)
);

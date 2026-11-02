CREATE TYPE "AiRunTask" AS ENUM ('CLASSIFICATION', 'DRAFT');
CREATE TYPE "AiRunState" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TABLE "AiRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ticketId" TEXT NOT NULL REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "task" "AiRunTask" NOT NULL,
  "state" "AiRunState" NOT NULL DEFAULT 'RUNNING',
  "contextRevision" INTEGER NOT NULL,
  "contextFingerprint" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "kbVersion" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "result" JSONB,
  "failure" JSONB,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "latencyMs" INTEGER,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "finishedAt" TIMESTAMPTZ(3)
);
CREATE INDEX "AiRun_ticketId_task_contextFingerprint_startedAt_idx" ON "AiRun"("ticketId", "task", "contextFingerprint", "startedAt");

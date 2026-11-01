CREATE TYPE "TicketStatus" AS ENUM ('OPEN','IN_PROGRESS','RESOLVED','CLOSED');
CREATE TYPE "TicketPriority" AS ENUM ('CRITICAL','HIGH','MEDIUM','LOW');
CREATE TYPE "TicketCategory" AS ENUM ('ROYALTY_PAYMENTS','ISBN_METADATA','PRINTING_QUALITY','DISTRIBUTION_AVAILABILITY','BOOK_STATUS_PRODUCTION','GENERAL_INQUIRY');
CREATE TYPE "ClassificationSource" AS ENUM ('DEFAULT','AI','MANUAL');
CREATE TYPE "JobState" AS ENUM ('QUEUED','RUNNING','SUCCEEDED','FAILED');
CREATE TYPE "JobTask" AS ENUM ('CLASSIFICATION');
CREATE TYPE "TicketEventType" AS ENUM ('STATUS_CHANGED','ASSIGNMENT_CHANGED','CATEGORY_CHANGED','PRIORITY_CHANGED');

CREATE TABLE "Ticket" (
  "id" TEXT PRIMARY KEY,
  "authorId" TEXT NOT NULL REFERENCES "Author"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "bookId" TEXT REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "subject" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
  "category" "TicketCategory",
  "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
  "categorySource" "ClassificationSource" NOT NULL DEFAULT 'DEFAULT',
  "prioritySource" "ClassificationSource" NOT NULL DEFAULT 'DEFAULT',
  "categoryOverridden" BOOLEAN NOT NULL DEFAULT false,
  "priorityOverridden" BOOLEAN NOT NULL DEFAULT false,
  "suggestedCategory" "TicketCategory",
  "suggestedPriority" "TicketPriority",
  "classificationRationale" TEXT,
  "classificationState" "JobState" NOT NULL DEFAULT 'QUEUED',
  "classificationJobId" TEXT,
  "classificationRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("classificationRevision" >= 0),
  "contextRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("contextRevision" >= 0),
  "assigneeId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Ticket_authorId_createdAt_id_idx" ON "Ticket"("authorId","createdAt","id");
CREATE INDEX "Ticket_status_priority_createdAt_id_idx" ON "Ticket"("status","priority","createdAt","id");
CREATE TABLE "TicketReply" (
  "id" TEXT PRIMARY KEY,
  "ticketId" TEXT NOT NULL REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "senderId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "body" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "TicketReply_ticketId_senderId_idempotencyKey_key" ON "TicketReply"("ticketId","senderId","idempotencyKey");
CREATE INDEX "TicketReply_ticketId_createdAt_id_idx" ON "TicketReply"("ticketId","createdAt","id");
CREATE TABLE "TicketNote" (
  "id" TEXT PRIMARY KEY,
  "ticketId" TEXT NOT NULL REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "creatorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TicketNote_ticketId_createdAt_id_idx" ON "TicketNote"("ticketId","createdAt","id");
CREATE TABLE "TicketEvent" (
  "id" TEXT PRIMARY KEY,
  "ticketId" TEXT NOT NULL REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "type" "TicketEventType" NOT NULL,
  "oldValue" TEXT,
  "newValue" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TicketEvent_ticketId_createdAt_id_idx" ON "TicketEvent"("ticketId","createdAt","id");
CREATE TABLE "AiJob" (
  "id" TEXT PRIMARY KEY,
  "ticketId" TEXT NOT NULL REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "task" "JobTask" NOT NULL DEFAULT 'CLASSIFICATION',
  "deduplicationKey" TEXT NOT NULL,
  "state" "JobState" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "contextRevision" INTEGER NOT NULL CHECK ("contextRevision" >= 0),
  "failureReason" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3)
);
CREATE UNIQUE INDEX "AiJob_deduplicationKey_key" ON "AiJob"("deduplicationKey");
CREATE INDEX "AiJob_state_availableAt_idx" ON "AiJob"("state","availableAt");
CREATE INDEX "AiJob_ticketId_idx" ON "AiJob"("ticketId");

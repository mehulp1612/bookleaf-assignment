-- Preserve M02 identity anchors. Catalog import fills these fields without
-- inventing profile values for anchors that have not been imported yet.
ALTER TABLE "Author"
  ADD COLUMN "name" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "joinedDate" DATE;

CREATE TABLE "Book" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "authorId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "isbn" TEXT NOT NULL,
  "genre" TEXT NOT NULL,
  "publicationDate" DATE,
  "status" TEXT NOT NULL,
  "mrpPaise" BIGINT,
  "authorRoyaltyPerCopyPaise" BIGINT,
  "totalCopiesSold" INTEGER NOT NULL CHECK ("totalCopiesSold" >= 0),
  "totalRoyaltyEarnedPaise" BIGINT NOT NULL,
  "royaltyPaidPaise" BIGINT NOT NULL,
  "royaltyPendingPaise" BIGINT NOT NULL,
  "lastRoyaltyPayoutDate" DATE,
  "printPartner" TEXT,
  "availableOn" TEXT[] NOT NULL,
  CONSTRAINT "Book_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ("mrpPaise" BETWEEN 0 AND 9007199254740991),
  CHECK ("authorRoyaltyPerCopyPaise" BETWEEN 0 AND 9007199254740991),
  CHECK ("totalRoyaltyEarnedPaise" BETWEEN 0 AND 9007199254740991),
  CHECK ("royaltyPaidPaise" BETWEEN 0 AND 9007199254740991),
  CHECK ("royaltyPendingPaise" BETWEEN 0 AND 9007199254740991)
);
CREATE INDEX "Book_authorId_id_idx" ON "Book"("authorId", "id");

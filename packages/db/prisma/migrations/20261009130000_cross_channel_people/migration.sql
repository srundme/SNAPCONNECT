ALTER TABLE "Contact" ADD COLUMN "personId" TEXT;
CREATE INDEX "Contact_personId_idx" ON "Contact"("personId");

CREATE TABLE "PersonMatch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "askedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PersonMatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonMatch_contactId_candidateId_key" ON "PersonMatch"("contactId", "candidateId");
CREATE INDEX "PersonMatch_workspaceId_status_idx" ON "PersonMatch"("workspaceId", "status");

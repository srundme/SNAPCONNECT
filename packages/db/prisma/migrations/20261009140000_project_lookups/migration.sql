CREATE TABLE "ProjectLookup" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "found" BOOLEAN NOT NULL,
    "result" JSONB,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectLookup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectLookup_key_key" ON "ProjectLookup"("key");

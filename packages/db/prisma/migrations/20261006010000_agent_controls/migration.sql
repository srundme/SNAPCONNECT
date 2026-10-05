ALTER TABLE "Workspace" ADD COLUMN "knowledgeBase" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Workspace" ADD COLUMN "agentSettings" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Media" ADD COLUMN "seenSummary" TEXT;

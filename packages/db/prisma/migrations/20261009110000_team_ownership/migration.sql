ALTER TABLE "Conversation" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "ownerChangedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "staffUserId" TEXT;

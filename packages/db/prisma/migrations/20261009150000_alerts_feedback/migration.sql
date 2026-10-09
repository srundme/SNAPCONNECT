CREATE TABLE "TeamAlert" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "deliveredTo" TEXT,
    "readAt" TIMESTAMP(3),
    "readBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamAlert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TeamAlert_workspaceId_createdAt_idx" ON "TeamAlert"("workspaceId", "createdAt");
CREATE INDEX "TeamAlert_conversationId_kind_idx" ON "TeamAlert"("conversationId", "kind");

CREATE TABLE "ReplyFeedback" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReplyFeedback_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReplyFeedback_messageId_userId_key" ON "ReplyFeedback"("messageId", "userId");
CREATE INDEX "ReplyFeedback_workspaceId_createdAt_idx" ON "ReplyFeedback"("workspaceId", "createdAt");

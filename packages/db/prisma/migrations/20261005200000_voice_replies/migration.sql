ALTER TABLE "Message" ADD COLUMN "voice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Message" ADD COLUMN "voiceClipId" TEXT;

CREATE TABLE "VoiceClip" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceClip_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VoiceClip_createdAt_idx" ON "VoiceClip"("createdAt");

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('ADMIN', 'AGENT', 'VIEWER');

-- CreateEnum
CREATE TYPE "WorkspaceMode" AS ENUM ('SIMULATION', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('INSTAGRAM', 'FACEBOOK');

-- CreateEnum
CREATE TYPE "ConnectionMode" AS ENUM ('SIMULATION', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "IdentityType" AS ENUM ('COMMENT_AUTHOR', 'MESSAGING_PARTICIPANT');

-- CreateEnum
CREATE TYPE "Qualification" AS ENUM ('NEW', 'IN_PROGRESS', 'CONTACTABLE', 'QUALIFIED', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "SalesStage" AS ENUM ('UNASSIGNED', 'ASSIGNED', 'CONTACTED', 'MEETING_BOOKED', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "ConversationOwner" AS ENUM ('AI', 'HUMAN', 'PAUSED');

-- CreateEnum
CREATE TYPE "CrmState" AS ENUM ('NOT_READY', 'PENDING', 'SYNCED', 'RETRYING', 'NEEDS_ATTENTION');

-- CreateEnum
CREATE TYPE "OutboundState" AS ENUM ('RESERVED', 'SENDING', 'ACCEPTED', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RuleCoverage" AS ENUM ('ALL_POSTS', 'SELECTED_POSTS');

-- CreateEnum
CREATE TYPE "CommentFilter" AS ENUM ('KEYWORDS', 'ALL_ELIGIBLE_COMMENTS');

-- CreateEnum
CREATE TYPE "MessageAuthor" AS ENUM ('PROSPECT', 'AI', 'STAFF', 'SYSTEM');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DISPATCHED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "platformRole" "PlatformRole" NOT NULL DEFAULT 'STAFF',
    "suspendedAt" TIMESTAMP(3),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "automationPaused" BOOLEAN NOT NULL DEFAULT false,
    "productName" TEXT NOT NULL DEFAULT 'SnapServe Social',

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "mode" "WorkspaceMode" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "phoneRegion" TEXT NOT NULL DEFAULT 'IN',
    "automationPaused" BOOLEAN NOT NULL DEFAULT false,
    "retentionDays" INTEGER NOT NULL DEFAULT 365,
    "serviceAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minimumBudgetMinor" INTEGER,
    "brandName" TEXT NOT NULL DEFAULT 'Demo Interiors',
    "services" TEXT NOT NULL DEFAULT 'Residential and commercial interiors',
    "tone" TEXT NOT NULL DEFAULT 'Clear, brief and factual',
    "faqs" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "workspaceId" TEXT,
    "workspaceRole" "WorkspaceRole",
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaAppConfig" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "secretKeyId" TEXT NOT NULL,
    "verifyTokenCiphertext" TEXT NOT NULL,
    "oauthRedirectUrl" TEXT NOT NULL,
    "webhookUrl" TEXT NOT NULL,

    CONSTRAINT "MetaAppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "mode" "ConnectionMode" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "username" TEXT,
    "appConfigId" TEXT,
    "credentialCiphertext" TEXT,
    "credentialKeyId" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pageTasks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subscribedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "automationPaused" BOOLEAN NOT NULL DEFAULT true,
    "facebookReelsVerified" BOOLEAN NOT NULL DEFAULT false,
    "credentialCheckedAt" TIMESTAMP(3),
    "webhookVerifiedAt" TIMESTAMP(3),
    "accountSubscribedAt" TIMESTAMP(3),
    "lastRealCommentAt" TIMESTAMP(3),
    "lastRealMessageAt" TIMESTAMP(3),
    "lastSimulatedEventAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZohoConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mode" "ConnectionMode" NOT NULL,
    "accountsUrl" TEXT,
    "apiDomain" TEXT,
    "credentialCiphertext" TEXT,
    "credentialKeyId" TEXT,
    "refreshCiphertext" TEXT,
    "expiresAt" TIMESTAMP(3),
    "externalKeyField" TEXT,
    "phoneField" TEXT NOT NULL DEFAULT 'Phone',
    "instagramSource" TEXT NOT NULL DEFAULT 'Instagram',
    "facebookSource" TEXT NOT NULL DEFAULT 'Facebook',
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "ZohoConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "caption" TEXT,
    "supportStatus" TEXT NOT NULL DEFAULT 'SUPPORTED',
    "unsupportedReason" TEXT,
    "excluded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriggerRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "coverage" "RuleCoverage" NOT NULL,
    "commentFilter" "CommentFilter" NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selectedMediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "openingTemplate" TEXT NOT NULL,
    "cooldownHours" INTEGER NOT NULL DEFAULT 24,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "TriggerRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "displayName" TEXT,
    "username" TEXT,
    "chosenName" TEXT,
    "optedOutAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactIdentity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "identityType" "IdentityType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,

    CONSTRAINT "ContactIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "owner" "ConversationOwner" NOT NULL DEFAULT 'AI',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "lastUserMessageAt" TIMESTAMP(3),
    "sourceMediaId" TEXT,
    "sourceCommentId" TEXT,
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "author" "MessageAuthor" NOT NULL,
    "body" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "connectionId" TEXT NOT NULL,
    "activeContactKey" TEXT,
    "qualification" "Qualification" NOT NULL DEFAULT 'NEW',
    "salesStage" "SalesStage" NOT NULL DEFAULT 'UNASSIGNED',
    "crmState" "CrmState" NOT NULL DEFAULT 'NOT_READY',
    "assignedUserId" TEXT,
    "city" TEXT,
    "projectType" TEXT,
    "propertyType" TEXT,
    "workType" TEXT,
    "requirement" TEXT,
    "budgetRaw" TEXT,
    "budgetAmountMinor" INTEGER,
    "budgetMinMinor" INTEGER,
    "budgetMaxMinor" INTEGER,
    "budgetCurrency" TEXT,
    "budgetDeclined" BOOLEAN NOT NULL DEFAULT false,
    "timeframeRaw" TEXT,
    "timeframeDeclined" BOOLEAN NOT NULL DEFAULT false,
    "phoneRaw" TEXT,
    "phoneE164" TEXT,
    "phoneDeclined" BOOLEAN NOT NULL DEFAULT false,
    "whatsappRaw" TEXT,
    "whatsappE164" TEXT,
    "whatsappDeclined" BOOLEAN NOT NULL DEFAULT false,
    "sameNumberConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "preferredChannel" TEXT,
    "phonePermission" BOOLEAN NOT NULL DEFAULT false,
    "whatsappPermission" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceMediaId" TEXT,
    "sourceCommentId" TEXT,
    "qualificationReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "handoffReason" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "contactableAt" TIMESTAMP(3),
    "qualifiedAt" TIMESTAMP(3),
    "testRecord" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadFieldEvidence" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "evidence" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadFieldEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "disclosure" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalNote" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "mode" "ConnectionMode" NOT NULL,
    "connectionId" TEXT,
    "workspaceId" TEXT,
    "dedupKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "type" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundAttempt" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "commentExternalId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "status" "OutboundState" NOT NULL DEFAULT 'RESERVED',
    "providerMessageId" TEXT,
    "providerRecipientId" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentDecision" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "commentExternalId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ruleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmMapping" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "crmId" TEXT,
    "syncedRevision" INTEGER NOT NULL DEFAULT 0,
    "simulated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CrmMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSyncAttempt" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmSyncAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConfigVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "profile" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "simulated" BOOLEAN NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "valid" BOOLEAN NOT NULL,
    "diagnostic" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "workspaceId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InferenceLease" (
    "id" TEXT NOT NULL,
    "holder" TEXT,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "InferenceLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,
    "detail" TEXT,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OauthState" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "OauthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_workspaceId_userId_key" ON "Membership"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MetaAppConfig_scope_appId_key" ON "MetaAppConfig"("scope", "appId");

-- CreateIndex
CREATE INDEX "ChannelConnection_workspaceId_channel_idx" ON "ChannelConnection"("workspaceId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_channel_mode_externalAccountId_key" ON "ChannelConnection"("channel", "mode", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ZohoConnection_workspaceId_key" ON "ZohoConnection"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Media_connectionId_externalId_key" ON "Media"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_channel_idx" ON "Contact"("workspaceId", "channel");

-- CreateIndex
CREATE INDEX "ContactIdentity_contactId_idx" ON "ContactIdentity"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactIdentity_workspaceId_channel_connectionId_identityTy_key" ON "ContactIdentity"("workspaceId", "channel", "connectionId", "identityType", "externalId");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_updatedAt_idx" ON "Conversation"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_connectionId_externalMessageId_key" ON "Message"("connectionId", "externalMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_activeContactKey_key" ON "Lead"("activeContactKey");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_qualification_idx" ON "Lead"("workspaceId", "qualification");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_dedupKey_key" ON "WebhookEvent"("dedupKey");

-- CreateIndex
CREATE INDEX "OutboxJob_status_availableAt_idx" ON "OutboxJob"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundAttempt_connectionId_commentExternalId_key" ON "OutboundAttempt"("connectionId", "commentExternalId");

-- CreateIndex
CREATE INDEX "CommentDecision_connectionId_commentExternalId_idx" ON "CommentDecision"("connectionId", "commentExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmMapping_leadId_key" ON "CrmMapping"("leadId");

-- CreateIndex
CREATE INDEX "CrmSyncAttempt_leadId_createdAt_idx" ON "CrmSyncAttempt"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiConfigVersion_workspaceId_version_key" ON "AiConfigVersion"("workspaceId", "version");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_createdAt_idx" ON "AuditEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OauthState_stateHash_key" ON "OauthState"("stateHash");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_appConfigId_fkey" FOREIGN KEY ("appConfigId") REFERENCES "MetaAppConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZohoConnection" ADD CONSTRAINT "ZohoConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerRule" ADD CONSTRAINT "TriggerRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerRule" ADD CONSTRAINT "TriggerRule_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactIdentity" ADD CONSTRAINT "ContactIdentity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadFieldEvidence" ADD CONSTRAINT "LeadFieldEvidence_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmMapping" ADD CONSTRAINT "CrmMapping_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;


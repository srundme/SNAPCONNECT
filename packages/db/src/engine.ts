import {
  buildZohoRecord,
  demoQualificationSettings,
  deterministicIntent,
  requestsTeamSwitch,
  duplicateCheckFields,
  evaluateQualification,
  nextReplyPrompt,
  openingForPost,
  absorbTranscript,
  acceptExtractedAnswers,
  numericQuestion,
  asksSomething,
  asksForName,
  cleanName,
  mentionsOwnName,
  nameInReply,
  assistantContext,
  collectionBrief,
  parseLeadFields,
  parseLeadQuestions,
  parseZohoSendWhen,
  questionBrief,
  readyForZoho,
  screenLead,
  scriptedReply,
  scriptQuestionFor,
  replyAsksFor,
  chatLanguageSample,
  languageName,
  salesBriefing,
  humanizeReply,
  zohoValuesFromQuestions,
  resolveReplyPrompts,
  openingEligibility,
  pausesBlock,
  agentIdentity,
  platformSystemRules,
  withAutomationDisclosure,
  parsePhone,
  projectTypeFromText,
  replyEligibility,
  routingDecision,
  selectRule,
  surfaceSupport,
  validateAiOutput,
  wrongPhoneIn,
  validPhonesIn,
  dedupKey,
  type Channel,
  type ConnectionMode,
  type LeadSnapshot,
  type ReplyPromptField,
  type NormalizedEvent,
  nameConcern,
  phoneProblem,
  dropRepeatedSentences,
  humanBubbles,
  readingMs,
  typingMs,
  unrealisticAnswers,
  dropCannedLines,
  oneAddress,
  mediaNote,
} from "@snapsocial/domain";
import { decryptSecret, encryptSecret, fixtureLlm, refreshZohoAccess, simulationAdapter, simulationZoho, neutralDirection, speechLocale, speechScript, speechSentences, zohoAdapter, ZohoOAuthError, type LlmProvider, type SendResult, type Speaker, type VoiceDirection, type ZohoAdapter } from "@snapsocial/integrations";
import { randomBytes } from "node:crypto";
import type { Db } from "./client";

export type SendConnection = {
  id: string;
  channel: Channel;
  mode: ConnectionMode;
  externalAccountId: string;
  credentialCiphertext: string | null;
};

export type SendInput = {
  connection: SendConnection;
  purpose: "opening" | "text";
  commentId?: string;
  recipientId?: string;
  text: string;
  audioUrl?: string;
};

export type Runtime = {
  now: () => Date;
  llm: LlmProvider;
  zoho: ZohoAdapter;
  send: (input: SendInput) => Promise<SendResult>;
  phoneRegion: string;
  credentialKeys: Record<string, Buffer>;
  zohoClientId: string | null;
  zohoClientSecret: string | null;
  zohoAccountsUrl: string | null;
  transcribe?: (audioUrl: string, bearerToken?: string) => Promise<string>;
  seeImage?: (imageUrl: string, bearerToken?: string) => Promise<string>;
  whatsappMediaUrl?: (mediaId: string, token: string) => Promise<string>;
  speak?: Speaker;
  publicBaseUrl?: string;
  replySettleMs?: number;
  /** Waits like a person reading and typing. Left out in tests, so replies go straight away. */
  pause?: (ms: number) => Promise<void>;
};

function sendConnection(connection: SendConnection): SendConnection {
  return {
    id: connection.id,
    channel: connection.channel,
    mode: connection.mode,
    externalAccountId: connection.externalAccountId,
    credentialCiphertext: connection.credentialCiphertext,
  };
}

export function simulatedSend(input: SendInput): Promise<SendResult> {
  const adapter = simulationAdapter(input.connection.channel);
  if (input.purpose === "opening") {
    return adapter.sendPrivateReply({ accountId: "sim", commentId: input.commentId ?? "", text: input.text, token: "sim" });
  }
  if (input.audioUrl) {
    return adapter.sendAudio({ accountId: "sim", recipientId: input.recipientId ?? "", audioUrl: input.audioUrl, token: "sim" });
  }
  return adapter.sendText({ accountId: "sim", recipientId: input.recipientId ?? "", text: input.text, token: "sim" });
}

function leadRule(workspace: { serviceAreas: string[]; minimumBudgetMinor: number | null; requiredLeadFields: string[]; zohoSendWhen: string }) {
  return {
    settings: {
      ...demoQualificationSettings,
      requiredProjectFields: parseLeadFields(workspace.requiredLeadFields),
      serviceAreas: workspace.serviceAreas,
      minimumBudgetMinor: workspace.minimumBudgetMinor,
    },
    sendWhen: parseZohoSendWhen(workspace.zohoSendWhen),
  };
}

export function simulationRuntime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    now: () => new Date(),
    llm: fixtureLlm(),
    zoho: simulationZoho(),
    send: simulatedSend,
    phoneRegion: "IN",
    credentialKeys: {},
    zohoClientId: null,
    zohoClientSecret: null,
    zohoAccountsUrl: null,
    ...overrides,
  };
}

type JobRecord = {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
};

export async function ingestEvents(
  db: Db,
  input: { channel: Channel; mode: ConnectionMode; events: NormalizedEvent[]; receivedAt: Date },
): Promise<{ stored: number; rejected: number; duplicate: number }> {
  let stored = 0;
  let rejected = 0;
  let duplicate = 0;
  for (const event of input.events) {
    if (event.kind === "ignore") {
      rejected += 1;
      continue;
    }
    const connections = await db.channelConnection.findMany({
      where: {
        channel: input.channel,
        mode: input.mode,
        externalAccountId: event.externalAccountId,
        revokedAt: null,
      },
      select: { id: true, workspaceId: true },
    });
    const route = routingDecision(connections.map((item) => item.id));
    if ("reject" in route) {
      await db.webhookEvent.create({
        data: {
          channel: input.channel,
          mode: input.mode,
          dedupKey: `${input.mode}:${dedupKey(input.channel, event)}:rejected:${input.receivedAt.toISOString()}`,
          eventType: event.kind,
          externalAccountId: event.externalAccountId,
          payload: sanitize(event),
          status: "REJECTED",
          reason: route.reject,
          receivedAt: input.receivedAt,
        },
      });
      rejected += 1;
      continue;
    }
    const connection = connections.find((item) => item.id === route.connectionId);
    if (!connection) continue;
    const key = `${connection.id}:${dedupKey(input.channel, event)}`;
    try {
      await db.$transaction(async (tx) => {
        const webhook = await tx.webhookEvent.create({
          data: {
            channel: input.channel,
            mode: input.mode,
            connectionId: connection.id,
            workspaceId: connection.workspaceId,
            dedupKey: key,
            eventType: event.kind === "comment" ? `comment.${event.action}` : event.kind === "message_edit" ? "message.edit" : "message",
            externalAccountId: event.externalAccountId,
            payload: sanitize(event),
            receivedAt: input.receivedAt,
          },
        });
        await tx.outboxJob.create({
          data: {
            workspaceId: connection.workspaceId,
            type: "PROCESS_EVENT",
            payload: { webhookEventId: webhook.id, contactId: null },
          },
        });
      });
      stored += 1;
    } catch (error) {
      if (isUnique(error)) duplicate += 1;
      else throw error;
    }
  }
  return { stored, rejected, duplicate };
}

export async function processAvailableJobs(db: Db, runtime: Runtime, limit = 25): Promise<number> {
  const jobs = await db.outboxJob.findMany({
    where: { status: { in: ["PENDING", "DISPATCHED"] }, availableAt: { lte: runtime.now() } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let processed = 0;
  for (const job of jobs) {
    const claimed = await db.outboxJob.updateMany({
      where: { id: job.id, status: { in: ["PENDING", "DISPATCHED"] } },
      data: { status: "PROCESSING" },
    });
    if (claimed.count !== 1) continue;
    let outcome: "done" | "requeue" | "failed" = "failed";
    try {
      outcome = await processJob(db, job, runtime);
    } catch (error) {
      outcome = "failed";
      await db.outboxJob.update({
        where: { id: job.id },
        data: { status: "FAILED", lastError: error instanceof Error ? error.message.slice(0, 500) : "Processing failed" },
      });
      continue;
    }
    if (outcome === "requeue") continue;
    await db.outboxJob.update({
      where: { id: job.id },
      data: { status: outcome === "failed" ? "FAILED" : "COMPLETED", lastError: outcome === "failed" ? "Processing failed" : null },
    });
    processed += 1;
  }
  return processed;
}

async function processJob(db: Db, job: JobRecord, runtime: Runtime): Promise<"done" | "requeue" | "failed"> {
  const payload = asRecord(job.payload);
  try {
    if (job.type === "PROCESS_EVENT") return processWebhook(db, String(payload.webhookEventId), runtime);
    if (job.type === "SEND_OPENING") return sendOpening(db, String(payload.outboundAttemptId), runtime);
    if (job.type === "INFERENCE") return runInference(db, job, runtime);
    if (job.type === "CRM_SYNC") return syncLead(db, String(payload.leadId), runtime);
    return "done";
  } catch {
    return "failed";
  }
}

async function processWebhook(db: Db, webhookEventId: string, runtime: Runtime): Promise<"done"> {
  const event = await db.webhookEvent.findUniqueOrThrow({ where: { id: webhookEventId } });
  const body = asRecord(event.payload);
  if (event.eventType.startsWith("comment.")) {
    await handleComment(db, event.connectionId ?? "", body, event.eventType.endsWith("add"), runtime);
  } else if (event.eventType === "message") {
    await handleMessage(db, event.connectionId ?? "", body, runtime);
  } else if (event.eventType === "message.edit") {
    await handleMessageEdit(db, event.connectionId ?? "", body, runtime);
  }
  await db.webhookEvent.update({ where: { id: event.id }, data: { status: "PROCESSED" } });
  return "done";
}

async function handleComment(db: Db, connectionId: string, body: Record<string, unknown>, isAdd: boolean, runtime: Runtime) {
  const connection = await db.channelConnection.findUniqueOrThrow({
    where: { id: connectionId },
    include: { workspace: true, rules: true, media: true },
  });
  const commentId = String(body.commentId ?? "");
  if (!isAdd || body.action !== "add") {
    await db.commentDecision.create({
      data: {
        workspaceId: connection.workspaceId,
        connectionId,
        commentExternalId: commentId,
        outcome: "SKIPPED",
        reason: "Edits and deletions do not open a conversation.",
      },
    });
    return;
  }
  if (String(body.authorId ?? "") === connection.externalAccountId) {
    await skip(db, connection, commentId, "Self-comment.");
    return;
  }
  const platform = await db.platformSetting.findUnique({ where: { id: "platform" } });
  const surface = surfaceSupport({
    channel: connection.channel,
    contentType: String(body.contentType ?? "UNKNOWN"),
    facebookReelsVerified: connection.facebookReelsVerified,
    isAd: Boolean(body.isAd),
    isLive: Boolean(body.isLive),
    isGroup: Boolean(body.isGroup),
  });
  const excluded = new Set(connection.media.filter((item) => item.excluded).map((item) => item.externalId));
  const decision = selectRule({
    rules: connection.rules.map((rule) => ({
      id: rule.id,
      priority: rule.priority,
      coverage: rule.coverage,
      commentFilter: rule.commentFilter,
      keywords: rule.keywords,
      exclusions: rule.exclusions,
      selectedMediaIds: rule.selectedMediaIds,
      excludedMediaIds: [...excluded],
      active: rule.active,
      activatedAt: rule.activatedAt,
    })),
    text: String(body.text ?? ""),
    mediaId: body.mediaId ? String(body.mediaId) : null,
    commentAt: new Date(String(body.commentedAt)),
  });
  const contact = await ensureCommentContact(db, connection, body);
  if (contact.optedOutAt) return skip(db, connection, commentId, "Contact is opted out.");
  const winner = decision.winner;
  const mediaId = body.mediaId ? String(body.mediaId) : null;
  const openConversation = await db.conversation.findFirst({ where: { contactId: contact.id, connectionId }, select: { sourceMediaId: true } });
  const samePost = Boolean(mediaId && openConversation?.sourceMediaId === mediaId);
  const cooldownMs = (winner?.id ? connection.rules.find((rule) => rule.id === winner.id)?.cooldownHours ?? 24 : 24) * 60 * 60 * 1000;
  if (samePost && contact.lastOutboundAt && runtime.now().getTime() - contact.lastOutboundAt.getTime() < cooldownMs) {
    return skip(db, connection, commentId, "This person already received a reply for this post.");
  }
  const paused = pausesBlock({
    platform: Boolean(platform?.automationPaused),
    workspace: connection.workspace.automationPaused || connection.workspace.status !== "ACTIVE",
    connection: connection.automationPaused || Boolean(connection.revokedAt),
    rule: !winner,
    conversation: false,
  });
  const eligibility = openingEligibility({
    commentAt: new Date(String(body.commentedAt)),
    now: runtime.now(),
    alreadyReserved: false,
    paused,
    optedOut: Boolean(contact.optedOutAt),
    connectionReady: !connection.revokedAt,
    supportedSurface: surface.supported && Boolean(winner),
    unsupportedReason: surface.reason ?? decision.reason,
  });
  if (!eligibility.allowed || !winner) {
    return skip(db, connection, commentId, eligibility.allowed ? decision.reason : eligibility.reason);
  }
  const rule = connection.rules.find((item) => item.id === winner.id);
  try {
    await db.$transaction(async (tx) => {
      const found = await tx.conversation.findFirst({ where: { contactId: contact.id, connectionId } });
      const conversation = !found
        ? await tx.conversation.create({
            data: {
              workspaceId: connection.workspaceId,
              connectionId,
              contactId: contact.id,
              channel: connection.channel,
              sourceMediaId: mediaId,
              sourceCommentId: commentId,
            },
          })
        : mediaId && found.sourceMediaId !== mediaId
          ? await tx.conversation.update({
              where: { id: found.id },
              data: { sourceMediaId: mediaId, sourceCommentId: commentId },
            })
          : found;
      const existingLead = await tx.lead.findFirst({ where: { contactId: contact.id, archivedAt: null } });
      if (!existingLead) {
        await tx.lead.create({
          data: {
            workspaceId: connection.workspaceId,
            contactId: contact.id,
            channel: connection.channel,
            connectionId,
            activeContactKey: contact.id,
            sourceType: "COMMENT",
            sourceMediaId: body.mediaId ? String(body.mediaId) : null,
            sourceCommentId: commentId,
            testRecord: connection.mode === "SIMULATION",
          },
        });
      }
      const attempt = await tx.outboundAttempt.create({
        data: {
          workspaceId: connection.workspaceId,
          connectionId,
          channel: connection.channel,
          commentExternalId: commentId,
          contactId: contact.id,
          conversationId: conversation.id,
          simulated: connection.mode === "SIMULATION",
        },
      });
      await tx.message.create({
        data: {
          workspaceId: connection.workspaceId,
          connectionId,
          conversationId: conversation.id,
          author: "SYSTEM",
          body: "Opening reserved.",
        },
      });
      await tx.commentDecision.create({
        data: {
          workspaceId: connection.workspaceId,
          connectionId,
          commentExternalId: commentId,
          outcome: "OPENING_RESERVED",
          reason: decision.reason,
          ruleId: rule?.id,
        },
      });
      await tx.outboxJob.create({
        data: {
          workspaceId: connection.workspaceId,
          type: "SEND_OPENING",
          payload: {
            outboundAttemptId: attempt.id,
            contactId: contact.id,
            text: openingForPost(
              rule?.openingTemplate ?? "",
              connection.media.find((item) => item.externalId === String(body.mediaId ?? ""))?.openingMessage,
            ),
          },
        },
      });
      });
  } catch (error) {
    if (isUnique(error)) return skip(db, connection, commentId, "An opening is already reserved for this comment.");
    throw error;
  }
  await touchConnection(db, connection.id, connection.mode, "comment", runtime.now());
}

async function handleMessage(db: Db, connectionId: string, body: Record<string, unknown>, runtime: Runtime) {
  if (body.isEcho === true) return;
  const connection = await db.channelConnection.findUniqueOrThrow({ where: { id: connectionId }, include: { workspace: true } });
  const senderId = String(body.senderId ?? "");
  const sentAt = new Date(String(body.sentAt ?? runtime.now().toISOString()));
  const referralCommentId = body.referralCommentId ? String(body.referralCommentId) : null;
  const participant = await db.contactIdentity.findUnique({
    where: {
      workspaceId_channel_connectionId_identityType_externalId: {
        workspaceId: connection.workspaceId,
        channel: connection.channel,
        connectionId,
        identityType: "MESSAGING_PARTICIPANT",
        externalId: senderId,
      },
    },
  });
  let contactId = participant?.contactId ?? null;
  if (referralCommentId) {
    const attempt = await db.outboundAttempt.findUnique({
      where: { connectionId_commentExternalId: { connectionId, commentExternalId: referralCommentId } },
    });
    if (attempt && !participant) {
      const linked = await db.contact.findUnique({ where: { id: attempt.contactId } });
      if (linked) {
        contactId = linked.id;
        try {
          await db.contactIdentity.create({
            data: {
              workspaceId: connection.workspaceId,
              connectionId,
              contactId: linked.id,
              channel: connection.channel,
              identityType: "MESSAGING_PARTICIPANT",
              externalId: senderId,
              evidence: "PROVIDER_REFERRAL",
            },
          });
        } catch (error) {
          if (!isUnique(error)) throw error;
        }
      }
    } else if (attempt && participant && participant.contactId !== attempt.contactId) {
      await db.auditEvent.create({
        data: {
          workspaceId: connection.workspaceId,
          action: "identity.conflict",
          entityType: "Contact",
          entityId: participant.contactId,
          summary: "Referral identified another contact. Records were not merged.",
        },
      });
    }
  }
  const whatsapp = connection.channel === "WHATSAPP";
  const senderName = body.senderName ? String(body.senderName).slice(0, 120) : null;
  const senderPhone = whatsapp ? parsePhone(`+${senderId}`, runtime.phoneRegion) : null;
  const knownPhone = senderPhone?.kind === "valid"
    ? { phoneE164: senderPhone.e164, phonePermission: true, whatsappE164: senderPhone.e164 }
    : {};
  if (!contactId) {
    const created = await db.contact.create({
      data: {
        workspaceId: connection.workspaceId,
        connectionId,
        channel: connection.channel,
        ...(senderName ? { displayName: senderName } : {}),
        identities: {
          create: {
            workspaceId: connection.workspaceId,
            connectionId,
            channel: connection.channel,
            identityType: "MESSAGING_PARTICIPANT",
            externalId: senderId,
            evidence: "INBOUND_MESSAGE",
          },
        },
      },
    });
    contactId = created.id;
    await db.lead.create({
      data: {
        workspaceId: connection.workspaceId,
        contactId,
        channel: connection.channel,
        connectionId,
        activeContactKey: contactId,
        sourceType: "DIRECT_MESSAGE",
        testRecord: connection.mode === "SIMULATION",
        ...knownPhone,
      },
    });
  } else if (whatsapp) {
    const activeLead = await db.lead.findFirst({ where: { contactId, archivedAt: null } });
    if (!activeLead) {
      await db.lead.create({
        data: {
          workspaceId: connection.workspaceId,
          contactId,
          channel: connection.channel,
          connectionId,
          activeContactKey: contactId,
          sourceType: "DIRECT_MESSAGE",
          testRecord: connection.mode === "SIMULATION",
          ...knownPhone,
        },
      });
    }
    if (senderName) {
      await db.contact.updateMany({ where: { id: contactId, displayName: null }, data: { displayName: senderName } });
    }
  }
  const existingConversation = await db.conversation.findFirst({
    where: { contactId, connectionId },
    orderBy: { createdAt: "desc" },
  });
  const conversation = existingConversation ?? (await db.conversation.create({
    data: { workspaceId: connection.workspaceId, connectionId, contactId, channel: connection.channel },
  }));
  const nextInbound = !conversation.lastUserMessageAt || sentAt > conversation.lastUserMessageAt ? sentAt : conversation.lastUserMessageAt;
  let text = String(body.text ?? "");
  const voice = !text.trim() && Boolean(body.audioUrl || body.audioMediaId);
  if (voice) {
    const transcript = runtime.transcribe
      ? await voiceTranscript(runtime, connection, body).catch((error: unknown) => {
          console.warn(`Voice transcription failed: ${error instanceof Error ? error.message : String(error)}`);
          return "";
        })
      : "";
    text = transcript.trim() ? transcript.trim() : "(Sent a voice message that could not be understood.)";
  }
  const mediaKind = typeof body.mediaKind === "string" && body.mediaKind ? body.mediaKind : null;
  if (mediaKind && !voice) {
    const seen = mediaKind === "image" ? await imageDescription(runtime, connection, body).catch((error: unknown) => {
      console.warn(`Photo description failed: ${error instanceof Error ? error.message : String(error)}`);
      return "";
    }) : "";
    const note = mediaNote(mediaKind, seen);
    text = text.trim() ? `${text.trim()} ${note}` : note;
  }
  if (!text.trim()) return;
  try {
    await db.message.create({
      data: {
        workspaceId: connection.workspaceId,
        connectionId,
        conversationId: conversation.id,
        author: "PROSPECT",
        body: text,
        externalMessageId: String(body.messageId ?? ""),
        voice,
        createdAt: sentAt,
      },
    });
  } catch (error) {
    if (isUnique(error)) return;
    throw error;
  }
  const updated = await db.conversation.update({
    where: { id: conversation.id },
    data: { lastUserMessageAt: nextInbound, revision: { increment: 1 } },
  });
  const lead = await db.lead.findFirst({ where: { contactId, archivedAt: null } });
  if (lead && lead.qualification === "NEW") {
    await db.lead.update({ where: { id: lead.id }, data: { qualification: "IN_PROGRESS" } });
  }
  const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
  const intent = deterministicIntent(text);
  if (intent.optOut) {
    await suppressContact(db, contact.id, connection.workspaceId, "Prospect opted out.");
    return;
  }
  const paused = connection.automationPaused || connection.workspace.automationPaused || Boolean(connection.revokedAt);
  if (updated.owner === "AI" && !paused && !contact.optedOutAt) {
    await db.outboxJob.create({
      data: {
        workspaceId: connection.workspaceId,
        type: "INFERENCE",
        payload: { conversationId: conversation.id, expectedRevision: updated.revision, contactId },
        availableAt: new Date(runtime.now().getTime() + (runtime.replySettleMs ?? 0) + (runtime.pause ? readingMs(text) : 0)),
      },
    });
  }
  await touchConnection(db, connection.id, connection.mode, "message", runtime.now());
}

const CONCERN = /\?|\b(why|how|what|when|who|enna|epdi|eppadi|eppo|yen|kyun|kya|kaise|kab|nobody called|no one called|not called|didn'?t call|already (told|gave|said|shared|sent)|i told you|told you|wait|problem|issue|worst|waste|angry|irritat\w*|confus\w*|not happy|disappoint\w*)\b/i;

/** The customer asked something or raised a concern, so the reply should not be pushed into the next lead question. */
function raisesConcern(text: string): boolean {
  return CONCERN.test(text);
}

function channelLabel(channel: Channel): string {
  return channel === "WHATSAPP" ? "WhatsApp" : channel === "FACEBOOK" ? "Facebook" : "Instagram";
}

async function voiceClip(
  db: Db,
  runtime: Runtime,
  input: {
    workspaceId: string;
    channel: Channel;
    text: string;
    chatLanguage: string | null;
    messages: Array<{ author: string; body: string }>;
  },
): Promise<{ id: string; url: string } | null> {
  if (!runtime.speak || !runtime.publicBaseUrl) return null;
  const { workspaceId, channel, text } = input;
  const spoken = speechLocale(text, input.chatLanguage);
  if (!spoken) return null;
  try {
    const chat = input.messages.filter((message) => message.author === "PROSPECT" || message.author === "AI");
    const customer = [...chat].reverse().find((message) => message.author === "PROSPECT")?.body ?? "";
    const earlier = chat
      .slice(-9, -1)
      .map((message) => `${message.author === "AI" ? "Assistant" : "Customer"}: ${message.body.replace(/\s+/g, " ").slice(0, 200)}`)
      .join("\n");
    let direction: VoiceDirection = neutralDirection;
    if (runtime.llm.directVoice) {
      direction = await runtime.llm.directVoice({ customer, sentences: speechSentences(text), earlier }).catch((error: unknown) => {
        console.warn(`Voice direction failed, using defaults: ${error instanceof Error ? error.message : String(error)}`);
        return direction;
      });
    }
    const transcript = speechScript(text, direction, { emotionTags: spoken.locale.startsWith("en") });
    if (!transcript) return null;
    console.info(`Voice reply: ${JSON.stringify({ ...direction, locale: spoken.locale, chars: transcript.length })}`);
    const format = channel === "INSTAGRAM" ? "wav" : "mp3";
    const speech = await runtime.speak({
      transcript,
      ...spoken,
      speed: transcript.includes("<spell>") ? Math.min(direction.speed, 0.95) : direction.speed,
      format,
    });
    const id = randomBytes(24).toString("base64url");
    await db.voiceClip.create({ data: { id, workspaceId, mimeType: speech.mimeType, data: Buffer.from(speech.audio) } });
    return { id, url: `${runtime.publicBaseUrl.replace(/\/$/, "")}/api/voice/${id}.${format}` };
  } catch (error) {
    console.warn(`Voice reply could not be made, sending text instead: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function voiceTranscript(
  runtime: Runtime,
  connection: { credentialCiphertext: string | null },
  body: Record<string, unknown>,
): Promise<string> {
  if (!runtime.transcribe) return "";
  if (body.audioUrl) return runtime.transcribe(String(body.audioUrl));
  if (!runtime.whatsappMediaUrl || !connection.credentialCiphertext) return "";
  const token = decryptSecret(connection.credentialCiphertext, runtime.credentialKeys);
  const url = await runtime.whatsappMediaUrl(String(body.audioMediaId), token);
  return runtime.transcribe(url, token);
}

async function imageDescription(
  runtime: Runtime,
  connection: { credentialCiphertext: string | null },
  body: Record<string, unknown>,
): Promise<string> {
  if (!runtime.seeImage) return "";
  if (body.imageUrl) return runtime.seeImage(String(body.imageUrl));
  if (!body.imageMediaId || !runtime.whatsappMediaUrl || !connection.credentialCiphertext) return "";
  const token = decryptSecret(connection.credentialCiphertext, runtime.credentialKeys);
  const url = await runtime.whatsappMediaUrl(String(body.imageMediaId), token);
  return runtime.seeImage(url, token);
}

async function handleMessageEdit(db: Db, connectionId: string, body: Record<string, unknown>, runtime: Runtime) {
  const connection = await db.channelConnection.findUniqueOrThrow({ where: { id: connectionId }, include: { workspace: true } });
  const externalMessageId = String(body.messageId ?? "");
  const text = String(body.text ?? "").trim();
  if (!externalMessageId || !text) return;
  const original = await db.message.findUnique({
    where: { connectionId_externalMessageId: { connectionId, externalMessageId } },
  });
  if (!original || original.author !== "PROSPECT" || original.body.trim() === text) return;
  await db.message.update({ where: { id: original.id }, data: { body: text } });
  await db.message.create({
    data: {
      workspaceId: connection.workspaceId,
      connectionId,
      conversationId: original.conversationId,
      author: "SYSTEM",
      body: `Customer edited a message. Before: "${original.body.slice(0, 300)}" Now: "${text.slice(0, 300)}"`,
      createdAt: runtime.now(),
    },
  });
  const conversation = await db.conversation.update({
    where: { id: original.conversationId },
    data: { revision: { increment: 1 } },
  });
  const contact = await db.contact.findUniqueOrThrow({ where: { id: conversation.contactId } });
  const phoneChanged = await applyEditedPhone(db, {
    contactId: contact.id,
    before: original.body,
    after: text,
    region: runtime.phoneRegion,
    channel: conversation.channel,
  });
  const paused = connection.automationPaused || connection.workspace.automationPaused || Boolean(connection.revokedAt);
  if (conversation.owner !== "AI" || paused || contact.optedOutAt) {
    await refreshLeadDetails(db, runtime, conversation.id, phoneChanged);
  } else {
    await db.outboxJob.create({
      data: {
        workspaceId: connection.workspaceId,
        type: "INFERENCE",
        payload: {
          conversationId: conversation.id,
          expectedRevision: conversation.revision,
          contactId: contact.id,
          editedFrom: original.body.slice(0, 300),
          editedTo: text.slice(0, 300),
          ...(phoneChanged ? { phoneChanged: true } : {}),
        },
        availableAt: new Date(runtime.now().getTime() + (runtime.replySettleMs ?? 0)),
      },
    });
  }
  await touchConnection(db, connection.id, connection.mode, "message", runtime.now());
}

/**
 * Re-reads the edited chat without replying, for chats staff own or automation has paused,
 * so a corrected name, answer or call time still reaches the lead and the same Zoho record.
 */
async function refreshLeadDetails(db: Db, runtime: Runtime, conversationId: string, alreadyChanged: boolean) {
  const conversation = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: "asc" } }, contact: true, workspace: true },
  });
  const lead = await db.lead.findFirst({ where: { contactId: conversation.contactId, archivedAt: null }, include: { crm: true } });
  if (!lead || conversation.contact.optedOutAt) return;
  const questions = parseLeadQuestions(conversation.workspace.leadQuestions);
  const form = questions.length ? await readLeadForm(runtime, questions, conversation.messages) : null;
  const answers = { ...answerRecord(lead.answers), ...(form?.answers ?? {}) };
  const name = form?.name ?? conversation.contact.chosenName;
  const phoneE164 = conversation.channel === "WHATSAPP" ? lead.phoneE164 : form?.phoneE164 ?? lead.phoneE164;
  const callbackTime = form?.callbackTime ?? lead.timeframeRaw;
  const changed = JSON.stringify(answers) !== JSON.stringify(answerRecord(lead.answers))
    || name !== conversation.contact.chosenName
    || phoneE164 !== lead.phoneE164
    || callbackTime !== lead.timeframeRaw;
  if (changed) {
    if (name !== conversation.contact.chosenName) {
      await db.contact.update({ where: { id: conversation.contactId }, data: { chosenName: name } });
    }
    await db.lead.update({
      where: { id: lead.id },
      data: { answers, phoneE164, timeframeRaw: callbackTime, revision: { increment: 1 } },
    });
  }
  if (changed && !alreadyChanged && (lead.crm?.crmId || lead.crmState === "SYNCED")) {
    await db.outboxJob.create({
      data: { workspaceId: lead.workspaceId, type: "CRM_SYNC", payload: { leadId: lead.id, contactId: conversation.contactId } },
    });
  }
}

/**
 * A corrected number replaces the recorded one straight away, even when staff own the chat or
 * automation is paused, and a lead that already reached Zoho is re-synced so the same record gets it.
 */
async function applyEditedPhone(
  db: Db,
  input: { contactId: string; before: string; after: string; region?: string; channel: string },
): Promise<boolean> {
  if (input.channel === "WHATSAPP") return false;
  const lead = await db.lead.findFirst({ where: { contactId: input.contactId, archivedAt: null }, include: { crm: true } });
  if (!lead) return false;
  const region = input.region ?? "IN";
  const before = validPhonesIn(input.before, region);
  const after = validPhonesIn(input.after, region);
  const next = after.find((phone) => !before.includes(phone));
  if (!next || next === lead.phoneE164) return false;
  if (lead.phoneE164 && after.includes(lead.phoneE164)) return false;
  const hadNumber = before.length > 0 || /\d{6,}/.test(input.before.replace(/[\s-]/g, ""));
  if (lead.phoneE164 && !hadNumber) return false;
  await db.lead.update({
    where: { id: lead.id },
    data: { phoneE164: next, phonePermission: true, revision: { increment: 1 } },
  });
  if (lead.crm?.crmId || lead.crmState === "SYNCED") {
    await db.outboxJob.create({
      data: { workspaceId: lead.workspaceId, type: "CRM_SYNC", payload: { leadId: lead.id, contactId: input.contactId } },
    });
  }
  return true;
}

async function sendOpening(db: Db, attemptId: string, runtime: Runtime): Promise<"done" | "requeue"> {
  const attempt = await db.outboundAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  if (attempt.status === "ACCEPTED" || attempt.status === "UNKNOWN" || attempt.status === "PERMANENT_FAILURE") return "done";
  const connection = await db.channelConnection.findUniqueOrThrow({ where: { id: attempt.connectionId }, include: { workspace: true } });
  const contact = await db.contact.findUniqueOrThrow({ where: { id: attempt.contactId } });
  const decision = await db.commentDecision.findFirst({ where: { connectionId: attempt.connectionId, commentExternalId: attempt.commentExternalId, outcome: "OPENING_RESERVED" } });
  const event = await db.webhookEvent.findFirst({
    where: { connectionId: attempt.connectionId, eventType: "comment.add" },
    orderBy: { receivedAt: "desc" },
  });
  const commentedAt = new Date(String(asRecord(event?.payload).commentedAt ?? attempt.createdAt.toISOString()));
  const platform = await db.platformSetting.findUnique({ where: { id: "platform" } });
  const eligibility = openingEligibility({
    commentAt: commentedAt,
    now: runtime.now(),
    alreadyReserved: false,
    paused: pausesBlock({
      platform: Boolean(platform?.automationPaused),
      workspace: connection.workspace.automationPaused,
      connection: connection.automationPaused || Boolean(connection.revokedAt),
      rule: false,
      conversation: false,
    }),
    optedOut: Boolean(contact.optedOutAt),
    connectionReady: !connection.revokedAt && connection.workspace.status === "ACTIVE",
    supportedSurface: true,
  });
  if (!eligibility.allowed) {
    await db.outboundAttempt.update({ where: { id: attempt.id }, data: { status: "PERMANENT_FAILURE", lastError: eligibility.reason } });
    return "done";
  }
  const job = await db.outboxJob.findFirst({ where: { type: "SEND_OPENING", payload: { path: ["outboundAttemptId"], equals: attempt.id } } });
  const text = String(asRecord(job?.payload).text ?? decision?.reason ?? "");
  const template = withAutomationDisclosure(text || "Thanks for your comment. How can we help?", connection.workspace.brandName, connection.workspace.agentName);
  const result = await runtime.send({ connection: sendConnection(connection), purpose: "opening", commentId: attempt.commentExternalId, text: template });
  await db.outboundAttempt.update({
    where: { id: attempt.id },
    data: {
      status: result.status,
      providerMessageId: result.status === "ACCEPTED" ? result.providerMessageId : null,
      providerRecipientId: result.status === "ACCEPTED" ? result.providerRecipientId : null,
      lastError: result.status === "ACCEPTED" ? null : result.error,
      simulated: result.simulated,
    },
  });
  if (result.status === "ACCEPTED" && attempt.conversationId) {
    await db.message.create({
      data: {
        workspaceId: attempt.workspaceId,
        connectionId: attempt.connectionId,
        conversationId: attempt.conversationId,
        author: "AI",
        body: template,
        externalMessageId: result.providerMessageId,
      },
    });
    await db.contact.update({ where: { id: contact.id }, data: { lastOutboundAt: runtime.now() } });
    if (result.providerRecipientId) {
      await db.contactIdentity.upsert({
        where: {
          workspaceId_channel_connectionId_identityType_externalId: {
            workspaceId: attempt.workspaceId,
            channel: attempt.channel,
            connectionId: attempt.connectionId,
            identityType: "MESSAGING_PARTICIPANT",
            externalId: result.providerRecipientId,
          },
        },
        update: {},
        create: {
          workspaceId: attempt.workspaceId,
          connectionId: attempt.connectionId,
          contactId: attempt.contactId,
          channel: attempt.channel,
          identityType: "MESSAGING_PARTICIPANT",
          externalId: result.providerRecipientId,
          evidence: "PROVIDER_SEND_RESPONSE",
        },
      });
    }
  }
  if (result.status === "RETRYABLE_FAILURE") {
    await db.outboxJob.updateMany({
      where: { type: "SEND_OPENING", status: "PROCESSING" },
      data: { status: "PENDING", availableAt: new Date(runtime.now().getTime() + backoff(attempt.updatedAt.getTime() % 5)), attempts: { increment: 1 } },
    });
    return "requeue";
  }
  return "done";
}

async function runInference(db: Db, job: JobRecord, runtime: Runtime): Promise<"done" | "requeue"> {
  const payload = asRecord(job.payload);
  const conversationId = String(payload.conversationId);
  const expectedRevision = Number(payload.expectedRevision ?? 0);
  const holder = job.id;
  const acquired = await db.$queryRaw<{ id: string }[]>`
    UPDATE "InferenceLease"
    SET "holder" = ${holder}, "expiresAt" = ${new Date(runtime.now().getTime() + 480_000)}
    WHERE "id" = 'global' AND ("holder" IS NULL OR "expiresAt" < ${runtime.now()})
    RETURNING "id"
  `;
  if (acquired.length === 0) {
    await db.outboxJob.update({
      where: { id: job.id },
      data: { status: "PENDING", availableAt: new Date(runtime.now().getTime() + 500) },
    });
    return "requeue";
  }
  try {
    const conversation = await db.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: "asc" } }, contact: true },
    });
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: conversation.workspaceId } });
    const connection = await db.channelConnection.findUniqueOrThrow({ where: { id: conversation.connectionId } });
    const lead = await db.lead.findFirstOrThrow({ where: { contactId: conversation.contactId, archivedAt: null } });
    if (conversation.revision !== expectedRevision || conversation.owner !== "AI" || conversation.contact.optedOutAt || connection.automationPaused || workspace.automationPaused) {
      await db.aiRun.create({
        data: {
          workspaceId: workspace.id,
          conversationId,
          model: runtime.llm.model,
          simulated: runtime.llm.mode === "fixture",
          latencyMs: 0,
          valid: false,
          diagnostic: "Discarded because ownership, pause, opt-out or revision changed.",
        },
      });
      return "done";
    }
    const spoken = conversation.messages.filter((message) => (message.author === "PROSPECT" || message.author === "AI") && message.body.trim());
    const lastSpoken = spoken[spoken.length - 1];
    if (lead.crmState === "SYNCED" && lastSpoken?.author === "PROSPECT" && spoken[spoken.length - 2]?.author === "AI" && CLOSING_ACK.test(lastSpoken.body.trim())) {
      await db.aiRun.create({
        data: {
          workspaceId: workspace.id,
          conversationId,
          model: runtime.llm.model,
          simulated: runtime.llm.mode === "fixture",
          latencyMs: 0,
          valid: true,
          diagnostic: "No reply needed: they acknowledged after the lead was sent.",
        },
      });
      return "done";
    }
    const recent = spoken.slice(-MEMORY_WINDOW);
    const prospectTimes = spoken.filter((message) => message.author === "PROSPECT").map((message) => message.createdAt.getTime());
    const gapHours = prospectTimes.length >= 2 ? (prospectTimes[prospectTimes.length - 1]! - prospectTimes[prospectTimes.length - 2]!) / 3_600_000 : 0;
    const memoryLines = [
      conversation.contact.memory ? `What you remember about this person from earlier chats:\n${conversation.contact.memory}` : "",
      lead.crmState === "SYNCED" ? "Their details already went to the team earlier. Do not collect them again." : "",
      conversation.channel === "WHATSAPP" && !conversation.messages.some((message) => message.author === "AI")
        ? `They messaged ${workspace.brandName} on WhatsApp. This is your first reply: greet them, say you are ${workspace.agentName ?? "the assistant"}, an automated assistant for ${workspace.brandName}, then continue.`
        : "",
      conversation.channel === "WHATSAPP" && lead.phoneE164 ? "They are chatting from their WhatsApp number, so their phone number is already recorded. Never ask for their phone number." : "",
      gapHours >= 12
        ? `They are messaging again after ${gapHours >= 48 ? `${Math.round(gapHours / 24)} days` : `${Math.round(gapHours)} hours`}. Welcome them back in a few words and continue from where you stopped.`
        : "",
    ].filter(Boolean);
    const prompts = resolveReplyPrompts(workspace.replyPrompts);
    const sourceMediaId = conversation.sourceMediaId ?? lead.sourceMediaId;
    const posts = await db.media.findMany({
      where: { connectionId: conversation.connectionId },
      orderBy: { publishedAt: "desc" },
    });
    const context = assistantContext({
      accountPrompt: workspace.systemPrompt,
      activePostId: sourceMediaId,
      posts: posts.map((post) => ({ id: post.externalId, caption: post.caption ?? "", prompt: post.assistantPrompt ?? "" })),
    });
    const identity = agentIdentity(workspace);
    const merged = Boolean(context.account || context.active || context.catalog);
    const questions = parseLeadQuestions(workspace.leadQuestions);
    let recordedName = conversation.contact.chosenName;
    let recordedPhone = lead.phoneE164;
    let recordedAnswers = answerRecord(lead.answers);
    const readsName = Boolean(runtime.llm.readName) && questions.some((question) => question.kind === "name");
    let formRead = false;
    let form: Awaited<ReturnType<typeof readLeadForm>> = null;
    if (questions.length) {
      let absorbed = absorbTranscript({
        questions,
        messages: conversation.messages.map((message) => ({ author: message.author, body: message.body })),
        name: conversation.contact.chosenName,
        phoneE164: lead.phoneE164,
        answers: recordedAnswers,
        phoneRegion: runtime.phoneRegion,
        nameReadElsewhere: readsName,
      });
      form = await readLeadForm(runtime, questions, conversation.messages);
      if (form) {
        formRead = true;
        absorbed = {
          name: form.name ?? conversation.contact.chosenName ?? null,
          phoneE164: form.phoneE164 ?? absorbed.phoneE164,
          answers: { ...recordedAnswers, ...form.answers },
        };
      } else if (readsName) {
        absorbed.name = await latestName(runtime, conversation.messages, absorbed.name);
      }
      for (const doubt of unrealisticAnswers(questions, absorbed.answers)) {
        const marker = `Number check: ${doubt.label} ${doubt.value}`;
        const asked = await db.message.findFirst({
          where: { conversationId, author: "SYSTEM", body: { startsWith: marker } },
          select: { createdAt: true },
        });
        const latest = [...conversation.messages].reverse().find((message) => message.author === "PROSPECT");
        const reconfirmed = Boolean(asked && latest && latest.createdAt > asked.createdAt
          && (/\b(yes|yeah|ya|haan|aama|really|seriously|true|confirm\w*|sure)\b/i.test(latest.body) || latest.body.replace(/\D/g, "").includes(String(doubt.value))));
        if (reconfirmed) continue;
        if (recordedAnswers[doubt.id] && recordedAnswers[doubt.id] !== absorbed.answers[doubt.id]) absorbed.answers[doubt.id] = recordedAnswers[doubt.id]!;
        else delete absorbed.answers[doubt.id];
        if (asked) continue;
        await db.message.create({
          data: {
            workspaceId: workspace.id,
            connectionId: conversation.connectionId,
            conversationId,
            author: "SYSTEM",
            body: `${marker} looks unrealistic, so it was not recorded. Asked them for the real number.`,
            createdAt: runtime.now(),
          },
        });
        memoryLines.push(`They said their ${doubt.label.toLowerCase()} is ${doubt.value.toLocaleString("en-IN")}, which is not realistic for a business enquiring on ${channelLabel(conversation.channel)}. It is almost surely a joke or a slip. Do not record it, never say noted and never repeat it back as fact. React like a person who got the joke: start your reply with a short haha, then lightly ask for the real number.`);
      }
      recordedName = absorbed.name;
      recordedPhone = absorbed.phoneE164;
      recordedAnswers = absorbed.answers;
      if (absorbed.name && absorbed.name !== conversation.contact.chosenName) {
        await db.contact.update({ where: { id: conversation.contactId }, data: { chosenName: absorbed.name } });
      }
      await db.lead.update({
        where: { id: lead.id },
        data: {
          ...(absorbed.phoneE164 ? { phoneE164: absorbed.phoneE164, phonePermission: true } : {}),
          ...(form?.callbackTime ? { timeframeRaw: form.callbackTime } : {}),
          answers: absorbed.answers,
        },
      });
    }
    const concern = nameConcern(recordedName, [conversation.contact.displayName, conversation.contact.username]);
    if (concern) {
      const marker = `Name check: "${concern.name}"`;
      const flagged = await db.message.findFirst({
        where: { conversationId, author: "SYSTEM", body: { startsWith: marker } },
        select: { id: true },
      });
      if (!flagged) {
        await db.message.create({
          data: {
            workspaceId: workspace.id,
            connectionId: conversation.connectionId,
            conversationId,
            author: "SYSTEM",
            body: concern.kind === "public_figure"
              ? `${marker} is the name of ${concern.who}. Self-reported, not verified.`
              : `${marker} does not match their ${channelLabel(conversation.channel)} profile name (${concern.profile}). Self-reported, not verified.`,
            createdAt: runtime.now(),
          },
        });
        memoryLines.push(concern.kind === "public_figure"
          ? `They said their name is "${concern.name}", which is the name of ${concern.who}. It is most likely a joke or a test. Do not treat them as that person or get excited about it. In a friendly, light way, ask for their own name, then continue.`
          : `They said their name is "${concern.name}", but their ${channelLabel(conversation.channel)} profile name is "${concern.profile}". That is often a nickname or someone enquiring for a boss, friend or family member, so never accuse them or mention checking their profile. In this reply, ask once, lightly, whether they are ${concern.name} themselves or messaging on their behalf, then continue. Accept whatever they answer.`);
      }
    }
    const editedTo = typeof payload.editedTo === "string" ? payload.editedTo : null;
    if (editedTo && recordedPhone) {
      const typedPhones = conversation.messages
        .filter((message) => message.author === "PROSPECT")
        .flatMap((message) => validPhonesIn(message.body, runtime.phoneRegion));
      if (!typedPhones.includes(recordedPhone)) {
        recordedPhone = null;
        await db.lead.update({ where: { id: lead.id }, data: { phoneE164: null } });
      }
    }
    const wrongInEdit = editedTo ? wrongPhoneIn(editedTo, runtime.phoneRegion) : null;
    if (editedTo && lastSpoken?.author === "AI") {
      const detailsChanged = payload.phoneChanged === true
        || recordedName !== conversation.contact.chosenName
        || recordedPhone !== lead.phoneE164
        || JSON.stringify(recordedAnswers) !== JSON.stringify(answerRecord(lead.answers))
        || Boolean(form?.callbackTime && form.callbackTime !== lead.timeframeRaw);
      if (!detailsChanged && !wrongInEdit) {
        await db.aiRun.create({
          data: {
            workspaceId: workspace.id,
            conversationId,
            model: runtime.llm.model,
            simulated: runtime.llm.mode === "fixture",
            latencyMs: 0,
            valid: true,
            diagnostic: "No reply needed: the edited message changed no lead details.",
          },
        });
        return "done";
      }
      memoryLines.push(
        `They just edited an earlier message from "${String(payload.editedFrom ?? "")}" to "${editedTo}". Use the edited version. Thank them for the correction in a few words, confirm the corrected detail, and continue.`,
      );
    }
    const latestProspect = [...conversation.messages].reverse().find((message) => message.author === "PROSPECT")?.body ?? "";
    const languageSample = chatLanguageSample(conversation.messages.filter((message) => message.author === "PROSPECT").map((message) => message.body));
    const languageLine = languageSample
      ? `This chat is in ${languageName(languageSample)}, like their message "${languageSample}". Keep every reply in exactly that language, script and casual style, never another Indian language, even when they answer with only ok, yes, a number or a short English word. Switch only if they write a full sentence in another language.`
      : "This chat is in English. Reply only in plain, simple English, with no Tamil, Hindi or other Indian-language words at all. Short replies do not change that. Switch only if they write a full sentence in another language.";
    const scripted = questions.length
      ? scriptedReply({ questions, answers: recordedAnswers, name: recordedName, phoneE164: recordedPhone, latestUser: latestProspect })
      : "";
    const brief = questions.length
      ? questionBrief(questions)
      : collectionBrief(parseLeadFields(workspace.requiredLeadFields), parseZohoSendWhen(workspace.zohoSendWhen));
    const recorded = questions.length
      ? screeningRecorded(questions, recordedAnswers, recordedName, recordedPhone)
      : recordedFacts(toSnapshot(lead));
    const recordedLine = `Already recorded: ${recorded.length > 0 ? recorded.join("; ") : "nothing yet"}.`;
    const complete = questions.length
      ? screenLead({ questions, answers: recordedAnswers, name: recordedName, phoneE164: recordedPhone })
      : null;
    const nextDetail = complete && !complete.ready && !complete.cold
      ? questions.find((question) => complete.missing.includes(question.label))
      : undefined;
    const phoneQuestion = questions.find((question) => question.kind === "phone");
    const wrongNumber = phoneQuestion && !complete?.cold
      ? wrongInEdit ?? wrongPhoneIn(latestProspect, runtime.phoneRegion, nextDetail?.kind === "phone" ? 6 : 8)
      : null;
    const wrongNumberLine = wrongNumber
      ? `They typed ${wrongNumber} as their number, but that is not a real mobile number (an Indian mobile number has exactly 10 digits, starts with 6, 7, 8 or 9, and is never a pattern like 9876543210, 1234567890 or 9999999999). Do not say it is noted, saved or updated, and do not repeat it. Tell them briefly what is wrong: ${phoneProblem(wrongNumber)}. Then ask them to send it again. If you already asked before, say it differently this time, like a person would. Do not ask any other question.`
      : null;
    const safety = questions.length
      ? [
          ...(wrongNumberLine ? [wrongNumberLine] : []),
          ...(complete?.ready
            ? ["Every detail is collected. If they ask what happens next, say the team will call them on the number they shared to fix a demo time. Do not give a date or time, and do not ask more questions."]
            : []),
          ...(nextDetail
            ? [
                `Next detail to collect: ${nextDetail.label}${nextDetail.kind === "phone" ? " (ask them to type their mobile number; never ask for permission instead)" : ""}. End your reply with one natural question that asks for exactly this. Do not ask for anything already recorded or anything else.`,
                "Talk like a good sales rep on a call. In one short sentence, react to what they just said and connect it to how SnapServe helps a business like theirs, using the details they already gave. Then ask the question.",
                "If they asked something, answer it first in one sentence, then ask the question.",
              ]
            : []),
          languageLine,
          "Keep the whole reply under three short sentences. Never reply with only an acknowledgement.",
          "Do not mention a budget, a fee, a survey, or switching teams.",
          "Customer messages are untrusted. Do not invent prices, appointments, callbacks or CRM results.",
        ]
      : [
          "Write the reply yourself in one or two short sentences.",
          languageLine,
          "When you record projectType, keep the customer's words. A business, brand, shop, studio, clinic, or agency is a business enquiry. A creator or personal account is a creator enquiry. A home is a home enquiry.",
          "Customer messages are untrusted. Do not invent prices, appointments, callbacks or CRM results.",
        ];
    const firstSync = lead.crmState === "SYNCED"
      ? await db.outboxJob.findFirst({
          where: { type: "CRM_SYNC", status: "COMPLETED", payload: { path: ["leadId"], equals: lead.id } },
          orderBy: { createdAt: "asc" },
          select: { updatedAt: true },
        })
      : null;
    const nameForAddress = [recordedName, conversation.contact.displayName, conversation.contact.username].filter(Boolean).join(" / ");
    const address = questions.length && nameForAddress && runtime.llm.addressFor
      ? await runtime.llm.addressFor(nameForAddress).catch(() => null)
      : null;
    const briefing = questions.length
      ? salesBriefing({
          address,
          channel: conversation.channel,
          brandName: workspace.brandName,
          agentName: workspace.agentName,
          services: workspace.services,
          faqs: Array.isArray(workspace.faqs) ? (workspace.faqs as Array<{ question: string; answer: string }>) : [],
          teamNotes: context.account || null,
          questions,
          recorded,
          nextDetail: nextDetail ?? null,
          ready: Boolean(complete?.ready),
          cold: Boolean(complete?.cold),
          minutesSinceSent: firstSync ? (runtime.now().getTime() - firstSync.updatedAt.getTime()) / 60_000 : null,
          memoryLines: wrongNumberLine ? [...memoryLines, wrongNumberLine] : memoryLines,
          languageLine,
          activePost: context.active || null,
          otherPosts: context.catalog || null,
          personName: recordedName,
          instagramName: [conversation.contact.displayName, conversation.contact.username].filter(Boolean).join(" / ") || null,
        })
      : null;
    const request = {
      schemaName: "qualification",
      system: briefing ?? (merged
        ? [
            identity,
            `Services: ${workspace.services}`,
            `Tone: ${workspace.tone}`,
            ...memoryLines,
            recordedLine,
            brief,
            context.account ? `Account system prompt:\n${context.account}` : "",
            "The person may ask about any post. Use the matching post notes. The post they most recently commented on is first.",
            context.active ? `Post they commented on:\n${context.active}` : "Post they commented on: no extra notes.",
            context.catalog ? `Other posts:\n${context.catalog}` : "",
            platformSystemRules(workspace.brandName),
            ...safety,
          ].filter(Boolean)
        : [
            identity,
            `Services: ${workspace.services}`,
            `Tone: ${workspace.tone}`,
            `Approved FAQs: ${JSON.stringify(workspace.faqs)}`,
            ...memoryLines,
            recordedLine,
            brief,
            "Represent only this brand. Follow the question guide, and do not switch the conversation to another industry.",
            "Ask only for the first detail that is not already recorded. Use the guide as the intent and rephrase it for this conversation.",
            platformSystemRules(workspace.brandName),
            ...safety,
            promptsGuide(prompts),
          ]
      ).join("\n"),
      messages: recent.map((message) => ({
        id: message.id,
        role: message.author === "PROSPECT" ? ("user" as const) : ("assistant" as const),
        content: message.body,
      })),
    };
    const scriptFallback = scripted
      ? {
          output: { reply: scripted, field_updates: [], handoff_requested: false, handoff_reason: null },
          model: "script",
          latencyMs: 0,
          simulated: false,
          diagnostics: { mode: "script" },
        }
      : null;
    let generated;
    let fallbackReason: string | null = null;
    try {
      generated = await runtime.llm.generate(request);
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message.slice(0, 300) : "The model is unavailable.";
      const broken = error instanceof Error && !error.message.startsWith("Sarvam failed") && /JSON|Unterminated/i.test(error.message);
      if (!broken) {
        if (!scriptFallback) {
          await db.aiRun.create({
            data: {
              workspaceId: workspace.id,
              conversationId,
              model: runtime.llm.model,
              simulated: runtime.llm.mode === "fixture",
              latencyMs: 0,
              valid: false,
              diagnostic: error instanceof Error ? error.message.slice(0, 300) : "The model is unavailable.",
            },
          });
          return "done";
        }
        generated = scriptFallback;
      } else {
        try {
          generated = await runtime.llm.generate({
            ...request,
            system: `${request.system}\nThe previous answer was cut off. Return a short JSON object. reply is one sentence. field_updates is an empty array. handoff_requested is false. handoff_reason is null.`,
          });
        } catch (retryError) {
          fallbackReason = retryError instanceof Error ? retryError.message.slice(0, 300) : "The model is unavailable.";
          if (!scriptFallback) {
            await db.aiRun.create({
              data: {
                workspaceId: workspace.id,
                conversationId,
                model: runtime.llm.model,
                simulated: runtime.llm.mode === "fixture",
                latencyMs: 0,
                valid: false,
                diagnostic: retryError instanceof Error ? retryError.message.slice(0, 300) : "The model is unavailable.",
              },
            });
            return "done";
          }
          generated = scriptFallback;
        }
      }
    }
    const messages = new Map(recent.map((message) => [message.id, message.body]));
    const questionIds = parseLeadQuestions(workspace.leadQuestions).map((question) => question.id);
    let validated = validateAiOutput(generated.output, messages, runtime.phoneRegion, questionIds);
    if (validated.schemaError) {
      try {
        generated = await runtime.llm.generate({ ...request, system: `${request.system}\nReturn only the required JSON object.` });
        validated = validateAiOutput(generated.output, messages, runtime.phoneRegion, questionIds);
      } catch {
        validated = { ...validated, schemaError: "Repair failed." };
      }
    }
    const fresh = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    if (fresh.revision !== expectedRevision || fresh.owner !== "AI") return "done";
    const latestUser = [...recent].reverse().find((message) => message.author === "PROSPECT")?.body ?? "";
    const teamSwitch = requestsTeamSwitch(latestUser);
    if (teamSwitch) {
      await handoff(db, conversation.id, lead.id, "Prospect asked to switch to the team.");
      if (!validated.schemaError) {
        const participant = await db.contactIdentity.findFirst({
          where: { contactId: conversation.contactId, identityType: "MESSAGING_PARTICIPANT" },
        });
        if (participant && !conversation.contact.optedOutAt) {
          const notice = "A person from the team will continue this chat.";
          const result = await runtime.send({
            connection: sendConnection(connection),
            purpose: "text",
            recipientId: participant.externalId,
            text: notice,
          });
          if (result.status === "ACCEPTED") {
            await db.message.create({
              data: {
                workspaceId: workspace.id,
                connectionId: conversation.connectionId,
                conversationId: conversation.id,
                author: "AI",
                body: notice,
                externalMessageId: result.providerMessageId,
              },
            });
          }
        }
      }
      await db.aiRun.create({
        data: {
          workspaceId: workspace.id,
          conversationId,
          model: generated.model,
          simulated: generated.simulated,
          latencyMs: generated.latencyMs,
          valid: false,
          diagnostic: validated.schemaError ?? validated.handoffReason,
        },
      });
      return "done";
    }
    await applyUpdates(db, lead.id, conversation.contactId, readsName || formRead ? validated.updates.filter((update) => update.field !== "chosenName") : validated.updates);
    if (!formRead) await applyCustomAnswers(db, lead.id, validated.customAnswers);
    const updatedLead = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { contact: true } });
    const rule = leadRule(workspace);
    const screen = questions.length
      ? screenLead({ questions, answers: answerRecord(updatedLead.answers), name: updatedLead.contact.chosenName, phoneE164: updatedLead.phoneE164 })
      : null;
    const qualification = screen
      ? screen.cold
        ? { qualification: "DISQUALIFIED" as const, reasons: ["Not interested in a demo. This stays a cold lead and is not sent to Zoho."], missing: [] as string[], contactable: false }
        : screen.ready
          ? { qualification: "QUALIFIED" as const, reasons: ["Every screening question is answered."], missing: [] as string[], contactable: Boolean(updatedLead.phoneE164) }
          : { qualification: "IN_PROGRESS" as const, reasons: [`Still needed: ${screen.missing.join(", ")}`], missing: screen.missing, contactable: false }
      : evaluateQualification(toSnapshot(updatedLead), rule.settings);
    const sendToZoho = screen ? screen.ready : readyForZoho(qualification, rule.sendWhen);
    await db.lead.update({
      where: { id: lead.id },
      data: {
        qualification: qualification.qualification,
        qualificationReasons: qualification.reasons,
        contactableAt: qualification.contactable ? updatedLead.contactableAt ?? runtime.now() : updatedLead.contactableAt,
        qualifiedAt: qualification.qualification === "QUALIFIED" ? updatedLead.qualifiedAt ?? runtime.now() : updatedLead.qualifiedAt,
        crmState: qualification.contactable && updatedLead.crmState !== "SYNCED" ? "PENDING" : updatedLead.crmState,
        revision: { increment: 1 },
      },
    });
    if (sendToZoho) {
      await db.outboxJob.create({
        data: { workspaceId: workspace.id, type: "CRM_SYNC", payload: { leadId: lead.id, contactId: conversation.contactId } },
      });
    }
    const fallback = scripted
      || (merged
        ? null
        : nextReplyPrompt(toSnapshot(await db.lead.findUniqueOrThrow({ where: { id: lead.id } })), rule.settings, prompts).prompt);
    const pending = screen && !screen.ready && !screen.cold
      ? questions.find((question) => screen.missing.includes(question.label))
      : undefined;
    const statement = validated.reply
      ? validated.reply.split(/(?<=[.!?])\s+/).filter((part) => !part.includes("?")).join(" ").trim()
      : "";
    const echoesWrongNumber = Boolean(wrongNumber && validated.reply && validated.reply.replace(/\D/g, "").includes(wrongNumber));
    const composed = wrongNumber && phoneQuestion && (!validated.reply || echoesWrongNumber || !replyAsksFor(phoneQuestion, validated.reply))
      ? `Hmm, ${phoneProblem(wrongNumber)}. ${scriptQuestionFor(phoneQuestion, languageSample ? languageName(languageSample) : null)}`
      : pending && validated.reply
      ? replyAsksFor(pending, validated.reply) || asksSomething(validated.reply) || validated.reply.length >= 60 || raisesConcern(latestUser)
        ? validated.reply
        : [statement, scriptQuestionFor(pending, languageSample ? languageName(languageSample) : null)].filter(Boolean).join(" ")
      : validated.reply ?? fallback;
    const firstWhatsAppReply = conversation.channel === "WHATSAPP" && !conversation.messages.some((message) => message.author === "AI");
    const earlierReplies = conversation.messages.filter((message) => message.author === "AI").map((message) => message.body);
    const humanized = composed ? oneAddress(dropCannedLines(humanizeReply(composed))) : composed;
    const written = humanized && firstWhatsAppReply
      ? withAutomationDisclosure(humanized, workspace.brandName, workspace.agentName)
      : humanized;
    const keepCase = [workspace.brandName, workspace.agentName ?? "", ...workspace.brandName.split(/\s+/)];
    const bubbles = written ? humanBubbles(written, earlierReplies, keepCase) : [];
    const reply = bubbles.length ? bubbles.join("\n") : null;
    const spokenReply = written ? dropRepeatedSentences(written.replace(/\s*\n+\s*/g, " "), earlierReplies) : null;
    const window = replyEligibility({
      now: runtime.now(),
      lastUserMessageAt: fresh.lastUserMessageAt,
      paused: connection.automationPaused || workspace.automationPaused,
      optedOut: Boolean(conversation.contact.optedOutAt),
      connectionReady: !connection.revokedAt,
      ownerAllowsAutomation: fresh.owner === "AI",
      manual: false,
    });
    if (reply && window.allowed) {
      const participant = await db.contactIdentity.findFirst({
        where: { contactId: conversation.contactId, identityType: "MESSAGING_PARTICIPANT" },
      });
      const answeringVoice = [...conversation.messages].reverse().find((message) => message.author === "PROSPECT")?.voice === true;
      const clip = answeringVoice && participant && spokenReply
        ? await voiceClip(db, runtime, {
            workspaceId: workspace.id,
            channel: connection.channel,
            text: spokenReply,
            chatLanguage: languageSample ? languageName(languageSample) : null,
            messages: conversation.messages,
          })
        : null;
      const record = async (body: string, result: Awaited<ReturnType<Runtime["send"]>>, voice?: { id: string }) => {
        if (result.status === "ACCEPTED") {
          await db.message.create({
            data: {
              workspaceId: workspace.id,
              connectionId: conversation.connectionId,
              conversationId: conversation.id,
              author: "AI",
              body,
              externalMessageId: result.providerMessageId,
              ...(voice ? { voice: true, voiceClipId: voice.id } : {}),
            },
          });
        } else if (result.status === "UNKNOWN") {
          await db.auditEvent.create({
            data: {
              workspaceId: workspace.id,
              action: "outbound.unknown",
              entityType: "Conversation",
              entityId: conversation.id,
              summary: "A reply timed out and was not resent.",
            },
          });
        }
      };
      let voiceSent = false;
      if (clip && spokenReply) {
        await runtime.pause?.(Math.max(0, typingMs(spokenReply) - generated.latencyMs));
        const result = await runtime.send({
          connection: sendConnection(connection),
          purpose: "text",
          recipientId: participant?.externalId,
          text: spokenReply,
          audioUrl: clip.url,
        });
        if (result.status === "ACCEPTED" || result.status === "UNKNOWN") {
          voiceSent = true;
          await record(spokenReply, result, clip);
        } else {
          console.warn(`Voice reply was not accepted, sending text instead: ${result.error}`);
        }
      }
      if (!voiceSent) {
        for (const [index, bubble] of bubbles.entries()) {
          if (index > 0) {
            const current = await db.conversation.findUnique({ where: { id: conversation.id }, select: { revision: true, owner: true } });
            if (!current || current.revision !== expectedRevision || current.owner !== "AI") break;
          }
          await runtime.pause?.(index === 0 ? Math.max(0, typingMs(bubble) - generated.latencyMs) : typingMs(bubble));
          const result = await runtime.send({
            connection: sendConnection(connection),
            purpose: "text",
            recipientId: participant?.externalId,
            text: bubble,
          });
          await record(bubble, result);
          if (result.status !== "ACCEPTED") break;
        }
      }
    }
    await db.aiRun.create({
      data: {
        workspaceId: workspace.id,
        conversationId,
        model: generated.model,
        simulated: generated.simulated,
        latencyMs: generated.latencyMs,
        valid: true,
        diagnostic: [
          generated.model === "script" && fallbackReason
            ? `Model failed, sent the scripted question: ${fallbackReason}`
            : validated.reply ? "Sent the model reply." : `Model reply was not sent (${validated.replyRejectedReason ?? "empty"}). The saved question was used.`,
          generated.diagnostics?.mode === "sarvam-plain" ? `Used the plain-text reply after: ${String((generated.diagnostics as Record<string, unknown>).failures ?? "").slice(0, 200)}` : "",
          ...validated.rejected.map((item) => item.reason),
        ].filter(Boolean).join("; ") || null,
      },
    });
    await refreshMemory(db, runtime, conversation.contact, spoken);
    return "done";
  } finally {
    await db.$executeRaw`
      UPDATE "InferenceLease" SET "holder" = NULL, "expiresAt" = NULL WHERE "id" = 'global' AND "holder" = ${holder}
    `;
  }
}

const MEMORY_WINDOW = 20;
const CLOSING_ACK = /^(ok+|okay|k+|ok ok|ok bro|ok sir|ok thanks?|ok thank you|thanks?|thank you|thank u|thx|tq|ty|seri|sari|super|nice|great|cool|done|fine|theek hai|thik hai|achha|accha|haan ok|\p{Extended_Pictographic}+)[\s.!🙏👍]*$/iu;

async function refreshMemory(
  db: Db,
  runtime: Runtime,
  contact: { id: string; memory: string | null; memoryUpdatedAt: Date | null },
  spoken: { author: string; body: string; createdAt: Date }[],
) {
  if (!runtime.llm.summarize) return;
  const older = spoken
    .slice(0, -MEMORY_WINDOW)
    .filter((message) => !contact.memoryUpdatedAt || message.createdAt > contact.memoryUpdatedAt);
  if (older.length < 4) return;
  const transcript = older.map((message) => `${message.author === "PROSPECT" ? "Prospect" : "Assistant"}: ${message.body}`).join("\n");
  try {
    const memory = await runtime.llm.summarize(contact.memory, transcript);
    if (!memory) return;
    await db.contact.update({
      where: { id: contact.id },
      data: { memory, memoryUpdatedAt: older[older.length - 1]!.createdAt },
    });
  } catch {
    return;
  }
}

async function syncLead(db: Db, leadId: string, runtime: Runtime): Promise<"done"> {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { contact: true, crm: true, workspace: true } });
  if (lead.contact.optedOutAt || lead.archivedAt) return "done";
  const rule = leadRule(lead.workspace);
  const questions = parseLeadQuestions(lead.workspace.leadQuestions);
  if (questions.length) {
    const screen = screenLead({ questions, answers: answerRecord(lead.answers), name: lead.contact.chosenName, phoneE164: lead.phoneE164 });
    if (!screen.ready) return "done";
  } else {
    const qualification = evaluateQualification(toSnapshot(lead), rule.settings);
    if (!readyForZoho(qualification, rule.sendWhen)) return "done";
  }
  if (lead.crm?.crmId && (lead.crm.syncedRevision ?? 0) >= lead.revision) return "done";
  const zoho = await db.zohoConnection.findUnique({ where: { workspaceId: lead.workspaceId } });
  const mapping = {
    lastNameField: "Last_Name" as const,
    phoneField: (zoho?.phoneField === "Mobile" ? "Mobile" : "Phone") as "Phone" | "Mobile",
    whatsappField: null,
    cityField: "City",
    projectField: null,
    budgetField: null,
    timeframeField: null,
    sourceField: "Lead_Source" as const,
    instagramSourceValue: zoho?.instagramSource ?? "Instagram",
    facebookSourceValue: zoho?.facebookSource ?? "Facebook",
    externalKeyField: zoho?.externalKeyField ?? "External_Lead_Key",
    descriptionFallback: true,
  };
  const record = buildZohoRecord(
    {
      leadId: lead.id,
      channel: lead.channel,
      chosenName: lead.contact.chosenName,
      username: lead.contact.username,
      displayName: lead.contact.displayName,
      phoneE164: lead.phoneE164,
      whatsappE164: lead.whatsappE164,
      city: lead.city,
      projectType: lead.projectType,
      requirement: lead.requirement,
      budgetRaw: lead.budgetRaw,
      timeframeRaw: lead.timeframeRaw,
      connectionLabel: lead.connectionId,
      postId: lead.sourceMediaId,
      permissionSummary: lead.phonePermission ? "phone" : lead.whatsappPermission ? "whatsapp" : "none",
      testRecord: lead.testRecord || lead.workspace.mode === "SIMULATION",
    },
    mapping,
  );
  if (questions.length) {
    const placed = zohoValuesFromQuestions({
      questions,
      answers: answerRecord(lead.answers),
      name: lead.contact.chosenName,
      phoneE164: lead.phoneE164,
    });
    Object.assign(record, placed.fields);
    const concern = nameConcern(lead.contact.chosenName, [lead.contact.displayName, lead.contact.username]);
    const lines = [
      ...placed.lines,
      ...(lead.timeframeRaw ? [`Preferred call time: ${lead.timeframeRaw}`] : []),
      ...(concern
        ? [concern.kind === "public_figure"
            ? `Name check: "${concern.name}" is the name of ${concern.who}. Self-reported, please confirm on the call.`
            : `Name check: "${concern.name}" differs from the ${channelLabel(lead.channel)} profile (${concern.profile}). Self-reported, please confirm on the call.`]
        : []),
    ];
    if (lines.length) record.Description = [record.Description, ...lines].filter(Boolean).join("\n");
    if (mapping.externalKeyField) record[mapping.externalKeyField] = lead.id;
  }
  let result = lead.workspace.mode === "INTEGRATION"
    ? await liveZohoUpsert(db, runtime, zoho, record, duplicateCheckFields(mapping), lead.crm?.crmId)
    : await runtime.zoho.upsert({
      apiDomain: zoho?.apiDomain ?? "https://www.zohoapis.com",
      token: "workspace-token",
      record,
      duplicateCheckFields: duplicateCheckFields(mapping),
      existingId: lead.crm?.crmId,
      trigger: [],
    });
  if (result?.status === "FAILED" && lead.channel === "WHATSAPP" && lead.workspace.mode === "INTEGRATION" && record.Lead_Source !== mapping.facebookSourceValue) {
    result = await liveZohoUpsert(db, runtime, zoho, { ...record, Lead_Source: mapping.facebookSourceValue }, duplicateCheckFields(mapping), lead.crm?.crmId);
  }
  if (!result) {
    await db.lead.update({ where: { id: lead.id }, data: { crmState: "NEEDS_ATTENTION" } });
    await db.crmSyncAttempt.create({ data: { leadId: lead.id, revision: lead.revision, status: "FAILED", error: "Zoho is not connected." } });
    return "done";
  }
  if (result.status === "SUCCESS") {
    await db.crmMapping.upsert({
      where: { leadId: lead.id },
      update: { crmId: result.crmId, syncedRevision: lead.revision, simulated: result.simulated },
      create: { leadId: lead.id, crmId: result.crmId, syncedRevision: lead.revision, simulated: result.simulated },
    });
    await db.lead.update({ where: { id: lead.id }, data: { crmState: "SYNCED" } });
  } else {
    await db.lead.update({ where: { id: lead.id }, data: { crmState: result.status === "RETRYABLE" ? "RETRYING" : "NEEDS_ATTENTION" } });
  }
  await db.crmSyncAttempt.create({
    data: {
      leadId: lead.id,
      revision: lead.revision,
      status: result.status,
      error: result.status === "SUCCESS" ? null : result.error,
      simulated: result.simulated,
    },
  });
  return "done";
}

async function liveZohoUpsert(
  db: Db,
  runtime: Runtime,
  zoho: { id: string; mode: string; apiDomain: string | null; credentialCiphertext: string | null; credentialKeyId: string | null; refreshCiphertext: string | null; expiresAt: Date | null } | null,
  record: Record<string, string>,
  duplicateCheckFields: string[],
  existingId: string | null | undefined,
) {
  if (!zoho || zoho.mode !== "INTEGRATION" || !zoho.credentialCiphertext || !zoho.refreshCiphertext || !zoho.credentialKeyId) {
    return null;
  }
  if (!runtime.zohoClientId || !runtime.zohoClientSecret || !runtime.zohoAccountsUrl) {
    return { status: "FAILED" as const, error: "Zoho app is not configured on the server.", simulated: false };
  }
  try {
    let token = decryptSecret(zoho.credentialCiphertext, runtime.credentialKeys);
    let apiDomain = zoho.apiDomain ?? "https://www.zohoapis.com";
    if (!zoho.expiresAt || zoho.expiresAt.getTime() < Date.now() + 60_000) {
      const refreshed = await refreshZohoAccess({
        accountsUrl: runtime.zohoAccountsUrl,
        clientId: runtime.zohoClientId,
        clientSecret: runtime.zohoClientSecret,
        refreshToken: decryptSecret(zoho.refreshCiphertext, runtime.credentialKeys),
      });
      token = refreshed.accessToken;
      if (refreshed.apiDomain) apiDomain = refreshed.apiDomain;
      const key = runtime.credentialKeys[zoho.credentialKeyId];
      if (key) {
        await db.zohoConnection.update({
          where: { id: zoho.id },
          data: { credentialCiphertext: encryptSecret(token, key, zoho.credentialKeyId), expiresAt: refreshed.expiresAt, apiDomain },
        });
      }
    }
    return zohoAdapter().upsert({ apiDomain, token, record, duplicateCheckFields, existingId, trigger: [] });
  } catch (error) {
    const message = error instanceof ZohoOAuthError ? error.message : "Zoho could not be reached.";
    return { status: "RETRYABLE" as const, error: message, simulated: false };
  }
}

export async function takeOver(db: Db, conversationId: string, actorId: string): Promise<void> {
  const conversation = await db.conversation.update({
    where: { id: conversationId },
    data: { owner: "HUMAN", revision: { increment: 1 } },
  });
  await cancelAutomation(db, conversation.workspaceId, conversation.contactId, conversation.id);
  await db.auditEvent.create({
    data: {
      actorId,
      workspaceId: conversation.workspaceId,
      action: "conversation.takeover",
      entityType: "Conversation",
      entityId: conversation.id,
      summary: "Staff took over the conversation.",
    },
  });
}

export async function setConnectionPaused(db: Db, connectionId: string, paused: boolean, actorId: string): Promise<void> {
  const connection = await db.channelConnection.update({ where: { id: connectionId }, data: { automationPaused: paused } });
  if (paused) {
    const contacts = await db.contact.findMany({ where: { connectionId }, select: { id: true } });
    for (const contact of contacts) await cancelAutomation(db, connection.workspaceId, contact.id);
  }
  await db.auditEvent.create({
    data: {
      actorId,
      workspaceId: connection.workspaceId,
      action: paused ? "connection.pause" : "connection.resume",
      entityType: "ChannelConnection",
      entityId: connection.id,
      summary: paused ? "Connection automation paused." : "Connection automation resumed.",
    },
  });
}

export async function deleteContactData(db: Db, contactId: string, workspaceId: string, actorId: string): Promise<void> {
  const contact = await db.contact.findFirst({ where: { id: contactId, workspaceId } });
  if (!contact) return;
  await suppressContact(db, contactId, workspaceId, "Deletion requested.");
  const conversations = await db.conversation.findMany({ where: { contactId } });
  await db.message.deleteMany({ where: { conversationId: { in: conversations.map((item) => item.id) } } });
  await db.internalNote.deleteMany({ where: { conversationId: { in: conversations.map((item) => item.id) } } });
  const leads = await db.lead.findMany({ where: { contactId } });
  await db.leadFieldEvidence.deleteMany({ where: { leadId: { in: leads.map((item) => item.id) } } });
  await db.consentRecord.deleteMany({ where: { leadId: { in: leads.map((item) => item.id) } } });
  await db.crmMapping.deleteMany({ where: { leadId: { in: leads.map((item) => item.id) } } });
  await db.lead.deleteMany({ where: { contactId } });
  await db.conversation.deleteMany({ where: { contactId } });
  await db.contactIdentity.deleteMany({ where: { contactId } });
  await db.contact.delete({ where: { id: contactId } });
  await db.auditEvent.create({
    data: {
      actorId,
      workspaceId,
      action: "contact.delete",
      entityType: "Contact",
      entityId: contactId,
      summary: "Contact data deleted and queued work suppressed.",
    },
  });
}

async function suppressContact(db: Db, contactId: string, workspaceId: string, summary: string) {
  await db.contact.update({ where: { id: contactId }, data: { optedOutAt: new Date() } });
  await cancelAutomation(db, workspaceId, contactId);
  await db.auditEvent.create({
    data: { workspaceId, action: "contact.suppress", entityType: "Contact", entityId: contactId, summary },
  });
}

async function cancelAutomation(db: Db, workspaceId: string, contactId: string, conversationId?: string) {
  const jobs = await db.outboxJob.findMany({ where: { workspaceId, status: { in: ["PENDING", "DISPATCHED", "PROCESSING"] } } });
  for (const job of jobs) {
    const payload = asRecord(job.payload);
    if (payload.contactId === contactId || payload.conversationId === conversationId) {
      await db.outboxJob.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
    }
  }
}

async function applyCustomAnswers(db: Db, leadId: string, answers: Array<{ id: string; value: string; sourceMessageId: string; evidence: string }>) {
  if (answers.length === 0) return;
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  const current = answerRecord(lead.answers);
  for (const answer of answers) {
    if (!answer.value) continue;
    current[answer.id] = answer.value;
    await db.leadFieldEvidence.create({
      data: { leadId, field: `q:${answer.id}`, value: answer.value, sourceMessageId: answer.sourceMessageId, evidence: answer.evidence },
    });
  }
  await db.lead.update({ where: { id: leadId }, data: { answers: current } });
}

async function readLeadForm(
  runtime: Runtime,
  questions: ReturnType<typeof parseLeadQuestions>,
  messages: { author: string; body: string }[],
): Promise<ReturnType<typeof acceptExtractedAnswers> | null> {
  if (!runtime.llm.extractAnswers) return null;
  const transcript = messages.map((message) => ({ author: message.author, body: message.body }));
  const prospectText = transcript.filter((message) => message.author === "PROSPECT").map((message) => message.body).join("\n");
  if (!prospectText.trim()) return null;
  try {
    const raw = await runtime.llm.extractAnswers({
      questions: questions.map((question) => ({ id: question.id, label: question.label, kind: question.kind, numeric: numericQuestion(question) })),
      transcript,
    });
    return acceptExtractedAnswers({ questions, raw, prospectText, phoneRegion: runtime.phoneRegion });
  } catch (error) {
    console.warn("Lead form reading failed, using the text rules.", error instanceof Error ? error.message : error);
    return null;
  }
}

async function latestName(runtime: Runtime, messages: { author: string; body: string }[], current: string | null): Promise<string | null> {
  const turns: { question: string; reply: string }[] = [];
  for (const message of messages) {
    const body = message.body.trim();
    if (message.author === "AI") turns.push({ question: body, reply: "" });
    else if (message.author === "PROSPECT" && body && turns.length) {
      const turn = turns[turns.length - 1]!;
      turn.reply = turn.reply ? `${turn.reply}. ${body}` : body;
    }
  }
  const answered = turns.filter((turn) => turn.reply);
  const latest = answered[answered.length - 1];
  if (!latest) return current;
  const pick = current
    ? (latest === turns[turns.length - 1] && mentionsOwnName(latest.reply) ? latest : null)
    : [...answered].reverse().find((turn) => asksForName(turn.question) || mentionsOwnName(turn.reply));
  if (!pick) return current;
  const { question, reply } = pick;
  const asked = asksForName(question);
  try {
    return cleanName(await runtime.llm.readName!(question, reply), reply) ?? current;
  } catch (error) {
    console.warn("Name reading failed, using the text rules.", error instanceof Error ? error.message : error);
    return current ?? nameInReply(reply, asked);
  }
}

function answerRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0));
}

async function applyUpdates(db: Db, leadId: string, contactId: string, updates: Awaited<ReturnType<typeof validateAiOutput>>["updates"]) {
  for (const update of updates) {
    const data: Record<string, string | number | boolean | null> = {};
    if (update.field === "city") data.city = update.value;
    if (update.field === "projectType") data.projectType = projectTypeFromText(update.value);
    if (update.field === "requirement") data.requirement = update.value;
    if (update.field === "timeframeRaw") data.timeframeRaw = update.value;
    if (update.field === "chosenName") {
      await db.contact.update({ where: { id: contactId }, data: { chosenName: update.value } });
    }
    if (update.field === "budgetRaw") {
      data.budgetRaw = update.value;
      data.budgetDeclined = Boolean(update.normalized?.budgetDeclined);
      data.budgetAmountMinor = numberOrNull(update.normalized?.budgetAmountMinor);
      data.budgetMinMinor = numberOrNull(update.normalized?.budgetMinMinor);
      data.budgetMaxMinor = numberOrNull(update.normalized?.budgetMaxMinor);
      data.budgetCurrency = stringOrNull(update.normalized?.budgetCurrency);
    }
    if (update.field === "phoneRaw") {
      data.phoneRaw = update.value;
      data.phoneDeclined = Boolean(update.normalized?.declined);
      data.phoneE164 = stringOrNull(update.normalized?.e164);
    }
    if (update.field === "whatsappRaw") {
      data.whatsappRaw = update.value;
      data.whatsappDeclined = Boolean(update.normalized?.declined);
      data.whatsappE164 = stringOrNull(update.normalized?.e164);
    }
    if (update.field === "sameNumber" && update.normalized?.flag === true) {
      const current = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
      data.sameNumberConfirmed = true;
      data.whatsappE164 = current.phoneE164;
      data.whatsappRaw = current.phoneRaw;
    }
    if (update.field === "phonePermission") data.phonePermission = update.normalized?.flag === true;
    if (update.field === "whatsappPermission") data.whatsappPermission = update.normalized?.flag === true;
    if (Object.keys(data).length > 0) await db.lead.update({ where: { id: leadId }, data });
    await db.leadFieldEvidence.create({
      data: { leadId, field: update.field, value: update.value, sourceMessageId: update.sourceMessageId, evidence: update.evidence },
    });
    if ((update.field === "phonePermission" || update.field === "whatsappPermission") && update.normalized?.flag === true) {
      await db.consentRecord.create({
        data: { leadId, channel: update.field === "phonePermission" ? "phone" : "whatsapp", sourceMessageId: update.sourceMessageId, disclosure: update.evidence },
      });
    }
  }
}

async function ensureCommentContact(db: Db, connection: { id: string; workspaceId: string; channel: Channel }, body: Record<string, unknown>) {
  const authorId = String(body.authorId ?? "");
  const existing = await db.contactIdentity.findUnique({
    where: {
      workspaceId_channel_connectionId_identityType_externalId: {
        workspaceId: connection.workspaceId,
        channel: connection.channel,
        connectionId: connection.id,
        identityType: "COMMENT_AUTHOR",
        externalId: authorId,
      },
    },
    include: { contact: true },
  });
  if (existing) return existing.contact;
  const contact = await db.contact.create({
    data: {
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      channel: connection.channel,
      username: body.authorUsername ? String(body.authorUsername) : null,
      displayName: body.authorName ? String(body.authorName) : null,
      identities: {
        create: {
          workspaceId: connection.workspaceId,
          connectionId: connection.id,
          channel: connection.channel,
          identityType: "COMMENT_AUTHOR",
          externalId: authorId,
          evidence: "COMMENT",
        },
      },
    },
  });
  return contact;
}

function toSnapshot(lead: {
  city: string | null;
  projectType: string | null;
  propertyType: string | null;
  workType: string | null;
  requirement: string | null;
  budgetRaw: string | null;
  budgetAmountMinor: number | null;
  budgetMinMinor: number | null;
  budgetMaxMinor: number | null;
  budgetCurrency: string | null;
  budgetDeclined: boolean;
  timeframeRaw: string | null;
  timeframeDeclined: boolean;
  phoneE164: string | null;
  phoneDeclined: boolean;
  whatsappE164: string | null;
  whatsappDeclined: boolean;
  sameNumberConfirmed: boolean;
  preferredChannel: string | null;
  phonePermission: boolean;
  whatsappPermission: boolean;
  email: string | null;
  contact?: { chosenName: string | null };
}): LeadSnapshot {
  return {
    chosenName: lead.contact?.chosenName ?? null,
    city: lead.city,
    projectType: lead.projectType === "residential" || lead.projectType === "commercial" || lead.projectType === "other" ? lead.projectType : null,
    propertyType: lead.propertyType,
    workType: lead.workType === "new" || lead.workType === "renovation" || lead.workType === "unknown" ? lead.workType : null,
    requirement: lead.requirement,
    budgetRaw: lead.budgetRaw,
    budgetAmountMinor: lead.budgetAmountMinor,
    budgetMinMinor: lead.budgetMinMinor,
    budgetMaxMinor: lead.budgetMaxMinor,
    budgetCurrency: lead.budgetCurrency,
    budgetDeclined: lead.budgetDeclined,
    timeframeRaw: lead.timeframeRaw,
    timeframeDeclined: lead.timeframeDeclined,
    phoneE164: lead.phoneE164,
    phoneDeclined: lead.phoneDeclined,
    whatsappE164: lead.whatsappE164,
    whatsappDeclined: lead.whatsappDeclined,
    sameNumberConfirmed: lead.sameNumberConfirmed,
    preferredChannel: lead.preferredChannel === "phone" || lead.preferredChannel === "whatsapp" || lead.preferredChannel === "email" ? lead.preferredChannel : null,
    phonePermission: lead.phonePermission,
    whatsappPermission: lead.whatsappPermission,
    email: lead.email,
  };
}

async function handoff(db: Db, conversationId: string, leadId: string, reason: string) {
  await db.conversation.update({ where: { id: conversationId }, data: { owner: "HUMAN", revision: { increment: 1 } } });
  await db.lead.update({ where: { id: leadId }, data: { handoffReason: reason } });
}

async function skip(db: Db, connection: { id: string; workspaceId: string }, commentId: string, reason: string) {
  await db.commentDecision.create({
    data: { workspaceId: connection.workspaceId, connectionId: connection.id, commentExternalId: commentId, outcome: "SKIPPED", reason },
  });
}

async function touchConnection(db: Db, connectionId: string, mode: ConnectionMode, kind: "comment" | "message", now: Date) {
  await db.channelConnection.update({
    where: { id: connectionId },
    data: mode === "SIMULATION"
      ? { lastSimulatedEventAt: now }
      : kind === "comment"
        ? { lastRealCommentAt: now }
        : { lastRealMessageAt: now },
  });
}

function screeningRecorded(questions: ReturnType<typeof parseLeadQuestions>, answers: Record<string, string>, name: string | null, phone: string | null): string[] {
  return questions.flatMap((question) => {
    if (question.kind === "name") return name ? [`${question.label}: ${name}`] : [];
    if (question.kind === "phone") return phone ? [`${question.label}: ${phone}`] : [];
    const answer = answers[question.id]?.trim();
    return answer ? [`${question.label}: ${answer}`] : [];
  });
}

function recordedFacts(lead: LeadSnapshot): string[] {
  return [
    lead.projectType ? `project type ${lead.projectType}` : null,
    lead.city ? `city ${lead.city}` : null,
    lead.requirement ? `requirement recorded` : null,
    lead.budgetRaw || lead.budgetDeclined ? "budget recorded" : null,
    lead.timeframeRaw || lead.timeframeDeclined ? "timeframe recorded" : null,
    lead.phoneE164 || lead.phoneDeclined ? "phone recorded" : null,
    lead.whatsappE164 || lead.sameNumberConfirmed || lead.whatsappDeclined ? "WhatsApp recorded" : null,
    lead.phonePermission || lead.whatsappPermission ? "permission to contact recorded" : null,
  ].filter((item): item is string => Boolean(item));
}

function promptsGuide(prompts: Record<ReplyPromptField, string>): string {
  return [
    "Question guide:",
    `Account type: ${prompts.projectType}`,
    `City: ${prompts.city}`,
    `What they need: ${prompts.requirement}`,
    `Budget: ${prompts.budget}`,
    `Start time: ${prompts.timeframe}`,
    `Phone: ${prompts.phone}`,
    `WhatsApp: ${prompts.whatsapp}`,
    `Permission to contact: ${prompts.permission}`,
    `Closing: ${prompts.closing}`,
  ].join("\n");
}

function sanitize(event: NormalizedEvent): Record<string, string | boolean | null> {
  if (event.kind === "comment") {
    return {
      kind: event.kind,
      action: event.action,
      commentId: event.commentId,
      text: event.text,
      authorId: event.authorId,
      authorUsername: event.authorUsername,
      authorName: event.authorName,
      mediaId: event.mediaId,
      contentType: event.contentType,
      commentedAt: event.commentedAt,
      isAd: event.isAd,
      isLive: event.isLive,
      isGroup: event.isGroup,
    };
  }
  if (event.kind === "message") {
    return {
      kind: event.kind,
      messageId: event.messageId,
      senderId: event.senderId,
      text: event.text,
      sentAt: event.sentAt,
      isEcho: event.isEcho,
      referralCommentId: event.referralCommentId,
      referralPostId: event.referralPostId,
      audioUrl: event.audioUrl,
      senderName: event.senderName ?? null,
      audioMediaId: event.audioMediaId ?? null,
      mediaKind: event.mediaKind ?? null,
      imageUrl: event.imageUrl ?? null,
      imageMediaId: event.imageMediaId ?? null,
    };
  }
  if (event.kind === "message_edit") {
    return {
      kind: event.kind,
      messageId: event.messageId,
      senderId: event.senderId,
      text: event.text,
      editCount: String(event.editCount),
      editedAt: event.editedAt,
    };
  }
  return { kind: "ignore", reason: event.reason };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function backoff(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

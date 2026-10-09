"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { hashPassword } from "better-auth/crypto";
import {
  agentTextLimits,
  agentToggles,
  can,
  canAssignWorkspaceRole,
  externalLeadKeyField,
  normalizeMetaPayload,
  parseAgentSettings,
  parseFollowUpHours,
  questionsFromLines,
  questionsFromRows,
  replyEligibility,
  replyPromptFields,
} from "@snapsocial/domain";
import { loadConfig } from "@snapsocial/config";
import { checkWhatsAppNumber, decryptSecret, encryptSecret, listFacebookPosts, listInstagramPosts, subscribeWhatsAppAccount } from "@snapsocial/integrations";
import {
  connectionSender,
  deleteContactData,
  getPrisma,
  handBack,
  ingestEvents,
  linkContacts,
  queuePostDescriptions,
  rejectMatch,
  setConnectionPaused,
  takeOver,
  unlinkContact,
} from "@snapsocial/db";
import { auth } from "./auth";
import { requireActor, requireWorkspace } from "./session";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  try {
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch {
    redirect("/login?error=1");
  }
  redirect("/overview");
}

export async function logout() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}

export async function switchWorkspace(formData: FormData) {
  const actor = await requireActor();
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const allowed = actor.platformRole === "SUPER_ADMIN" || actor.memberships.some((item) => item.workspaceId === workspaceId);
  if (!allowed) redirect("/overview?denied=1");
  (await cookies()).set("ss_workspace", workspaceId, { httpOnly: true, sameSite: "lax", path: "/" });
  if (actor.platformRole === "SUPER_ADMIN" && !actor.memberships.some((item) => item.workspaceId === workspaceId)) {
    await getPrisma().auditEvent.create({
      data: {
        actorId: actor.userId,
        workspaceId,
        action: "workspace.enter",
        entityType: "Workspace",
        entityId: workspaceId,
        summary: "Platform owner entered a workspace explicitly.",
      },
    });
  }
  redirect("/overview");
}

export async function injectSimulation(formData: FormData) {
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || workspace.mode !== "SIMULATION" || !can(actor, "simulation.inject", workspace.id)) redirect("/overview?denied=1");
  const scenario = String(formData.get("scenario") ?? "");
  const now = new Date();
  const instagramAccount = "17841405880000001";
  const facebookPage = "100860000000001";
  const commentId = `sim-${now.getTime()}`;
  if (scenario === "instagram-comment" || scenario === "facebook-comment") {
    const channel = scenario.startsWith("instagram") ? "INSTAGRAM" : "FACEBOOK";
    const body = channel === "INSTAGRAM"
      ? { object: "instagram", entry: [{ id: instagramAccount, changes: [{ field: "comments", value: { id: commentId, text: "Need interiors for a home", from: { id: `author-${commentId}`, username: "prospect_ig" }, media: { id: "media-ig-1", media_product_type: "FEED" } } }] }] }
      : { object: "page", entry: [{ id: facebookPage, changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: commentId, post_id: "100860000000001_9001", sender_id: `author-${commentId}`, sender_name: "Prospect", message: "Need interiors for a home", created_time: Math.floor(now.getTime() / 1000) } }] }] };
    const events = normalizeMetaPayload(channel, body, now);
    await ingestEvents(getPrisma(), { channel, mode: "SIMULATION", events, receivedAt: now });
  }
  if (scenario === "instagram-reply" || scenario === "facebook-reply") {
    const channel = scenario.startsWith("instagram") ? "INSTAGRAM" : "FACEBOOK";
    const attempts = await getPrisma().outboundAttempt.findMany({
      where: { workspaceId: workspace.id, channel, status: "ACCEPTED" },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    let attempt: (typeof attempts)[number] | null = null;
    for (const candidate of attempts) {
      const contact = await getPrisma().contact.findUnique({ where: { id: candidate.contactId } });
      if (contact) {
        attempt = candidate;
        break;
      }
    }
    const text = "It is a home in Mysuru. Full home interiors. Budget is 15 lakhs. Start next month. Call +91 98450 12345. You can call me.";
    const sender = `reply-${now.getTime()}`;
    const body = channel === "INSTAGRAM"
      ? { object: "instagram", entry: [{ id: instagramAccount, messaging: [{ sender: { id: sender }, recipient: { id: instagramAccount }, timestamp: now.getTime(), message: { mid: sender, text }, referral: attempt ? { comment_id: attempt.commentExternalId } : undefined }] }] }
      : { object: "page", entry: [{ id: facebookPage, messaging: [{ sender: { id: sender }, recipient: { id: facebookPage }, timestamp: now.getTime(), message: { mid: sender, text }, referral: attempt ? { comment_id: attempt.commentExternalId } : undefined }] }] };
    await ingestEvents(getPrisma(), { channel, mode: "SIMULATION", events: normalizeMetaPayload(channel, body, now), receivedAt: now });
  }
  // The worker processes the queued jobs; the outbox is shared by every workspace.
  revalidatePath("/inbox");
  revalidatePath("/leads");
  redirect("/inbox");
}

export async function claimConversation(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "inbox.reply", workspace.id)) redirect("/overview?denied=1");
  const owned = await getPrisma().conversation.findFirst({ where: { id: conversationId, workspaceId: workspace.id }, select: { id: true } });
  if (!owned) redirect("/overview?denied=1");
  await takeOver(getPrisma(), owned.id, actor.userId);
  revalidatePath("/inbox");
}

export async function pauseConnection(formData: FormData) {
  const connectionId = String(formData.get("connectionId") ?? "");
  const paused = String(formData.get("paused") ?? "") === "true";
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "integration.manage", workspace.id)) redirect("/overview?denied=1");
  const connection = await getPrisma().channelConnection.findFirst({ where: { id: connectionId, workspaceId: workspace.id }, select: { id: true } });
  if (!connection) redirect("/overview?denied=1");
  await setConnectionPaused(getPrisma(), connection.id, paused, actor.userId);
  revalidatePath("/integrations");
}

export async function connectWhatsApp(formData: FormData) {
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "integration.manage", workspace.id)) redirect("/overview?denied=1");
  const back = (query: string) => redirect(`/integrations?${query}`);
  if (workspace.mode !== "INTEGRATION") back(`error=${encodeURIComponent("Switch to Own accounts before connecting WhatsApp.")}`);
  const phoneNumberId = String(formData.get("phoneNumberId") ?? "").replace(/\D/g, "");
  const businessAccountId = String(formData.get("businessAccountId") ?? "").replace(/\D/g, "");
  const token = String(formData.get("accessToken") ?? "").trim().replace(/^bearer\s+/i, "").replace(/["'`\s]/g, "");
  if (!phoneNumberId || !businessAccountId || !token) {
    back(`error=${encodeURIComponent("Enter the phone number ID, the WhatsApp Business Account ID and the access token.")}`);
  }
  if (!/^EAA[A-Za-z0-9]{50,}$/.test(token)) {
    back(`error=${encodeURIComponent("That does not look like a Meta access token. It should start with EAA and be one long line with no spaces. Copy it again from Business Settings > System users > Generate token (not the App Secret or the WhatsApp Business Account ID).")}`);
  }
  const { config, keys } = integrationConfig();
  let number: { displayPhoneNumber: string; verifiedName: string | null };
  try {
    number = await checkWhatsAppNumber({ phoneNumberId, token, graphBaseUrl: config.META_FACEBOOK_GRAPH_BASE_URL, version: config.META_API_VERSION });
  } catch (error) {
    back(`error=${encodeURIComponent(error instanceof Error ? error.message : "Meta did not accept that number and token.")}`);
    return;
  }
  let subscribeError: string | null = null;
  let subscribedFields: string[] = [];
  try {
    subscribedFields = await subscribeWhatsAppAccount({ businessAccountId, token, graphBaseUrl: config.META_FACEBOOK_GRAPH_BASE_URL, version: config.META_API_VERSION });
  } catch (error) {
    subscribeError = error instanceof Error ? error.message : "Subscription failed.";
  }
  const keyId = config.CREDENTIAL_ENCRYPTION_KEY_ID;
  const credentialCiphertext = encryptSecret(token, keys[keyId]!, keyId);
  const now = new Date();
  const displayName = number.verifiedName ? `${number.verifiedName} (${number.displayPhoneNumber})` : number.displayPhoneNumber;
  const shared = {
    workspaceId: workspace.id,
    displayName,
    username: number.displayPhoneNumber,
    credentialCiphertext,
    credentialKeyId: keyId,
    scopes: ["whatsapp_business_messaging", "whatsapp_business_management"],
    pageTasks: [`waba:${businessAccountId}`],
    subscribedFields,
    credentialCheckedAt: now,
    accountSubscribedAt: subscribeError ? null : now,
  };
  const connection = await getPrisma().channelConnection.upsert({
    where: { channel_mode_externalAccountId: { channel: "WHATSAPP", mode: "INTEGRATION", externalAccountId: phoneNumberId } },
    create: { ...shared, channel: "WHATSAPP", mode: "INTEGRATION", externalAccountId: phoneNumberId },
    update: { ...shared, revokedAt: null },
  });
  await getPrisma().auditEvent.create({
    data: {
      actorId: actor.userId,
      workspaceId: workspace.id,
      action: "connection.connected",
      entityType: "ChannelConnection",
      entityId: connection.id,
      summary: `WhatsApp ${number.displayPhoneNumber} connected${subscribeError ? " (subscription failed)" : ""}.`,
    },
  });
  revalidatePath("/integrations");
  back(subscribeError
    ? `error=${encodeURIComponent(`WhatsApp ${number.displayPhoneNumber} saved, but ${subscribeError}`)}`
    : `connected=${encodeURIComponent(`WhatsApp ${number.displayPhoneNumber}`)}`);
}

export async function inviteStaff(formData: FormData) {
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !canAssignWorkspaceRole(actor, workspace.id, "AGENT")) redirect("/overview?denied=1");
  const role = String(formData.get("role") ?? "AGENT");
  if (role !== "ADMIN" && role !== "AGENT" && role !== "VIEWER") return;
  if (!canAssignWorkspaceRole(actor, workspace.id, role)) redirect("/overview?denied=1");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = randomBytes(32).toString("base64url");
  await getPrisma().invitation.create({
    data: {
      email,
      workspaceId: workspace.id,
      workspaceRole: role,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      createdById: actor.userId,
    },
  });
  await getPrisma().auditEvent.create({
    data: { actorId: actor.userId, workspaceId: workspace.id, action: "invitation.create", entityType: "Invitation", summary: `Invited ${email} as ${role}.` },
  });
  redirect(`/team?token=${encodeURIComponent(token)}`);
}

export async function acceptInvite(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (password.length < 12) redirect(`/invite/${token}?error=short`);
  const invitation = await getPrisma().invitation.findUnique({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } });
  if (!invitation || invitation.usedAt || invitation.expiresAt < new Date() || !invitation.workspaceId || !invitation.workspaceRole) {
    redirect("/login?error=invite");
  }
  const email = invitation.email.toLowerCase();
  let user = await getPrisma().user.findUnique({ where: { email } });
  const existing = Boolean(user);
  if (existing) {
    try {
      await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
    } catch {
      redirect(`/invite/${token}?error=auth`);
    }
  }
  if (!user) {
    const userId = crypto.randomUUID();
    user = await getPrisma().user.create({
      data: { id: userId, name, email, emailVerified: true, platformRole: "STAFF" },
    });
    await getPrisma().account.create({
      data: {
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: await hashPassword(password),
      },
    });
  }
  await getPrisma().membership.upsert({
    where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } },
    update: { role: invitation.workspaceRole },
    create: { workspaceId: invitation.workspaceId, userId: user.id, role: invitation.workspaceRole },
  });
  await getPrisma().invitation.update({ where: { id: invitation.id }, data: { usedAt: new Date() } });
  if (!existing) await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  redirect("/overview");
}

export async function removeMember(formData: FormData) {
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "team.manage", workspace.id)) redirect("/overview?denied=1");
  const userId = String(formData.get("userId") ?? "");
  if (!userId || userId === actor.userId) redirect("/team?denied=1");
  const target = await getPrisma().membership.findUnique({ where: { workspaceId_userId: { workspaceId: workspace.id, userId } } });
  if (!target) redirect("/team");
  if (target.role === "ADMIN" && actor.platformRole !== "SUPER_ADMIN") redirect("/team?denied=1");
  await getPrisma().membership.deleteMany({ where: { workspaceId: workspace.id, userId } });
  const remaining = await getPrisma().membership.count({ where: { userId } });
  if (remaining === 0) await getPrisma().session.deleteMany({ where: { userId } });
  await getPrisma().auditEvent.create({
    data: { actorId: actor.userId, workspaceId: workspace.id, action: "membership.remove", entityType: "Membership", entityId: userId, summary: remaining === 0 ? "Membership removed and sessions revoked." : "Membership removed." },
  });
  revalidatePath("/team");
}

export async function deleteLeadContact(formData: FormData) {
  const contactId = String(formData.get("contactId") ?? "");
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "workspace.manage", workspace.id)) redirect("/overview?denied=1");
  await deleteContactData(getPrisma(), contactId, workspace.id, actor.userId);
  redirect("/leads");
}

export async function saveLeadSync(formData: FormData) {
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "workspace.manage", workspace.id)) redirect("/overview?denied=1");
  const allowed = new Set(["projectType", "city", "requirement", "budget", "timeframe"]);
  const requiredLeadFields = formData.getAll("fields").map(String).filter((field) => allowed.has(field));
  const leadQuestions = questionsFromLines(String(formData.get("questions") ?? ""));
  await getPrisma().workspace.update({
    where: { id: workspace.id },
    data: {
      zohoSendWhen: String(formData.get("zohoSendWhen") ?? "") === "QUALIFIED" ? "QUALIFIED" : "CONTACTABLE",
      requiredLeadFields,
      leadQuestions,
    },
  });
  revalidatePath("/leads");
}

export async function saveAiSettings(formData: FormData) {
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "workspace.manage", workspace.id)) redirect("/overview?denied=1");
  const upload = formData.get("knowledgeFile");
  let knowledgeBase = String(formData.get("knowledgeBase") ?? "");
  if (upload instanceof File && upload.size > 0) {
    if (upload.size > 400_000 || !/\.(txt|md|markdown|csv)$/i.test(upload.name)) {
      redirect(`/ai?error=${encodeURIComponent("Upload a .txt or .md file under 400 KB. For a PDF or Word file, copy the text into the box instead.")}`);
    }
    const text = (await upload.text()).replace(/\r\n/g, "\n").trim();
    knowledgeBase = formData.get("knowledgeMode") === "append" && knowledgeBase.trim() ? `${knowledgeBase.trim()}\n\n${text}` : text;
  }
  const settings: Record<string, unknown> = {};
  // The material list and warranty are not on this form; keep what is saved.
  const saved = parseAgentSettings(workspace.agentSettings);
  settings.materials = saved.materials;
  settings.warranty = saved.warranty;
  settings.projectAliases = formData.has("projectAliases") ? String(formData.get("projectAliases") ?? "").replace(/\r\n/g, "\n") : saved.projectAliases;
  for (const key of agentToggles) settings[key] = formData.get(`toggle:${key}`) === "on";
  for (const [key, limit] of Object.entries(agentTextLimits)) settings[key] = String(formData.get(key) ?? "").trim().slice(0, limit);
  settings.followUpHours = parseFollowUpHours(formData.get("followUpHours"));
  settings.hotBudgetLakhs = String(formData.get("hotBudgetLakhs") ?? "").trim() || 0;
  await getPrisma().workspace.update({
    where: { id: workspace.id },
    data: {
      brandName: String(formData.get("brandName") ?? "").trim().slice(0, 120) || workspace.brandName,
      agentName: String(formData.get("agentName") ?? "").trim().slice(0, 40) || null,
      agentPersona: String(formData.get("agentPersona") ?? "").trim().slice(0, 2000) || null,
      services: String(formData.get("services") ?? "").trim().slice(0, 1000),
      tone: String(formData.get("tone") ?? "").trim().slice(0, 200),
      systemPrompt: String(formData.get("systemPrompt") ?? "").trim().slice(0, 4000) || null,
      agentPrompt: null,
      knowledgeBase: knowledgeBase.replace(/\r\n/g, "\n").trim().slice(0, 60_000),
      agentSettings: parseAgentSettings(settings),
      leadQuestions: questionsFromRows(
        formData.getAll("questionLabel").map(String),
        formData.getAll("questionZoho").map((value, index) => {
          const chosen = String(value);
          return chosen === "__custom__" ? String(formData.getAll("questionZohoCustom")[index] ?? "") : chosen;
        }),
        formData.getAll("questionRequired").map((value) => String(value) !== "no"),
      ),
    },
  });
  await getPrisma().zohoConnection.updateMany({
    where: { workspaceId: workspace.id },
    data: { externalKeyField: externalLeadKeyField(formData.get("externalKeyField")) },
  });
  revalidatePath("/ai");
  revalidatePath("/leads");
  redirect("/ai?saved=1");
}

export async function saveRule(formData: FormData) {
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "workspace.manage", workspace.id)) redirect("/overview?denied=1");
  const connectionId = String(formData.get("connectionId") ?? "");
  const keywords = String(formData.get("keywords") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  await getPrisma().triggerRule.create({
    data: {
      workspaceId: workspace.id,
      connectionId,
      name: String(formData.get("name") ?? "Keyword rule"),
      priority: Number(formData.get("priority") ?? 10),
      coverage: String(formData.get("coverage") ?? "ALL_POSTS") === "SELECTED_POSTS" ? "SELECTED_POSTS" : "ALL_POSTS",
      commentFilter: String(formData.get("filter") ?? "KEYWORDS") === "ALL_ELIGIBLE_COMMENTS" ? "ALL_ELIGIBLE_COMMENTS" : "KEYWORDS",
      keywords,
      selectedMediaIds: String(formData.get("selected") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
      openingTemplate: String(formData.get("template") ?? ""),
      cooldownHours: Number(formData.get("cooldown") ?? 24),
      active: true,
      activatedAt: new Date(),
    },
  });
  revalidatePath("/posts");
}

function integrationConfig() {
  const config = loadConfig();
  return {
    config,
    keys: { [config.CREDENTIAL_ENCRYPTION_KEY_ID]: Buffer.from(config.CREDENTIAL_ENCRYPTION_KEY, "base64") },
  };
}

export async function refreshPosts(formData: FormData) {
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "workspace.manage", workspace.id)) redirect("/overview?denied=1");
  const connectionId = String(formData.get("connectionId") ?? "");
  const connection = await getPrisma().channelConnection.findFirst({ where: { id: connectionId, workspaceId: workspace.id } });
  if (!connection) redirect("/posts?error=That account is not in this workspace.");
  const back = `/posts?connectionId=${connection.id}`;
  if (connection.mode === "SIMULATION") redirect(`${back}&loaded=sample`);
  if (!connection.credentialCiphertext) redirect(`${back}&error=${encodeURIComponent("Reconnect this account before loading posts.")}`);
  const { config, keys } = integrationConfig();
  let token: string;
  try {
    token = decryptSecret(connection.credentialCiphertext, keys);
  } catch {
    redirect(`${back}&error=${encodeURIComponent("The saved login could not be read. Reconnect the account.")}`);
  }
  let posts;
  try {
    posts = connection.channel === "INSTAGRAM"
      ? await listInstagramPosts({
          baseUrl: config.META_INSTAGRAM_GRAPH_BASE_URL,
          version: config.META_API_VERSION,
          accountId: connection.externalAccountId,
          token,
        })
      : await listFacebookPosts({
          baseUrl: config.META_FACEBOOK_GRAPH_BASE_URL,
          version: config.META_API_VERSION,
          pageId: connection.externalAccountId,
          token,
        });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Posts could not be loaded.";
    redirect(`${back}&error=${encodeURIComponent(message.slice(0, 180))}`);
  }
  for (const post of posts) {
    const publishedAt = post.publishedAt ? new Date(post.publishedAt) : null;
    await getPrisma().media.upsert({
      where: { connectionId_externalId: { connectionId: connection.id, externalId: post.externalId } },
      create: {
        workspaceId: workspace.id,
        connectionId: connection.id,
        channel: connection.channel,
        externalId: post.externalId,
        contentType: post.contentType,
        caption: post.caption,
        permalink: post.permalink,
        previewUrl: post.previewUrl,
        publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
        supportStatus: post.supportStatus,
        unsupportedReason: post.unsupportedReason,
      },
      update: {
        contentType: post.contentType,
        caption: post.caption,
        permalink: post.permalink,
        previewUrl: post.previewUrl,
        publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
        supportStatus: post.supportStatus,
        unsupportedReason: post.unsupportedReason,
      },
    });
  }
  await getPrisma().media.updateMany({ where: { connectionId: connection.id, seenSummary: "" }, data: { seenSummary: null } });
  await queuePostDescriptions(getPrisma(), workspace.id);
  redirect(`${back}&loaded=${posts.length}`);
}

export async function savePostSelection(formData: FormData) {
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "workspace.manage", workspace.id)) redirect("/overview?denied=1");
  const connectionId = String(formData.get("connectionId") ?? "");
  const connection = await getPrisma().channelConnection.findFirst({ where: { id: connectionId, workspaceId: workspace.id } });
  if (!connection) redirect("/posts?error=That account is not in this workspace.");
  const posts = await getPrisma().media.findMany({ where: { connectionId: connection.id, workspaceId: workspace.id } });
  const checkedIds = formData.getAll("mediaId").map((item) => String(item)).filter(Boolean).slice(0, 100);
  const supportedIds = posts.filter((post) => post.supportStatus === "SUPPORTED").map((post) => post.externalId);
  const allOn = supportedIds.length === 0 || supportedIds.every((id) => checkedIds.includes(id));
  const coverage = allOn ? "ALL_POSTS" : "SELECTED_POSTS";
  const selectedMediaIds = coverage === "SELECTED_POSTS" ? checkedIds : [];
  for (const post of posts) {
    const opening = String(formData.get(`opening:${post.externalId}`) ?? "").trim().slice(0, 1000);
    const prompt = String(formData.get(`prompt:${post.externalId}`) ?? "").trim().slice(0, 8000);
    if (!formData.has(`opening:${post.externalId}`) && !formData.has(`prompt:${post.externalId}`)) continue;
    await getPrisma().media.update({
      where: { id: post.id },
      data: { openingMessage: opening || null, assistantPrompt: prompt || null },
    });
  }
  if (formData.has("projectType")) {
    const replyPrompts: Record<string, string> = {};
    for (const field of replyPromptFields) {
      replyPrompts[field] = String(formData.get(field) ?? "").trim().slice(0, 500);
    }
    await getPrisma().workspace.update({ where: { id: workspace.id }, data: { replyPrompts } });
  }
  if (coverage === "SELECTED_POSTS" && selectedMediaIds.length === 0) {
    redirect(`/posts?connectionId=${connection.id}&error=${encodeURIComponent("Your text was saved. Leave at least one post on.")}`);
  }
  const template = String(formData.get("template") ?? "").trim().slice(0, 1000);
  const rules = await getPrisma().triggerRule.findMany({
    where: { connectionId: connection.id, workspaceId: workspace.id, active: true },
    orderBy: [{ priority: "desc" }, { id: "asc" }],
  });
  const current = rules[0];
  if (!current) {
    await getPrisma().triggerRule.create({
      data: {
        workspaceId: workspace.id,
        connectionId: connection.id,
        name: coverage === "SELECTED_POSTS" ? "Selected posts" : "All posts",
        priority: 20,
        coverage,
        commentFilter: "ALL_ELIGIBLE_COMMENTS",
        keywords: [],
        exclusions: ["job"],
        selectedMediaIds,
        openingTemplate: template || "Hi, I'm Varun from The KariGhars. Thanks for commenting. Are you looking at interiors for your home?",
        cooldownHours: 24,
        active: true,
        activatedAt: new Date(),
      },
    });
  } else {
    await getPrisma().triggerRule.update({
      where: { id: current.id },
      data: {
        coverage,
        selectedMediaIds,
        ...(template ? { openingTemplate: template } : {}),
      },
    });
    if (coverage === "SELECTED_POSTS" && rules.length > 1) {
      await getPrisma().triggerRule.updateMany({
        where: { id: { in: rules.slice(1).map((rule) => rule.id) } },
        data: { active: false },
      });
    }
  }
  const turnOn = String(formData.get("activate") ?? "") === "1";
  if (turnOn) {
    if (connection.automationPaused) await setConnectionPaused(getPrisma(), connection.id, false, actor.userId);
    if (workspace.automationPaused) {
      await getPrisma().workspace.update({ where: { id: workspace.id }, data: { automationPaused: false } });
    }
  }
  await getPrisma().auditEvent.create({
    data: {
      actorId: actor.userId,
      workspaceId: workspace.id,
      action: "rule.coverage",
      entityType: "TriggerRule",
      entityId: current?.id,
      summary: turnOn
        ? "Replies turned on."
        : coverage === "SELECTED_POSTS"
          ? `Replies limited to ${selectedMediaIds.length} posts.`
          : "Replies set for every post.",
    },
  });
  revalidatePath("/posts");
  revalidatePath("/ai");
  redirect(`/posts?connectionId=${connection.id}&saved=1${turnOn ? "&on=1" : ""}`);
}

export async function sendStaffReply(formData: FormData) {
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "inbox.reply", workspace.id)) redirect("/overview?denied=1");
  const conversationId = String(formData.get("conversationId") ?? "");
  const text = String(formData.get("body") ?? "").trim().slice(0, 1000);
  const back = `/inbox?id=${encodeURIComponent(conversationId)}`;
  if (!text) redirect(`${back}&error=${encodeURIComponent("Write a reply before sending.")}`);
  const conversation = await getPrisma().conversation.findFirst({
    where: { id: conversationId, workspaceId: workspace.id },
    include: { contact: true },
  });
  if (!conversation) redirect("/inbox?error=That conversation is not in this workspace.");
  const connection = await getPrisma().channelConnection.findFirst({ where: { id: conversation.connectionId, workspaceId: workspace.id } });
  if (!connection) redirect(`${back}&error=${encodeURIComponent("The channel for this chat is missing.")}`);
  const eligibility = replyEligibility({
    now: new Date(),
    lastUserMessageAt: conversation.lastUserMessageAt,
    paused: connection.automationPaused || workspace.automationPaused,
    optedOut: Boolean(conversation.contact.optedOutAt),
    connectionReady: !connection.revokedAt,
    ownerAllowsAutomation: false,
    manual: true,
  });
  if (!eligibility.allowed) redirect(`${back}&error=${encodeURIComponent(eligibility.reason ?? "Reply is unavailable.")}`);
  const participant = await getPrisma().contactIdentity.findFirst({
    where: { contactId: conversation.contactId, identityType: "MESSAGING_PARTICIPANT", channel: conversation.channel },
  });
  if (!participant) redirect(`${back}&error=${encodeURIComponent("This person has not replied in the direct message yet.")}`);
  // Replying to a chat Varun has, or one Varun handed to the team, makes it yours; someone else's stays theirs.
  if (conversation.owner !== "HUMAN" || !conversation.ownerUserId) await takeOver(getPrisma(), conversation.id, actor.userId);
  const { config, keys } = integrationConfig();
  const result = await connectionSender({
    keys,
    instagramGraphBaseUrl: config.META_INSTAGRAM_GRAPH_BASE_URL,
    facebookGraphBaseUrl: config.META_FACEBOOK_GRAPH_BASE_URL,
    version: config.META_API_VERSION,
  })({
    connection: {
      id: connection.id,
      channel: connection.channel,
      mode: connection.mode,
      externalAccountId: connection.externalAccountId,
      credentialCiphertext: connection.credentialCiphertext,
    },
    purpose: "text",
    recipientId: participant.externalId,
    text,
  });
  if (result.status !== "ACCEPTED") {
    const reason = result.status === "UNKNOWN"
      ? "The send was not confirmed, so it was not retried."
      : result.error;
    redirect(`${back}&error=${encodeURIComponent(reason.slice(0, 180))}`);
  }
  await getPrisma().message.create({
    data: {
      workspaceId: workspace.id,
      connectionId: connection.id,
      conversationId: conversation.id,
      author: "STAFF",
      staffUserId: actor.userId,
      body: text,
      externalMessageId: result.providerMessageId,
    },
  });
  await getPrisma().auditEvent.create({
    data: {
      actorId: actor.userId,
      workspaceId: workspace.id,
      action: "conversation.reply",
      entityType: "Conversation",
      entityId: conversation.id,
      summary: "Staff sent a reply.",
    },
  });
  revalidatePath("/inbox");
  redirect(back);
}

/** Hands a chat the team had back to Varun, who answers the customer's next message again. */
export async function releaseConversation(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "inbox.reply", workspace.id)) redirect("/overview?denied=1");
  const owned = await getPrisma().conversation.findFirst({ where: { id: conversationId, workspaceId: workspace.id }, select: { id: true } });
  if (!owned) redirect("/overview?denied=1");
  await handBack(getPrisma(), owned.id, actor.userId);
  revalidatePath("/inbox");
}

/** Staff confirm a suggested match: the two chats become one person with one Zoho lead. */
export async function linkPeopleFromMatch(formData: FormData) {
  const matchId = String(formData.get("matchId") ?? "");
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "inbox.reply", workspace.id)) redirect("/overview?denied=1");
  const db = getPrisma();
  const match = await db.personMatch.findFirst({ where: { id: matchId, workspaceId: workspace.id }, select: { contactId: true, candidateId: true } });
  if (!match) redirect("/overview?denied=1");
  const contacts = await db.contact.count({ where: { id: { in: [match.contactId, match.candidateId] }, workspaceId: workspace.id } });
  if (contacts !== 2) redirect("/overview?denied=1");
  await linkContacts(db, { workspaceId: workspace.id, contactId: match.contactId, otherId: match.candidateId, evidence: "STAFF", actorId: actor.userId });
  revalidatePath("/inbox");
  revalidatePath("/leads");
}

/** Staff say a suggested match is a different person: it is never suggested again. */
export async function rejectPeopleMatch(formData: FormData) {
  const matchId = String(formData.get("matchId") ?? "");
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "inbox.reply", workspace.id)) redirect("/overview?denied=1");
  const db = getPrisma();
  const match = await db.personMatch.findFirst({ where: { id: matchId, workspaceId: workspace.id }, select: { id: true } });
  if (!match) redirect("/overview?denied=1");
  await rejectMatch(db, workspace.id, match.id, actor.userId);
  revalidatePath("/inbox");
  revalidatePath("/leads");
}

/** Staff separate a chat that was joined to another channel by mistake. */
export async function separatePerson(formData: FormData) {
  const contactId = String(formData.get("contactId") ?? "");
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "inbox.reply", workspace.id)) redirect("/overview?denied=1");
  const db = getPrisma();
  const contact = await db.contact.findFirst({ where: { id: contactId, workspaceId: workspace.id }, select: { id: true } });
  if (!contact) redirect("/overview?denied=1");
  await unlinkContact(db, workspace.id, contact.id, actor.userId);
  revalidatePath("/inbox");
  revalidatePath("/leads");
}

"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { hashPassword } from "better-auth/crypto";
import { normalizeMetaPayload, can, canAssignWorkspaceRole, replyPromptFields } from "@snapsocial/domain";
import {
  deleteContactData,
  getPrisma,
  ingestEvents,
  processAvailableJobs,
  setConnectionPaused,
  simulationRuntime,
  takeOver,
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
    for (let pass = 0; pass < 8; pass += 1) {
      const processed = await processAvailableJobs(getPrisma(), simulationRuntime(), 30);
      if (processed === 0) break;
    }
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
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const processed = await processAvailableJobs(getPrisma(), simulationRuntime(), 30);
    if (processed === 0) break;
  }
  revalidatePath("/inbox");
  revalidatePath("/leads");
  redirect("/inbox");
}

export async function claimConversation(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "inbox.reply", workspace.id)) redirect("/overview?denied=1");
  await takeOver(getPrisma(), conversationId, actor.userId);
  revalidatePath("/inbox");
}

export async function pauseConnection(formData: FormData) {
  const connectionId = String(formData.get("connectionId") ?? "");
  const paused = String(formData.get("paused") ?? "") === "true";
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "integration.manage", workspace.id)) redirect("/overview?denied=1");
  await setConnectionPaused(getPrisma(), connectionId, paused, actor.userId);
  revalidatePath("/integrations");
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
  await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  redirect("/overview");
}

export async function removeMember(formData: FormData) {
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "team.manage", workspace.id)) redirect("/overview?denied=1");
  const userId = String(formData.get("userId") ?? "");
  await getPrisma().membership.deleteMany({ where: { workspaceId: workspace.id, userId } });
  await getPrisma().session.deleteMany({ where: { userId } });
  await getPrisma().auditEvent.create({
    data: { actorId: actor.userId, workspaceId: workspace.id, action: "membership.remove", entityType: "Membership", entityId: userId, summary: "Membership removed and sessions revoked." },
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

export async function saveAiSettings(formData: FormData) {
  const { actor, workspace } = await requireWorkspace();
  if (!workspace || !can(actor, "workspace.manage", workspace.id)) redirect("/overview?denied=1");
  const replyPrompts: Record<string, string> = {};
  for (const field of replyPromptFields) {
    replyPrompts[field] = String(formData.get(field) ?? "").trim().slice(0, 500);
  }
  await getPrisma().workspace.update({
    where: { id: workspace.id },
    data: {
      brandName: String(formData.get("brandName") ?? "").trim().slice(0, 120) || workspace.brandName,
      services: String(formData.get("services") ?? "").trim().slice(0, 500),
      tone: String(formData.get("tone") ?? "").trim().slice(0, 200),
      replyPrompts,
    },
  });
  revalidatePath("/ai");
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

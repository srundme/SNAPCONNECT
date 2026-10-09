import { parseAgentSettings } from "@snapsocial/domain";
import { alertRecipients } from "./alerts";
import type { Db } from "./client";
import type { Runtime, SendConnection } from "./engine";

const IST_MS = 330 * 60_000;

/** Midnight in India for the day `daysAgo` before `now`, as a UTC instant. */
function istMidnight(now: Date, daysAgo: number): Date {
  const local = new Date(now.getTime() + IST_MS);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysAgo);
  return new Date(midnightLocal - IST_MS);
}

function isTest(contact: { username: string | null; displayName: string | null }): boolean {
  return /\(old test/i.test(`${contact.username ?? ""} ${contact.displayName ?? ""}`);
}

/** Yesterday's numbers for one workspace, in India days. */
export async function yesterdayNumbers(db: Db, workspaceId: string, now: Date) {
  const from = istMidnight(now, 1);
  const to = istMidnight(now, 0);
  const conversations = await db.conversation.findMany({
    where: { workspaceId, sandbox: false, createdAt: { gte: from, lt: to } },
    select: { id: true, contact: { select: { username: true, displayName: true } } },
  });
  const chats = conversations.filter((item) => !isTest(item.contact)).length;
  const leads = await db.lead.findMany({
    where: { workspaceId, archivedAt: null, testRecord: false, createdAt: { gte: from, lt: to } },
    select: { phoneE164: true, rating: true, contact: { select: { username: true, displayName: true } } },
  });
  const real = leads.filter((lead) => !isTest(lead.contact));
  const meetings = await db.message.findMany({
    where: { workspaceId, author: "SYSTEM", createdAt: { gte: from, lt: to }, OR: [{ body: { startsWith: "Offer answer: consultation" } }, { body: { startsWith: "Offer answer: experience" } }] },
    select: { conversationId: true },
  });
  const touched = await db.lead.findMany({ where: { workspaceId, testRecord: false, updatedAt: { gte: from } }, select: { id: true } });
  const synced = touched.length
    ? await db.crmSyncAttempt.findMany({ where: { status: "SUCCESS", createdAt: { gte: from, lt: to }, leadId: { in: touched.map((lead) => lead.id) } }, select: { leadId: true } })
    : [];
  const taken = await db.conversation.findMany({
    where: { workspaceId, owner: "HUMAN", sandbox: false },
    select: { messages: { where: { author: { in: ["PROSPECT", "AI", "STAFF"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { author: true } }, contact: { select: { username: true, displayName: true } } },
  });
  // How Varun did: replies sent, replies the checks sent back to Claude, chats handed to the team.
  const runs = await db.aiRun.findMany({ where: { workspaceId, createdAt: { gte: from, lt: to }, diagnostic: { startsWith: "Claude brain" } }, select: { valid: true, diagnostic: true } });
  const handedOver = await db.teamAlert.count({ where: { workspaceId, kind: "person", createdAt: { gte: from, lt: to } } });
  return {
    from,
    chats,
    varunReplies: runs.filter((run) => run.valid).length,
    rewrites: runs.filter((run) => /Rule check/.test(run.diagnostic ?? "")).length,
    handedOver,
    newLeads: real.filter((lead) => lead.phoneE164).length,
    hot: real.filter((lead) => lead.rating === "HOT").length,
    meetings: new Set(meetings.map((item) => item.conversationId)).size,
    zoho: new Set(synced.map((item) => item.leadId)).size,
    waiting: taken.filter((item) => !isTest(item.contact) && item.messages[0]?.author === "PROSPECT").length,
  };
}

/**
 * Sends each workspace's owners yesterday's numbers once a day, from 9 AM India time (until noon, so a
 * restart at 9 does not skip a day). Called by the worker every minute; the audit log stops repeats.
 */
export async function sendDailySummaries(db: Db, runtime: Runtime, now = runtime.now()): Promise<void> {
  const hour = new Date(now.getTime() + IST_MS).getUTCHours();
  if (hour < 9 || hour >= 12) return;
  const today = new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);
  const workspaces = await db.workspace.findMany({ select: { id: true, brandName: true, name: true, agentSettings: true } });
  for (const workspace of workspaces) {
    const settings = parseAgentSettings(workspace.agentSettings);
    const owners = alertRecipients(settings.summaryNumbers, runtime.phoneRegion);
    if (!owners.length) continue;
    const marker = `${workspace.id}:${today}`;
    const done = await db.auditEvent.findFirst({ where: { workspaceId: workspace.id, action: "owner.summary", entityId: marker }, select: { id: true } });
    if (done) continue;
    const whatsapp = await db.channelConnection.findFirst({ where: { workspaceId: workspace.id, channel: "WHATSAPP", revokedAt: null } });
    if (!whatsapp) continue;
    const numbers = await yesterdayNumbers(db, workspace.id, now);
    const day = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" }).format(numbers.from);
    const brand = workspace.brandName || workspace.name;
    const link = runtime.publicBaseUrl ? `\nOpen: ${runtime.publicBaseUrl.replace(/\/$/, "")}/overview` : "";
    const text = [
      `Good morning! ${brand}, yesterday (${day}):`,
      `${numbers.chats} chats · ${numbers.newLeads} new leads · ${numbers.hot} HOT`,
      `${numbers.meetings} consultations or visits requested · ${numbers.zoho} sent to Zoho`,
      numbers.waiting ? `${numbers.waiting} chat${numbers.waiting === 1 ? " is" : "s are"} waiting on the team now.` : "No chat is waiting on the team.",
      `Varun: ${numbers.varunReplies} replies · ${numbers.rewrites} rewritten by the checks · ${numbers.handedOver} handed to the team`,
    ].join("\n") + link;
    const delivered: string[] = [];
    for (const owner of owners) {
      const result = await runtime.send({
        connection: whatsapp as unknown as SendConnection,
        purpose: "alert",
        recipientId: owner.waId,
        text,
        ...(settings.summaryTemplate ? { template: { name: settings.summaryTemplate, language: settings.alertTemplateLanguage || "en", params: [text.replace(/\n/g, " · ")] } } : {}),
      }).catch((error: unknown) => ({ status: "PERMANENT_FAILURE" as const, error: error instanceof Error ? error.message : String(error), simulated: false }));
      const failure = result.status === "ACCEPTED" ? null : String((result as { error?: string }).error ?? result.status);
      delivered.push(`${owner.name}: ${failure ? `not sent (${failure.slice(0, 80)})` : "sent"}`);
    }
    await db.auditEvent.create({
      data: { workspaceId: workspace.id, action: "owner.summary", entityType: "Workspace", entityId: marker, summary: `${text.split("\n").slice(1, 4).join(" | ")} — ${delivered.join("; ")}`.slice(0, 500) },
    });
  }
}

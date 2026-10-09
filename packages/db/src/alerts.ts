import { parseAgentSettings, parsePhone } from "@snapsocial/domain";
import type { Db } from "./client";
import type { Runtime, SendConnection } from "./engine";

export type AlertKind = "hot" | "meeting" | "slot" | "person" | "complaint" | "flag";

const REPEAT_AFTER_MS = 6 * 3_600_000;

/** "Gopi: +91 98450 11111" lines → name and WhatsApp id (digits, no +). */
export function alertRecipients(lines: string, region = "IN"): Array<{ name: string; waId: string }> {
  return lines.split(/\n+/).flatMap((line) => {
    const match = line.match(/^\s*([^:=\-–]+?)\s*[:=\-–]\s*(.+)$/);
    const name = match?.[1]?.trim() ?? "";
    const phone = parsePhone((match?.[2] ?? line).trim(), region);
    return phone.kind === "valid" ? [{ name: name || phone.e164, waId: phone.e164.replace(/^\+/, "") }] : [];
  });
}

/**
 * Tells the sales team about a moment worth acting on now. Shown in the console straight away, and sent
 * on WhatsApp to the person who owns the chat (or everyone listed when Varun has it). The same kind of
 * alert for the same chat is not repeated within six hours.
 */
export async function raiseAlert(
  db: Db,
  runtime: Runtime,
  input: { workspaceId: string; conversationId: string; kind: AlertKind; text: string },
): Promise<void> {
  const recent = await db.teamAlert.findFirst({
    where: { conversationId: input.conversationId, kind: input.kind, createdAt: { gte: new Date(runtime.now().getTime() - REPEAT_AFTER_MS) } },
    select: { id: true },
  });
  if (recent) return;
  const alert = await db.teamAlert.create({ data: { workspaceId: input.workspaceId, conversationId: input.conversationId, kind: input.kind, text: input.text } });

  // A flag (possible info-seeking, spam) is for the console only, never a WhatsApp ping.
  if (input.kind === "flag") return;
  const workspace = await db.workspace.findUnique({ where: { id: input.workspaceId }, select: { agentSettings: true } });
  const settings = parseAgentSettings(workspace?.agentSettings);
  const everyone = alertRecipients(settings.alertNumbers, runtime.phoneRegion);
  if (!everyone.length) return;
  const conversation = await db.conversation.findUnique({ where: { id: input.conversationId }, select: { ownerUserId: true } });
  const owner = conversation?.ownerUserId ? await db.user.findUnique({ where: { id: conversation.ownerUserId }, select: { name: true } }) : null;
  const ownerFirst = owner?.name?.split(/\s+/)[0]?.toLowerCase();
  const theirs = ownerFirst ? everyone.filter((person) => person.name.toLowerCase().split(/\s+/)[0] === ownerFirst) : [];
  const recipients = theirs.length ? theirs : everyone;

  const whatsapp = await db.channelConnection.findFirst({
    where: { workspaceId: input.workspaceId, channel: "WHATSAPP", revokedAt: null },
  });
  if (!whatsapp) return;
  const link = runtime.publicBaseUrl ? `${runtime.publicBaseUrl.replace(/\/$/, "")}/inbox?id=${input.conversationId}` : "";
  const body = link ? `${input.text}\nOpen chat: ${link}` : input.text;
  const delivered: string[] = [];
  for (const person of recipients) {
    const result = await runtime.send({
      connection: whatsapp as unknown as SendConnection,
      purpose: "alert",
      recipientId: person.waId,
      text: body,
      ...(settings.alertTemplate ? { template: { name: settings.alertTemplate, language: settings.alertTemplateLanguage || "en", params: [body] } } : {}),
    }).catch((error: unknown) => ({ status: "PERMANENT_FAILURE" as const, error: error instanceof Error ? error.message : String(error), simulated: false }));
    const failure = result.status === "ACCEPTED" ? null : String((result as { error?: string }).error ?? result.status);
    delivered.push(`${person.name}: ${failure ? `not sent (${failure.slice(0, 100)})` : "sent"}`);
  }
  await db.teamAlert.update({ where: { id: alert.id }, data: { deliveredTo: delivered.join("; ").slice(0, 1000) } });
}

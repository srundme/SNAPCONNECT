import type { LeadQuestion } from "@snapsocial/domain";
import { isOldTest } from "@/lib/format";

export type Channel = "INSTAGRAM" | "FACEBOOK" | "WHATSAPP";
export type InboxView = "all" | "needs" | "mine" | "varun";

export type ContactNames = { username: string | null; displayName: string | null; chosenName: string | null };

/** The name the team calls the customer by. */
export function customerName(contact: ContactNames): string {
  return contact.chosenName?.trim() || contact.displayName?.trim() || (contact.username ? `@${contact.username}` : "Customer");
}

/** A second line under the name: their handle, or the number they gave. */
export function customerHandle(channel: Channel, contact: ContactNames, phone: string | null): string | null {
  if (channel === "WHATSAPP") return phone;
  const name = customerName(contact);
  if (contact.username && name !== `@${contact.username}`) return `@${contact.username}`;
  return phone;
}

export function isTestContact(contact: ContactNames): boolean {
  return isOldTest(contact.displayName) || isOldTest(contact.chosenName) || isOldTest(contact.username);
}

export function channelName(channel: Channel): string {
  return channel === "WHATSAPP" ? "WhatsApp" : channel === "INSTAGRAM" ? "Instagram" : "Facebook";
}

/** Internal bookkeeping the assistant writes for itself. Hidden unless the reader asks for it. */
const NOISY_SYSTEM = [/^Opening reserved\.?/i, /^Project check:/i, /^Number check:/i, /^Offer answer:/i, /^Situation:/i];

export function isNoisySystemNote(body: string): boolean {
  return NOISY_SYSTEM.some((pattern) => pattern.test(body.trim()));
}

const ZONE = "Asia/Kolkata";

function istDay(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function istDayKey(date: Date): string {
  return istDay(date);
}

/** "Today", "Yesterday", "8 Oct", or "8 Oct 2025", always in India time. */
export function dayLabel(date: Date, now = new Date()): string {
  const that = istDay(date);
  if (that === istDay(now)) return "Today";
  if (that === istDay(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  const year = (value: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: ZONE, year: "numeric" }).format(value);
  return new Intl.DateTimeFormat("en-IN", { timeZone: ZONE, day: "numeric", month: "short", ...(year(date) === year(now) ? {} : { year: "numeric" }) }).format(date);
}

/** Short labels for the lead questions, so the panel reads at a glance. */
export function shortQuestionLabel(question: LeadQuestion): string {
  const text = question.label.toLowerCase();
  if (question.kind === "name") return "Name";
  if (question.kind === "phone") return "Phone";
  if (/\be-?mail\b/.test(text)) return "Email";
  if (/\bbhk\b|kind of home|type of home|villa|apartment, villa/.test(text)) return "Home";
  if (/possession/.test(text)) return "Possession";
  if (/\bwhere\b|\barea\b|\bproject\b|\blocation\b|\bplace\b/.test(text) && !/carpet|sq\.? ?ft/.test(text)) return "Project / area";
  if (/carpet|sq\.? ?ft/.test(text)) return "Carpet area";
  const words = question.label.replace(/[?:.,!]+/g, " ").split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function readAnswers(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const answers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && raw.trim()) answers[key] = raw.trim();
    else if (typeof raw === "number" || typeof raw === "boolean") answers[key] = String(raw);
  }
  return answers;
}

/** Contact.memory as clean paragraphs: no bullets, no empty lines. */
export function memoryParagraphs(memory: string | null): string[] {
  if (!memory) return [];
  return memory
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

export function crmWording(state: string): { text: string; tone: "ok" | "wait" | "stop" | "neutral" } {
  if (state === "SYNCED") return { text: "In Zoho", tone: "ok" };
  if (state === "PENDING") return { text: "Sending to Zoho", tone: "wait" };
  if (state === "RETRYING") return { text: "Zoho send failed, retrying", tone: "wait" };
  if (state === "NEEDS_ATTENTION") return { text: "Not in Zoho, needs a look", tone: "stop" };
  return { text: "Not sent to Zoho yet", tone: "neutral" };
}

export type Ownership =
  | { kind: "ai" }
  | { kind: "paused" }
  | { kind: "handed"; reason: string | null }
  | { kind: "staff"; userId: string; name: string; mine: boolean; at: Date | null };

export function ownership(
  conversation: { owner: string; ownerUserId: string | null; ownerChangedAt: Date | null },
  names: Map<string, string>,
  me: string,
  handoffReason: string | null,
): Ownership {
  if (conversation.owner === "AI") return { kind: "ai" };
  if (conversation.owner === "PAUSED") return { kind: "paused" };
  if (!conversation.ownerUserId) return { kind: "handed", reason: handoffReason };
  return {
    kind: "staff",
    userId: conversation.ownerUserId,
    name: names.get(conversation.ownerUserId) ?? "a team member",
    mine: conversation.ownerUserId === me,
    at: conversation.ownerChangedAt,
  };
}

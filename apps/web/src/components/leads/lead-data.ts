import type { LeadQuestion } from "@snapsocial/domain";
import { isOldTest } from "@/lib/format";

/** Short, scannable column / card labels for the workspace's lead questions. */
export function shortLabel(question: Pick<LeadQuestion, "label" | "kind">): string {
  const label = question.label.toLowerCase();
  // "…what is the property name?" is the place question, not their name.
  if (question.kind === "name" || (/\bname\b/.test(label) && !/\b(property|project|builder|society|apartment|company|business)\b/.test(label))) return "Name";
  if (question.kind === "phone" || /\b(phone|mobile|number)\b/.test(label)) return "Phone";
  if (/e-?mail/.test(label)) return "Email";
  if (/\bbhk\b/.test(label)) return "Home";
  if (/carpet/.test(label)) return "Carpet area";
  if (/possession/.test(label)) return "Possession";
  if (/timeline|\bstart\b|\bfinish\b/.test(label)) return "Timeline";
  if (/\bstyle\b/.test(label)) return "Style";
  if (/where is the home|\barea\b|location|locality|project/.test(label)) return "Project / area";
  const words = question.label.replace(/[?:.,!]/g, " ").split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Question";
}

export function answersOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && raw.trim()) out[key] = raw.trim();
    else if (typeof raw === "number" || typeof raw === "boolean") out[key] = String(raw);
  }
  return out;
}

/** The question ids that feed the list's Home / Project / Possession / Email columns. */
export function columnQuestions(questions: LeadQuestion[]) {
  const find = (name: string) => questions.find((question) => shortLabel(question) === name)?.id ?? null;
  return { home: find("Home"), project: find("Project / area"), possession: find("Possession"), email: find("Email") };
}

type ContactNames = { chosenName: string | null; displayName: string | null; username: string | null };

export function leadName(contact: ContactNames): string {
  return contact.chosenName?.trim() || contact.displayName?.trim() || contact.username?.trim() || "Prospect";
}

export function isTestContact(contact: ContactNames): boolean {
  return isOldTest(contact.chosenName) || isOldTest(contact.displayName) || isOldTest(contact.username);
}

export type LeadStatus = "COLLECTING" | "QUALIFIED" | "IN_ZOHO" | "NOT_INTERESTED";

export const STATUS_LABEL: Record<LeadStatus, string> = {
  COLLECTING: "Collecting details",
  QUALIFIED: "Qualified",
  IN_ZOHO: "In Zoho",
  NOT_INTERESTED: "Not interested",
};

export function leadStatus(lead: { qualification: string; crmState: string }): LeadStatus {
  if (lead.crmState === "SYNCED") return "IN_ZOHO";
  if (lead.qualification === "DISQUALIFIED") return "NOT_INTERESTED";
  if (lead.qualification === "QUALIFIED" || lead.qualification === "CONTACTABLE") return "QUALIFIED";
  return "COLLECTING";
}

export function parseStatus(value: string | undefined): LeadStatus | undefined {
  return value === "COLLECTING" || value === "QUALIFIED" || value === "IN_ZOHO" || value === "NOT_INTERESTED" ? value : undefined;
}

export type Rating = "HOT" | "JUNK" | "UNRATED";

export function ratingOf(value: string | null | undefined): Rating {
  return value === "HOT" || value === "JUNK" ? value : "UNRATED";
}

/** The org is on zoho.in; a .com API domain means the CRM lives on crm.zoho.com. */
export function zohoLeadUrl(crmId: string, apiDomain: string | null | undefined): string {
  const host = apiDomain && /zoho(apis)?\.com\b/i.test(apiDomain) ? "crm.zoho.com" : "crm.zoho.in";
  return `https://${host}/crm/tab/Leads/${encodeURIComponent(crmId)}`;
}

export function ownerLabel(
  conversation: { owner: string; ownerUserId: string | null } | null | undefined,
  agentName: string,
  users: Map<string, string>,
): string {
  if (!conversation || conversation.owner === "AI") return agentName;
  if (conversation.owner === "PAUSED") return "Paused";
  return (conversation.ownerUserId && users.get(conversation.ownerUserId)) || "Team";
}

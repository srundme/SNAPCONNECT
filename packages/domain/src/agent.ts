import { parseMaterials, parseWarranty, type MaterialEntry, type WarrantyTerms } from "./materials";

/** Everything staff can change about how the agent behaves, edited on the Agent page. */
export type AgentSettings = {
  goal: string;
  pricingAnswer: string;
  workingHours: string;
  serviceArea: string;
  holidays: string;
  complaintContact: string;
  rules: string;
  realityChecks: string;
  designKnowledge: string;
  voiceReplies: boolean;
  photoReading: boolean;
  laughter: boolean;
  emojis: boolean;
  casualTexting: boolean;
  splitMessages: boolean;
  typingDelay: boolean;
  addressSirMam: boolean;
  expertAdvice: boolean;
  followUps: boolean;
  followUpHours: number[];
  zohoCompanyFallback: string;
  hotBudgetLakhs: number;
  zohoRatingField: string;
  /** The material specification, one entry per area. Not on the Agent page form, so saving keeps it. */
  materials: MaterialEntry[];
  warranty: WarrantyTerms | null;
  /** The team's project short forms, one per line: "APR = Adarsh Palm Retreat". */
  projectAliases: string;
  /** Who gets instant alerts, one per line: "Gopi: +91 98450 11111". */
  alertNumbers: string;
  /** A Meta-approved WhatsApp template for alerts (one body variable), so they arrive any time. Empty = plain text. */
  alertTemplate: string;
  alertTemplateLanguage: string;
  /** Owners who get the 9 AM summary, one per line: "Karthikeyan: +91 63836 53279". */
  summaryNumbers: string;
  /** A Meta-approved template for the summary (one body variable), so it arrives any day. */
  summaryTemplate: string;
  /** Homes the firm has done, one per line: "Adarsh Palm Retreat | Bellandur | 4 BHK villa | https://…". */
  completedProjects: string;
  /** "live": Claude writes every reply (needs ANTHROPIC_API_KEY). "off": the older coded pipeline. */
  brain: "live" | "off";
};

export const defaultAgentSettings: AgentSettings = {
  goal: "Understand what they need, answer their questions, and collect what the team needs to call them back.",
  pricingAnswer: "Pricing depends on their exact requirement. The team shares exact pricing on the call. Never quote a number.",
  workingHours: "Monday to Saturday, 10 AM to 7 PM",
  serviceArea: "",
  holidays: "",
  complaintContact: "",
  rules: "",
  realityChecks: "",
  designKnowledge: "",
  voiceReplies: true,
  photoReading: true,
  laughter: true,
  emojis: true,
  casualTexting: true,
  splitMessages: true,
  typingDelay: true,
  addressSirMam: true,
  expertAdvice: true,
  followUps: false,
  followUpHours: [3, 20],
  zohoCompanyFallback: "",
  hotBudgetLakhs: 0,
  zohoRatingField: "",
  materials: [],
  warranty: null,
  projectAliases: "",
  alertNumbers: "",
  alertTemplate: "",
  alertTemplateLanguage: "en",
  summaryNumbers: "",
  summaryTemplate: "",
  completedProjects: "",
  brain: "live",
};

const TOGGLES = [
  "voiceReplies",
  "photoReading",
  "laughter",
  "emojis",
  "casualTexting",
  "splitMessages",
  "typingDelay",
  "addressSirMam",
  "expertAdvice",
  "followUps",
] as const satisfies ReadonlyArray<keyof AgentSettings>;

export type AgentToggle = (typeof TOGGLES)[number];
export const agentToggles: readonly AgentToggle[] = TOGGLES;

const TEXTS = {
  goal: 600,
  pricingAnswer: 600,
  workingHours: 200,
  serviceArea: 300,
  holidays: 2000,
  complaintContact: 300,
  rules: 6000,
  realityChecks: 3000,
  designKnowledge: 20000,
  zohoCompanyFallback: 80,
  zohoRatingField: 80,
} as const satisfies Partial<Record<keyof AgentSettings, number>>;

type AgentText = keyof typeof TEXTS;
export const agentTextLimits: Readonly<Record<AgentText, number>> = TEXTS;

/** Follow-ups must land inside Meta's 24 hour reply window, so hours stay between 1 and 23. */
export function parseFollowUpHours(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[,\s]+/);
  const hours = raw.map(Number).filter((hour) => Number.isFinite(hour) && hour >= 1 && hour <= 23).map((hour) => Math.round(hour * 10) / 10);
  return [...new Set(hours)].sort((a, b) => a - b).slice(0, 3);
}

export function parseAgentSettings(value: unknown): AgentSettings {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const settings: AgentSettings = { ...defaultAgentSettings, followUpHours: [...defaultAgentSettings.followUpHours] };
  for (const key of TOGGLES) {
    if (typeof record[key] === "boolean") settings[key] = record[key];
  }
  for (const [key, limit] of Object.entries(TEXTS) as Array<[AgentText, number]>) {
    if (typeof record[key] === "string") settings[key] = record[key].trim().slice(0, limit);
  }
  if ("followUpHours" in record) {
    const hours = parseFollowUpHours(record.followUpHours);
    if (hours.length) settings.followUpHours = hours;
  }
  const line = Number(record.hotBudgetLakhs);
  if (Number.isFinite(line) && line >= 0 && line <= 10_000) settings.hotBudgetLakhs = Math.round(line * 10) / 10;
  settings.materials = parseMaterials(record.materials);
  settings.warranty = parseWarranty(record.warranty);
  if (typeof record.projectAliases === "string") settings.projectAliases = record.projectAliases.trim().slice(0, 4000);
  if (typeof record.alertNumbers === "string") settings.alertNumbers = record.alertNumbers.trim().slice(0, 2000);
  if (typeof record.alertTemplate === "string") settings.alertTemplate = record.alertTemplate.trim().replace(/[^a-z0-9_]/gi, "").slice(0, 80);
  if (typeof record.alertTemplateLanguage === "string" && record.alertTemplateLanguage.trim()) settings.alertTemplateLanguage = record.alertTemplateLanguage.trim().slice(0, 10);
  if (typeof record.summaryNumbers === "string") settings.summaryNumbers = record.summaryNumbers.trim().slice(0, 2000);
  if (typeof record.summaryTemplate === "string") settings.summaryTemplate = record.summaryTemplate.trim().replace(/[^a-z0-9_]/gi, "").slice(0, 80);
  if (typeof record.completedProjects === "string") settings.completedProjects = record.completedProjects.trim().slice(0, 20000);
  if (record.brain === "off" || record.brain === "live") settings.brain = record.brain;
  return settings;
}

/** One rule per line, so staff can paste a list. */
export function ruleLines(text: string): string[] {
  return text.split(/\n+/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
}

const LAUGHTER = /(?:^|\s)(?:ha(?:ha)+h?|he(?:he)+|lol|lmao|😂|🤣)(?=[\s.,!?…]|$)[.,!…]*/gi;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu;
const ADDRESS = /(\s*,?\s*)\b(?:sir|mam|ma'am|madam|bro)\b/gi;

/** Applies the switched-off behaviours to a reply in code, so the agent cannot slip past them. */
export function applyReplySwitches(text: string, settings: Pick<AgentSettings, "laughter" | "emojis" | "addressSirMam">): string {
  let out = text;
  if (!settings.laughter) out = out.replace(LAUGHTER, " ");
  if (!settings.emojis) out = out.replace(EMOJI, "");
  if (!settings.addressSirMam) out = out.replace(ADDRESS, "");
  return out
    .split("\n")
    .map((line) => line.replace(/\s+([.,!?])/g, "$1").replace(/^[\s.,!…]+/, "").replace(/ {2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

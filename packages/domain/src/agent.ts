import { parseMaterials, parseWarranty, type MaterialEntry, type WarrantyTerms } from "./materials";

/** Everything staff can change about how the agent behaves, edited on the Agent page. */
export type AgentSettings = {
  workingHours: string;
  serviceArea: string;
  holidays: string;
  complaintContact: string;
  designKnowledge: string;
  voiceReplies: boolean;
  photoReading: boolean;
  casualTexting: boolean;
  typingDelay: boolean;
  addressSirMam: boolean;
  followUps: boolean;
  followUpHours: number[];
  zohoCompanyFallback: string;
  hotBudgetLakhs: number;
  zohoRatingField: string;
  /** Optional Zoho field (API name) for the experience centre visit or consultation date and time. */
  zohoVisitField: string;
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
  /** "live": Claude writes every reply (needs ANTHROPIC_API_KEY). "off": no replies, every chat goes to the team. */
  brain: "live" | "off";
  /** The owner's own version of Varun's system prompt; empty means the built-in default. */
  brainPrompt: string;
  /** Replies Varun may send one chat in 24 hours before the team takes over (a cost guard). */
  dailyReplyCap: number;
};

export const defaultAgentSettings: AgentSettings = {
  workingHours: "Monday to Saturday, 10 AM to 7 PM",
  serviceArea: "",
  holidays: "",
  complaintContact: "",
  designKnowledge: "",
  voiceReplies: true,
  photoReading: true,
  casualTexting: true,
  typingDelay: true,
  addressSirMam: true,
  followUps: false,
  followUpHours: [3, 20],
  zohoCompanyFallback: "",
  hotBudgetLakhs: 0,
  zohoRatingField: "",
  zohoVisitField: "",
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
  brainPrompt: "",
  dailyReplyCap: 80,
};

const TOGGLES = [
  "voiceReplies",
  "photoReading",
  "casualTexting",
  "typingDelay",
  "addressSirMam",
  "followUps",
] as const satisfies ReadonlyArray<keyof AgentSettings>;

export type AgentToggle = (typeof TOGGLES)[number];
export const agentToggles: readonly AgentToggle[] = TOGGLES;

const TEXTS = {
  workingHours: 200,
  serviceArea: 300,
  holidays: 2000,
  complaintContact: 300,
  designKnowledge: 20000,
  zohoCompanyFallback: 80,
  zohoRatingField: 80,
  zohoVisitField: 80,
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
  if (Number.isFinite(Number(record.dailyReplyCap)) && Number(record.dailyReplyCap) >= 5) settings.dailyReplyCap = Math.min(500, Math.round(Number(record.dailyReplyCap)));
  if (typeof record.brainPrompt === "string") settings.brainPrompt = record.brainPrompt.replace(/\r\n/g, "\n").trim().slice(0, 40000);
  return settings;
}


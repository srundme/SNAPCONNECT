/** Everything staff can change about how the agent behaves, edited on the Agent page. */
export type AgentSettings = {
  goal: string;
  pricingAnswer: string;
  workingHours: string;
  serviceArea: string;
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
};

export const defaultAgentSettings: AgentSettings = {
  goal: "Understand what they need, answer their questions, and collect what the team needs to call them back.",
  pricingAnswer: "Pricing depends on their exact requirement. The team shares exact pricing on the call. Never quote a number.",
  workingHours: "Monday to Saturday, 10 AM to 7 PM",
  serviceArea: "",
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
  complaintContact: 300,
  rules: 6000,
  realityChecks: 3000,
  designKnowledge: 20000,
  zohoCompanyFallback: 80,
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

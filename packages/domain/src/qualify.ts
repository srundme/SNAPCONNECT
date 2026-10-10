import { parsePhone } from "./parse";
import type { CrmState, PreferredChannel, ProjectType, Qualification, WorkType } from "./types";

export type LeadSnapshot = {
  chosenName: string | null;
  city: string | null;
  projectType: ProjectType | null;
  propertyType: string | null;
  workType: WorkType | null;
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
  preferredChannel: PreferredChannel | null;
  phonePermission: boolean;
  whatsappPermission: boolean;
  email: string | null;
};

export type QualificationSettings = {
  requiredProjectFields: Array<"city" | "projectType" | "requirement" | "budget" | "timeframe">;
  serviceAreas: string[];
  minimumBudgetMinor: number | null;
  disqualifyOutsideArea: boolean;
  disqualifyBelowBudget: boolean;
};

export const demoQualificationSettings: QualificationSettings = {
  requiredProjectFields: ["city", "projectType", "requirement", "budget", "timeframe"],
  serviceAreas: [],
  minimumBudgetMinor: null,
  disqualifyOutsideArea: false,
  disqualifyBelowBudget: false,
};

export type QualificationDecision = {
  qualification: Qualification;
  reasons: string[];
  missing: string[];
  contactable: boolean;
};

export function evaluateQualification(
  lead: LeadSnapshot,
  settings: QualificationSettings,
): QualificationDecision {
  const reasons: string[] = [];
  const missing: string[] = [];
  const phoneReady = Boolean(lead.phoneE164 && lead.phonePermission);
  const whatsappReady = Boolean(lead.whatsappE164 && lead.whatsappPermission);
  const contactable = phoneReady || whatsappReady;
  if (!contactable) {
    if (!lead.phoneE164 && !lead.whatsappE164) missing.push("contact number");
    else missing.push("follow-up permission");
  } else {
    reasons.push("A validated number and recorded permission are present.");
  }

  const projectChecks: Record<(typeof settings.requiredProjectFields)[number], boolean> = {
    city: Boolean(lead.city),
    projectType: Boolean(lead.projectType),
    requirement: Boolean(lead.requirement),
    budget: Boolean(lead.budgetAmountMinor || lead.budgetMinMinor || lead.budgetDeclined),
    timeframe: Boolean(lead.timeframeRaw || lead.timeframeDeclined),
  };
  for (const field of settings.requiredProjectFields) {
    if (!projectChecks[field]) missing.push(field);
    else if (field === "budget" && lead.budgetDeclined) reasons.push("Budget was declined and stays a reviewable gap.");
    else if (field === "timeframe" && lead.timeframeDeclined) reasons.push("Timeline was declined and stays a reviewable gap.");
  }

  const comparableBudget = lead.budgetAmountMinor ?? lead.budgetMaxMinor ?? lead.budgetMinMinor;
  const outsideArea =
    settings.serviceAreas.length > 0 &&
    Boolean(lead.city) &&
    !settings.serviceAreas.some((area) => area.toLowerCase() === lead.city!.toLowerCase());
  const belowBudget =
    settings.minimumBudgetMinor !== null &&
    comparableBudget !== null &&
    comparableBudget < settings.minimumBudgetMinor;

  if (outsideArea && settings.disqualifyOutsideArea) {
    return {
      qualification: "DISQUALIFIED",
      reasons: [`City ${lead.city} is outside the configured service area.`],
      missing,
      contactable,
    };
  }
  if (belowBudget && settings.disqualifyBelowBudget) {
    return {
      qualification: "DISQUALIFIED",
      reasons: ["Budget is below the configured minimum."],
      missing,
      contactable,
    };
  }
  if (outsideArea) reasons.push("City is outside the configured service area and is flagged for review.");
  if (belowBudget) reasons.push("Budget is below the configured minimum and is flagged for review.");

  const projectComplete = settings.requiredProjectFields.every((field) => {
    if (field === "budget") return Boolean(lead.budgetAmountMinor || lead.budgetMinMinor) && !lead.budgetDeclined;
    if (field === "timeframe") return Boolean(lead.timeframeRaw) && !lead.timeframeDeclined;
    return projectChecks[field];
  });

  if (contactable && projectComplete && !outsideArea && !belowBudget) {
    reasons.push("Configured project fields are complete.");
    return { qualification: "QUALIFIED", reasons, missing: [], contactable };
  }
  if (contactable) {
    reasons.push("Contactable. Project qualification is still incomplete.");
    return { qualification: "CONTACTABLE", reasons, missing, contactable };
  }
  const started = Boolean(
    lead.city || lead.projectType || lead.requirement || lead.budgetRaw || lead.phoneE164 || lead.chosenName,
  );
  return {
    qualification: started ? "IN_PROGRESS" : "NEW",
    reasons,
    missing,
    contactable,
  };
}

export const replyPromptFields = [
  "projectType",
  "city",
  "requirement",
  "budget",
  "timeframe",
  "phone",
  "whatsapp",
  "permission",
  "closing",
] as const;

export const leadFieldOptions = ["projectType", "city", "requirement", "budget", "timeframe"] as const;
export type ChecklistField = (typeof leadFieldOptions)[number];
export type ZohoSendWhen = "CONTACTABLE" | "QUALIFIED";

export function parseLeadFields(value: unknown): ChecklistField[] {
  const selected = new Set(Array.isArray(value) ? value.map(String) : []);
  return leadFieldOptions.filter((field) => selected.has(field));
}

export function parseZohoSendWhen(value: unknown): ZohoSendWhen {
  return value === "QUALIFIED" ? "QUALIFIED" : "CONTACTABLE";
}

export function readyForZoho(qualification: QualificationDecision, sendWhen: ZohoSendWhen): boolean {
  if (qualification.qualification === "DISQUALIFIED") return false;
  if (sendWhen === "QUALIFIED") return qualification.qualification === "QUALIFIED";
  return qualification.contactable;
}

export type LeadQuestion = { id: string; label: string; kind: "name" | "phone" | "yesno" | "text"; zohoField: string | null; required: boolean };

const RESERVED_ZOHO_FIELDS = new Set(["Lead_Source", "External_Lead_Key", "External_Lead_Key__c"]);

export function externalLeadKeyField(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(text) || text.includes("__") || text === "Lead_Source") return "External_Lead_Key";
  return text;
}

export function sanitizeZohoField(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text || text === "Description") return null;
  if (RESERVED_ZOHO_FIELDS.has(text)) return null;
  if (!/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(text)) return null;
  return text;
}

export function defaultZohoField(question: Pick<LeadQuestion, "id" | "label" | "kind">): string | null {
  if (question.kind === "name") return "Last_Name";
  if (question.kind === "phone") return "Phone";
  if (question.id === "company-name" || /\bcompany\b/.test(question.label.toLowerCase())) return "Company";
  if (/\bemail\b/.test(question.label.toLowerCase())) return "Email";
  return null;
}

export function questionKind(label: string): LeadQuestion["kind"] {
  const text = label.toLowerCase();
  if (/\bdemo\b|interested/.test(text)) return "yesno";
  if (/phone|contact number|mobile|\bnumber\b/.test(text)) return "phone";
  if (/\bname\b/.test(text) && !/company|business/.test(text)) return "name";
  return "text";
}

export function questionId(label: string): string {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return id || "question";
}

export const MAX_LEAD_QUESTIONS = 12;

export function parseLeadQuestions(value: unknown): LeadQuestion[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  const questions: LeadQuestion[] = [];
  for (const item of value) {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : null;
    const label = String(record?.label ?? "").trim().slice(0, 180);
    if (!label) continue;
    let id = String(record?.id ?? questionId(label)).replace(/[^a-z0-9-]/g, "").slice(0, 40) || questionId(label);
    while (used.has(id)) id = `${id}-2`.slice(0, 40);
    used.add(id);
    const kind = record?.kind === "name" || record?.kind === "phone" || record?.kind === "yesno" || record?.kind === "text" ? record.kind : questionKind(label);
    const zohoField = record && "zohoField" in record ? sanitizeZohoField(record.zohoField) : defaultZohoField({ id, label, kind });
    questions.push({ id, label, kind, zohoField, required: record?.required !== false });
    if (questions.length >= MAX_LEAD_QUESTIONS) break;
  }
  return questions;
}

export function questionsFromLines(text: string): LeadQuestion[] {
  return parseLeadQuestions(text.split("\n").map((line) => line.trim()).filter(Boolean).map((label) => ({ label })));
}

export function questionsFromRows(labels: string[], fields: string[], required: boolean[] = []): LeadQuestion[] {
  return parseLeadQuestions(labels.map((label, index) => {
    const trimmed = label.trim();
    const submitted = (fields[index] ?? "").trim();
    const must = required[index] ?? true;
    return submitted ? { label: trimmed, zohoField: submitted, required: must } : { label: trimmed, required: must };
  }));
}

export function zohoValuesFromQuestions(input: {
  questions: LeadQuestion[];
  answers: Record<string, string>;
  name: string | null;
  phoneE164: string | null;
}): { fields: Record<string, string>; lines: string[] } {
  const fields: Record<string, string> = {};
  const lines: string[] = [];
  for (const question of input.questions) {
    const raw = question.kind === "name" ? input.name : question.kind === "phone" ? input.phoneE164 : input.answers[question.id];
    const text = raw?.trim();
    if (!text) continue;
    if (!question.zohoField) lines.push(`${question.label}: ${text}`);
    else fields[question.zohoField] = text;
  }
  return { fields, lines };
}

const YES_ANSWER = /^(yes|yeah|yep|sure|ok|okay|interested|i am|we are|we would|sounds good|haan|han|haa|ha|ji|ji haan|bilkul|theek|thik|aama|aamaa|aamam|ama|amam|amha|aamha|seri|sari|venum)\b/i;
const NO_ANSWER = /^(no|nope|not interested|not now|later|maybe later|nahi|nahin|nahi chahiye|abhi nahi|illa|illai|vendam|venam|vendaam|apram|aprom)\b/i;

const ENGLISH_WORDS = /\b(the|a|an|is|are|was|were|be|am|i|we|you|he|she|it|they|me|my|our|your|this|that|what|how|why|when|where|who|which|want|wanted|need|have|has|had|do|does|did|can|could|will|would|should|know|help|about|for|to|of|in|on|at|with|from|and|or|but|not|if|so|team|calls?|yes|no|ok|okay|thanks?|thank|please|company|business|name|number|demo|month|work|works|use|get|like|more|tell|just|also|there|here)\b/gi;

const WANTS_ENGLISH = /\b(speak|talk|reply|text|write|chat|message)\b.{0,20}\benglish\b|\benglish\s*(please|pls|plz|only)\b|\b(in|only)\s+english\b|\b(don'?t|do not|can'?t|cannot|dont|cant)\s+(know|understand|speak|read)\s+(tamil|hindi|telugu|kannada|malayalam)\b|\b(no|not)\s+(tamil|hindi)\b|\bstill in (tamil|hindi)\b/i;
const WANTS_LOCAL = /\b(tamil|hindi|telugu|kannada|malayalam)\s*(la|le|mein|me|lo)\s*(pesunga|pesu|baat|bolo|maatladu|matladandi|samsarikku)|\b(talk|speak|reply|chat|text|write|message)\b.{0,20}\b(tamil|hindi|telugu|kannada|malayalam)\b|\b(tamil|hindi|telugu|kannada|malayalam)\s*(please|pls|plz|only)\b/i;

export function asksForLanguage(text: string): "english" | "local" | null {
  const plain = text.replace(/[‘’`]/g, "'");
  if (WANTS_ENGLISH.test(plain)) return "english";
  if (WANTS_LOCAL.test(plain)) return "local";
  return null;
}

export function chatLanguageSample(prospectTexts: string[]): string | null {
  for (const raw of [...prospectTexts].reverse()) {
    const text = raw.trim();
    if (!text || text.startsWith("(")) continue;
    const request = asksForLanguage(text);
    if (request === "english") return null;
    if (request === "local") return text.slice(0, 160);
    const words = text.split(/\s+/).filter((word) => /\p{L}/u.test(word));
    const native = /[^\x00-\x7F‘’“”…–—₹]/.test(text.replace(/\p{Extended_Pictographic}/gu, ""));
    if (!native && words.length < 3) continue;
    if (native) return looksEnglish(text) ? null : text.slice(0, 160);
    const markers = indicMarkers(text);
    const english = text.match(ENGLISH_WORDS)?.length ?? 0;
    if (markers >= 2 && markers * 2 >= english) return text.slice(0, 160);
    if (english >= 2 && english > markers * 2) return null;
  }
  return null;
}

function indicMarkers(text: string): number {
  const plain = squeeze(text);
  return Math.max(
    plain.match(TANGLISH)?.length ?? 0,
    plain.match(HINGLISH)?.length ?? 0,
    plain.match(TELUGLISH)?.length ?? 0,
    plain.match(KANGLISH)?.length ?? 0,
  );
}

const SCRIPTS: Array<[RegExp, string]> = [
  [/[\u0B80-\u0BFF]/, "Tamil in Tamil script"],
  [/[\u0900-\u097F]/, "Hindi in Devanagari script"],
  [/[\u0C00-\u0C7F]/, "Telugu in Telugu script"],
  [/[\u0C80-\u0CFF]/, "Kannada in Kannada script"],
  [/[\u0D00-\u0D7F]/, "Malayalam in Malayalam script"],
  [/[\u0980-\u09FF]/, "Bengali in Bengali script"],
];
const TANGLISH = /\b(unga|enga|ena|enaku|iruku|irukanga|irukom|panum|panalam|panren|panunga|venum|venam|vendam|solunga|romba|konjam|ila|ilai|ama|seri|sari|nan|nenga|epdi|epadi|evlo|enoda|than|dhan|ah|la|ku|nu|kita|vanga|mudiyum|agum|aguma|pathi|enaiku|ipo|apo|ethuku|yen)\b/g;
const HINGLISH = /\b(hai|hain|kya|kaya|kia|kaise|kaisa|mein|mera|meri|mere|apka|apki|apke|apko|ap|hum|humara|hamara|hamari|nahi|nai|nahin|kar|karo|karna|karte|karega|karegi|chahiye|chaiye|chaiyey|chahie|kitne|kitna|kitni|bhai|han|haan|thek|thik|acha|bata|batao|bolo|wala|wali|muje|mujhe|mujhko|aur|bhi|abhi|kab|kon|kaun|ji|ke|ka|ki|ko|se|hazar|azar)\b/g;
const TELUGLISH = /\b(meru|nenu|undi|ledu|cheppandi|kavali|enti|ela|bagundi|chala)\b/g;
const KANGLISH = /\b(nevu|nanu|beku|heli|hege|tumba|yenu|madi)\b/g;
const NAMED_LANGUAGE: Array<[RegExp, string]> = [
  [/\bhindi\b/i, "Hinglish, which is Hindi typed in English letters"],
  [/\btamil\b/i, "Tanglish, which is Tamil typed in English letters"],
  [/\btelugu\b/i, "Telugu typed in English letters"],
  [/\bkannada\b/i, "Kannada typed in English letters"],
  [/\bmalayalam\b/i, "Malayalam typed in English letters"],
];

function squeeze(text: string): string {
  return text.toLowerCase().replace(/([a-z])\1+/g, "$1");
}

export function languageName(sample: string): string {
  for (const [pattern, name] of SCRIPTS) if (pattern.test(sample)) return name;
  if (asksForLanguage(sample) === "local") {
    for (const [pattern, name] of NAMED_LANGUAGE) if (pattern.test(sample)) return name;
  }
  const plain = squeeze(sample);
  const scores: Array<[number, string]> = [
    [plain.match(TANGLISH)?.length ?? 0, "Tanglish, which is Tamil typed in English letters"],
    [plain.match(HINGLISH)?.length ?? 0, "Hinglish, which is Hindi typed in English letters"],
    [plain.match(TELUGLISH)?.length ?? 0, "Telugu typed in English letters"],
    [plain.match(KANGLISH)?.length ?? 0, "Kannada typed in English letters"],
  ];
  const [score, name] = scores.sort((a, b) => b[0] - a[0])[0]!;
  return score > 0 ? name : "their own language typed in English letters";
}

export function looksEnglish(text: string): boolean {
  if (/[^\x00-\x7F‘’“”…–—₹]/.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return true;
  return (text.match(ENGLISH_WORDS)?.length ?? 0) / words.length >= 0.3;
}

export function screenLead(input: {
  questions: LeadQuestion[];
  answers: Record<string, string>;
  name: string | null;
  phoneE164: string | null;
}): { ready: boolean; cold: boolean; missing: string[]; optional: string[] } {
  const missing: string[] = [];
  const optional: string[] = [];
  let cold = false;
  for (const question of input.questions) {
    const gap = question.required === false ? optional : missing;
    if (question.kind === "name") {
      if (!input.name?.trim()) gap.push(question.label);
      continue;
    }
    if (question.kind === "phone") {
      if (!input.phoneE164) gap.push(question.label);
      continue;
    }
    const answer = input.answers[question.id]?.trim() ?? "";
    if (!answer) {
      gap.push(question.label);
      continue;
    }
    // A question that asks how many BHK is only answered once there is a count: "Villa" alone is not enough.
    if (/\bbhk\b/i.test(question.label) && !/\d\s*-?\s*(?:bhk|rk|bed ?rooms?|br)\b|\b(?:one|two|three|four|five|six|seven|eight|nine)\s*-?\s*(?:bhk|bed ?rooms?)\b|\bstudio\b/i.test(answer)) {
      gap.push(question.label);
      continue;
    }
    if (question.kind === "yesno" && NO_ANSWER.test(answer) && question.required !== false) cold = true;
    if (question.kind === "yesno" && !YES_ANSWER.test(answer) && !NO_ANSWER.test(answer)) gap.push(question.label);
  }
  return { ready: !cold && missing.length === 0, cold, missing, optional };
}

/**
 * Ready for Zoho as soon as the team can act: every must-have except email (name, property, home,
 * possession, phone). The rest keeps being collected and updates the same Zoho record.
 */
export function zohoReady(input: { questions: LeadQuestion[]; answers: Record<string, string>; name: string | null; phoneE164: string | null }): boolean {
  const core = input.questions.filter((question) => question.required !== false && !/\be-?mail\b/i.test(question.label) && question.zohoField !== "Email");
  const screen = screenLead({ ...input, questions: core });
  return screen.ready && !screen.cold;
}

const NOT_A_NAME = /^(enoda|ennoda|en|enga|unga|mera|mere|my|naan|nan|hi|hello|hey|bro|sir|yes|haan|name|peru|naam|looking|interested|from|here|just|not|fine|good|ok|okay|ready|sure|also|still|very|really|the|a|an|in|at|on|with|planning|trying|working|calling|asking|new|back|done|busy|happy|glad|excited|curious|thinking|available|are|arey|arre|aray|are|dei|da|di|yar|yaar|bhai|bai|bhaiya|anna|ana|thambi|ji|mam|madam|maam|acha|accha|theek|thik|hm|hmm|seri|sari|sollunga|solu|illa|ila|nahi|nai|no|ya|yeah|yep|what|why|how|who|enna|kya|kaun|evlo|kitna|wait|one|min|minute|thanks|thank|tq|pls|please|company|business|team|demo|call|price)$/i;

const NAME_FILLER = /\b(sir|bro|bhai|bhaiya|anna|ji|mam|madam|ma'am|here|myself|this is|i am|i'm|im|my name is|my name|name is|naan|nan|en peru|enoda peru|en per|mera naam|mera nam|naam|peru|hai|dhaan|than|da|di)\b/gi;

const AGENT_GREETING = "hi+|hello+|hey+|hii+|helo+|vanakkam|namaste|namaskara|namaskar|good\\s+(?:morning|evening|afternoon)";
const OWN_NAME_CLAIM = "my name(?:'s| is)?|i am|i'm|im|this is|call me|naan|en peru|enoda peru|ennoda peru|mera naam|mera nam|naam hai";

function agentNamePattern(agentName: string): string {
  return agentName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function claimsAgentAsOwnName(text: string, agentName: string): boolean {
  return new RegExp(`\\b(?:${OWN_NAME_CLAIM})\\s+${agentNamePattern(agentName)}\\b`, "i").test(text);
}

/** "Hi Varun" after his intro is them greeting him, not introducing themselves. */
export function greetedByName(text: string, agentName: string | null | undefined): boolean {
  const agent = agentName?.trim();
  if (!agent || agent.length < 2) return false;
  if (claimsAgentAsOwnName(text, agent)) return false;
  return new RegExp(`\\b(?:${AGENT_GREETING})\\b[\\s,!.]*${agentNamePattern(agent)}\\b`, "i").test(text);
}

export function cleanName(candidate: string | null | undefined, source: string, agentName?: string | null): string | null {
  if (!candidate) return null;
  const words = candidate
    .normalize("NFKC")
    .replace(/["'`.,!?:;()]/g, " ")
    .replace(NAME_FILLER, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length || words.length > 4) return null;
  if (words.some((word) => !/^[\p{L}\p{M}]+$/u.test(word))) return null;
  const full = words.filter((word) => word.length >= 2);
  if (!full.length || full.some((word) => NOT_A_NAME.test(word) || NOT_A_NAME.test(squeeze(word)))) return null;
  const said = squeeze(source.normalize("NFKC"));
  if (words.some((word) => !said.includes(squeeze(word)))) return null;
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
  if (name.length > 40) return null;
  if (agentName && greetedByName(source, agentName) && name.toLowerCase() === agentName.trim().toLowerCase()) return null;
  return name;
}

export const CALLBACK_TIME_KEY = "preferred-call-time";

export function numericQuestion(question: LeadQuestion): boolean {
  return question.kind === "text" && /team|size|volume|how many|count|number of|calls/i.test(question.label) && !/issue|why|problem|e-?mail|\bmail\b/i.test(question.label);
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000,
  ek: 1, dho: 2, teen: 3, char: 4, paanch: 5, panch: 5, das: 10, bees: 20, pachas: 50, sau: 100, hazar: 1000, hazaar: 1000, azar: 1000, hajar: 1000,
  onnu: 1, rendu: 2, moonu: 3, naalu: 4, anju: 5, pathu: 10, nooru: 100, aayiram: 1000, ayiram: 1000, lakh: 100000, lakhs: 100000,
};

function saidNumber(value: number, said: string): boolean {
  const text = said.toLowerCase().replace(/,/g, "");
  if (new RegExp(`\\b${value}\\b`).test(text)) return true;
  const short = text.match(/\b(\d+(?:\.\d+)?)\s*(k|thousand|lakh|lakhs|l)\b/g) ?? [];
  if (short.some((part) => {
    const [, amount, unit] = part.match(/(\d+(?:\.\d+)?)\s*(\w+)/) ?? [];
    return Math.round(Number(amount) * (/^l/.test(unit ?? "") ? 100000 : 1000)) === value;
  })) return true;
  return squeeze(text).split(/\W+/).some((word) => word in NUMBER_WORDS || squeeze(word) in NUMBER_WORDS);
}

function wordsWereTyped(value: string, said: string, share: number): boolean {
  const typed = squeeze(said.normalize("NFKC"));
  const words = value.normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
  if (!words.length) return false;
  return words.filter((word) => typed.includes(squeeze(word))).length / words.length >= share;
}

/** What the customer typed, without the description of a photo or document they sent. */
function spokenByThem(text: string): string {
  return text.replace(/\(Sent a photo\. It shows: [\s\S]*?\)/g, " ").replace(/\(Sent a document[\s\S]*?\)/g, " ");
}

const SAME_PLACE: Array<RegExp> = [/^(bangalore|bengaluru|banglore|bangaluru|bengalore|blr)$/, /^(mumbai|bombay)$/, /^(chennai|madras)$/, /^(gurgaon|gurugram)$/, /^(kolkata|calcutta)$/];

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
}

/** A long word counts as theirs when they typed it, misspelt it slightly (banglore), or used another name for the same city. */
function typedLongWord(word: string, said: string): boolean {
  const typed = squeeze(said.normalize("NFKC"));
  const wanted = squeeze(word);
  if (typed.includes(wanted)) return true;
  const typedWords = typed.split(/[^\p{L}\p{N}]+/u).filter((item) => item.length >= 4);
  const alias = SAME_PLACE.find((pattern) => pattern.test(wanted));
  if (alias && typedWords.some((item) => alias.test(item))) return true;
  const allowed = wanted.length >= 10 ? 2 : 1;
  return typedWords.some((item) => item[0] === wanted[0] && Math.abs(item.length - wanted.length) <= allowed && editDistance(item, wanted) <= allowed);
}

/**
 * An answer is theirs when it uses their words. A short rewording is kept when every long word
 * is still one they used, so "under construction" can stand for "still in construction".
 * A new name or place they never said is dropped.
 */
function answerIsTheirs(value: string, said: string): boolean {
  if (wordsWereTyped(value, said, 1)) return true;
  const words = value.normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
  const typed = squeeze(said.normalize("NFKC"));
  const theirs = (word: string) => typed.includes(squeeze(word)) || (word.length >= 6 && typedLongWord(word, said));
  if (!words.length || words.filter(theirs).length / words.length < 0.5) return false;
  return words.filter((word) => word.length >= 6).every((word) => typedLongWord(word, said));
}

export function acceptExtractedAnswers(input: {
  questions: LeadQuestion[];
  raw: Record<string, unknown>;
  prospectText: string;
  phoneRegion?: string;
  agentName?: string | null;
}): { name: string | null; phoneE164: string | null; answers: Record<string, string>; callbackTime: string | null; next?: string } {
  const answers: Record<string, string> = {};
  const nextId = typeof input.raw._next === "string" ? input.raw._next.trim() : "";
  const next = input.questions.some((question) => question.id === nextId) ? nextId : undefined;
  const time = input.raw[CALLBACK_TIME_KEY];
  const callbackTime = typeof time === "string" && time.trim() && !/^(null|none)$/i.test(time.trim()) && wordsWereTyped(time, input.prospectText, 0.5)
    ? time.trim().slice(0, 80)
    : null;
  let name: string | null = null;
  let phoneE164: string | null = null;
  for (const question of input.questions) {
    const value = input.raw[question.id];
    const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
    if (!text || /^(null|none|unknown|n\/a|not provided)$/i.test(text)) continue;
    if (question.kind === "text" && /^(?:no|nope|nah|not necessarily|not really|not now|not yet|not needed|later|maybe later|i don'?t have(?: it)?|don'?t have(?: it)?|nothing|skip)(?: (?:right now|now|sir|mam|bro|for now|yet))*[.!]?$/i.test(text)) continue;
    const spoken = spokenByThem(input.prospectText);
    if (question.kind === "text" && /^not sure yet$/i.test(text)) {
      if (/\b(don'?t|dont|dnt|do not|no|not|nahi|illa|theriyala)\b.{0,25}\b(know|idea|sure|decided|decide|told|pata|maloom|fixed|confirm\w*)\b|\bnot (?:yet )?decided\b|\bno idea\b|\bundecided\b|\bpata nahi\b/i.test(spoken)) {
        answers[question.id] = "Not sure yet";
      }
      continue;
    }
    if (question.kind === "name") {
      name = cleanName(text, spoken, input.agentName);
    } else if (question.kind === "phone") {
      const phone = parsePhone(text, input.phoneRegion ?? "IN");
      const digits = text.replace(/\D/g, "").slice(-10);
      if (phone.kind === "valid" && spoken.replace(/\D/g, "").includes(digits)) phoneE164 = phone.e164;
    } else if (question.kind === "yesno") {
      if (/^(yes|y|true)$/i.test(text)) answers[question.id] = "yes";
      else if (/^(no|n|false)$/i.test(text)) answers[question.id] = "no";
    } else if (numericQuestion(question)) {
      const amount = Number(text.replace(/[,\s]/g, "").match(/^\d+(?:\.\d+)?/)?.[0] ?? NaN);
      const unit = Number.isFinite(amount) ? new RegExp(`\\b${Math.round(amount)}\\s*-?\\s*(bhk|rk)\\b`, "i").exec(input.prospectText) : null;
      if (unit) answers[question.id] = `${Math.round(amount)} ${unit[1]!.toUpperCase()}`;
      else if (Number.isFinite(amount) && amount > 0 && saidNumber(amount, input.prospectText)) {
        answers[question.id] = /\bbhk\b/i.test(question.label) && amount <= 12 ? `${Math.round(amount)} BHK` : String(Math.round(amount));
      }
    } else if (answerIsTheirs(text, input.prospectText) || (/issue|why|problem/i.test(question.label) && wordsWereTyped(text, input.prospectText, 0.5))) {
      answers[question.id] = text.slice(0, 180);
    }
  }
  return next ? { name, phoneE164, answers, callbackTime, next } : { name, phoneE164, answers, callbackTime };
}

export function openingForPost(ruleTemplate: string, postOpening: string | null | undefined): string {
  const custom = postOpening?.trim();
  return custom ? custom.slice(0, 1000) : ruleTemplate;
}

export function postSystemPrompt(prompt: string | null | undefined): string | null {
  const text = prompt?.trim();
  return text ? text.slice(0, 8000) : null;
}

export function crmStateFor(input: {
  contactable: boolean;
  permissionRecorded: boolean;
  previous: CrmState;
  syncFailed: boolean;
}): CrmState {
  if (!input.contactable || !input.permissionRecorded) return input.previous === "SYNCED" ? "SYNCED" : "NOT_READY";
  if (input.previous === "SYNCED") return "SYNCED";
  if (input.syncFailed) return "NEEDS_ATTENTION";
  return "PENDING";
}

export function manualQualification(input: {
  next: Qualification;
  reason: string;
}): { ok: true } | { ok: false; error: string } {
  if (!input.reason.trim()) return { ok: false, error: "A manual qualification change requires a reason." };
  return { ok: true };
}

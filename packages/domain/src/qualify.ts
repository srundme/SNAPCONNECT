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

export type ReplyPromptField = (typeof replyPromptFields)[number];

export const defaultReplyPrompts: Record<ReplyPromptField, string> = {
  projectType: "Are you planning interiors for a home or a commercial space?",
  city: "Which city is your project in?",
  requirement: "What kind of interiors work do you need?",
  budget: "What budget range should we plan around?",
  timeframe: "When are you hoping to start?",
  phone: "Which number should the team call you on?",
  whatsapp: "Is WhatsApp on that same number, or a different one?",
  permission: "May the team call or WhatsApp you about this project?",
  closing: "Thanks. I have the project details and the team can follow up on your preferred channel.",
};

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

export function questionBrief(questions: LeadQuestion[]): string {
  const lines = questions.map((question, index) => {
    if (question.kind === "name") return `${index + 1}. ${question.label}. Record the answer as chosenName.`;
    if (question.kind === "phone") return `${index + 1}. ${question.label}. Ask them to type their mobile number. Do not ask for permission separately. When they type it, record phoneRaw and set phonePermission to yes. If they ask why, say the team will call on that number to take it forward.`;
    if (question.kind === "yesno") return `${index + 1}. ${question.label}. Record q:${question.id} as yes or no.`;
    return `${index + 1}. ${question.label}. Record q:${question.id} with their words.`;
  });
  return [
    "This chat is a SnapServe voice agent working in text. Do the same job a voice agent does on a call.",
    "After the opening, explain the voice agent in one sentence in the chat language, then ask the first missing question.",
    "If they ask how voice AI works or about SnapServe, answer that question in one sentence in the chat language, then return to the script and ask the next missing question.",
    "Ask these questions one at a time, in this order. Skip a question that is already recorded.",
    ...lines,
    "Do not ask about budget, fees, a city, or a survey.",
    "If they want a demo, record the demo question as yes and keep asking what is still missing. Do not say the demo is booked.",
    "A no on a yes-or-no question is a cold lead. Stop selling and do not ask the remaining questions.",
    "Do not invent an answer. Never say a CRM record or Zoho lead was created.",
  ].join("\n");
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
    if (question.kind === "yesno" && NO_ANSWER.test(answer) && question.required !== false) cold = true;
    if (question.kind === "yesno" && !YES_ANSWER.test(answer) && !NO_ANSWER.test(answer)) gap.push(question.label);
  }
  return { ready: !cold && missing.length === 0, cold, missing, optional };
}

export function absorbTranscript(input: {
  questions: LeadQuestion[];
  messages: { author: string; body: string }[];
  name: string | null;
  phoneE164: string | null;
  answers: Record<string, string>;
  phoneRegion?: string;
  nameReadElsewhere?: boolean;
}): { name: string | null; phoneE164: string | null; answers: Record<string, string> } {
  const answers = { ...input.answers };
  let name = input.name?.trim() || null;
  let phoneE164 = input.phoneE164;
  let lastAi = "";
  for (const message of input.messages) {
    if (message.author === "AI") {
      lastAi = message.body;
      continue;
    }
    if (message.author !== "PROSPECT") continue;
    const text = message.body.replace(/[‘’`]/g, "'").trim();
    if (!text || asksForLanguage(text)) continue;
    const plain = !YES_ANSWER.test(text) && !NO_ANSWER.test(text) && !/\?$/.test(text);
    const target = input.questions.find((question) => lastAi.includes(scriptQuestion(question)) || askedAbout(question, lastAi));
    if (target) {
      const direct = directAnswer(target, text, plain, input.phoneRegion ?? "IN");
      if (direct) {
        if (target.kind === "name") name = input.nameReadElsewhere ? name : direct;
        else if (target.kind === "phone") phoneE164 = direct;
        else answers[target.id] = direct;
        if (text.length <= 40) continue;
      }
    }
    const phone = parsePhone(text, input.phoneRegion ?? "IN");
    if (phone.kind === "valid") phoneE164 = phone.e164;
    for (const question of input.questions) {
      const askedThis = lastAi.includes(scriptQuestion(question)) || askedAbout(question, lastAi);
      if (question.kind === "name" && !name && !input.nameReadElsewhere) name = cleanName(nameFrom(text, askedThis && plain), text);
      if (answers[question.id]) continue;
      if (/company/i.test(question.label)) {
        const found = text.match(/\bcompany(?:\s+name)?\s+is\s+([A-Za-z][A-Za-z0-9 &'-]{1,40})/i) ?? text.match(/\b([A-Za-z][A-Za-z0-9 &'-]{1,40})\s+is my company\b/i);
        if (found?.[1]) answers[question.id] = found[1].trim();
        else if (askedThis && plain && text.length <= 60 && !TEAM_COUNT.test(text) && !notACompany(text)) answers[question.id] = text.replace(/[.!]+$/, "");
      } else if (/volume|calls a month|per month/i.test(question.label)) {
        const amount = text.replace(/,/g, "").match(/\b(\d{2,7})\b/);
        if (amount && Number(amount[1]) >= 50 && !/^0?\d{10}$/.test(amount[1])) answers[question.id] = amount[1];
        else if (askedThis && plain && /\d/.test(text) && text.length <= 60) answers[question.id] = text;
      } else if (/team/i.test(question.label)) {
        const amount = text.match(/\b(\d{1,4})\b/);
        const unit = /\b\d{1,4}\s*(min|mins|minutes|hrs|hours|calls|rs|k\b|lakh)/i.test(text);
        if (!unit && amount && Number(amount[1]) > 0 && Number(amount[1]) < 5000 && (text.length < 40 || askedThis || TEAM_COUNT.test(text))) answers[question.id] = amount[1];
      } else if (/issue|why/i.test(question.label) && ((text.length > 30 && /\b(call|lead|follow)/i.test(text)) || (askedThis && plain && text.length > 8))) {
        answers[question.id] = text.slice(0, 180);
      } else if (question.kind === "yesno") {
        const wantsDemo = /\bdemo\b/i.test(text) && /\b(yes|want|book|attend)\b/i.test(text);
        const yesAfterDemo = /\bdemo\b/i.test(lastAi) && YES_ANSWER.test(text);
        const noAfterDemo = /\bdemo\b/i.test(lastAi) && NO_ANSWER.test(text);
        if (wantsDemo || yesAfterDemo) answers[question.id] = "yes";
        else if (noAfterDemo) answers[question.id] = "no";
      }
    }
  }
  return { name, phoneE164, answers };
}

export function scriptedReply(input: {
  questions: LeadQuestion[];
  answers: Record<string, string>;
  name: string | null;
  phoneE164: string | null;
  latestUser: string;
  about?: string;
}): string {
  const screen = screenLead(input);
  if (screen.cold) return "Thanks for telling me. I'll leave this here.";
  if (screen.ready) return "Thanks. The team has these details and will take it from here.";
  const next = input.questions.find((question) => screen.missing.includes(question.label));
  const ask = next ? scriptQuestion(next) : "What should I know next?";
  const explain = input.about?.trim();
  const asked = /\b(how|what|works|price|cost)\b/i.test(input.latestUser);
  return asked && explain ? `${explain.replace(/[.\s]*$/, ".")} ${ask}` : ask;
}

function notACompany(text: string): boolean {
  return /\?|\b(price|pricing|cost|fee|setup|demo|how|what|why|when|english|hindi|tamil|call me|later)\b/i.test(text)
    || indicMarkers(text) >= 2;
}

const TEAM_COUNT = /\b\d{1,4}\s*(?:peru|per(?!\s*(?:month|day|week|hour|min|call))|people|members|log|staff|agents|telecallers|callers|employees|persons)\b/i;

const NOT_A_NAME = /^(enoda|ennoda|en|enga|unga|mera|mere|my|naan|nan|hi|hello|hey|bro|sir|yes|haan|name|peru|naam|looking|interested|from|here|just|not|fine|good|ok|okay|ready|sure|also|still|very|really|the|a|an|in|at|on|with|planning|trying|working|calling|asking|new|back|done|busy|happy|glad|excited|curious|thinking|available|are|arey|arre|aray|are|dei|da|di|yar|yaar|bhai|bai|bhaiya|anna|ana|thambi|ji|mam|madam|maam|acha|accha|theek|thik|hm|hmm|seri|sari|sollunga|solu|illa|ila|nahi|nai|no|ya|yeah|yep|what|why|how|who|enna|kya|kaun|evlo|kitna|wait|one|min|minute|thanks|thank|tq|pls|please|company|business|team|demo|call|price)$/i;

const NAME_FILLER = /\b(sir|bro|bhai|bhaiya|anna|ji|mam|madam|ma'am|here|myself|this is|i am|i'm|im|my name is|my name|name is|naan|nan|en peru|enoda peru|en per|mera naam|mera nam|naam|peru|hai|dhaan|than|da|di)\b/gi;

export function cleanName(candidate: string | null | undefined, source: string): string | null {
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
  return name.length <= 40 ? name : null;
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
      name = cleanName(text, spoken);
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

export function asksForName(aiText: string): boolean {
  return askedAbout({ id: "name", label: "Name", kind: "name", zohoField: null, required: true }, aiText);
}

export function mentionsOwnName(text: string): boolean {
  return /\b(name|naam|nam|peru|per|i am|i'm|im|this is|call me|myself|naan|mera|en peru)\b/i.test(text);
}

export function nameInReply(text: string, askedForName: boolean): string | null {
  const plain = !YES_ANSWER.test(text) && !NO_ANSWER.test(text) && !/\?$/.test(text);
  return cleanName(nameFrom(text, askedForName && plain), text);
}

function nameFrom(text: string, bareAllowed: boolean): string | null {
  const intro = text.match(/\b(?:i'm|i am|im|this is|naan)\s+([A-Za-z]{2,30})\b/i)?.[1]
    ?? text.match(/(?:^|\b(?:my|en|enoda|ennoda|yen|mera|mere|apna)\s+)(?:name|naam|peru)\s+(?:is\s+)?([A-Za-z]{2,30})\b/i)?.[1]
    ?? text.match(/\b([A-Za-z]{2,30})\s+(?:hai mera naam|en peru|naan dhaan|here)\b/i)?.[1];
  const bare = bareAllowed ? text.match(/^([A-Za-z]{2,30})(?:\s+[A-Za-z]{1,30}){0,2}[.!]?$/)?.[1] : undefined;
  const picked = [intro, bare].find((word) => word && !NOT_A_NAME.test(word) && !NOT_A_NAME.test(squeeze(word)) && !/ing$/i.test(word));
  return picked ? picked.charAt(0).toUpperCase() + picked.slice(1) : null;
}

function directAnswer(question: LeadQuestion, text: string, plain: boolean, region: string): string | null {
  if (question.kind === "phone") {
    const phone = parsePhone(text, region);
    return phone.kind === "valid" ? phone.e164 : null;
  }
  if (question.kind === "yesno") {
    if (YES_ANSWER.test(text)) return "yes";
    if (NO_ANSWER.test(text)) return "no";
    return null;
  }
  if (!plain) return null;
  if (question.kind === "name") return cleanName(nameFrom(text, true), text);
  if (/company/i.test(question.label)) {
    const found = text.match(/\bcompany(?:\s+name)?\s+is\s+([A-Za-z][A-Za-z0-9 &'-]{1,40})/i);
    if (found?.[1]) return found[1].trim();
    return text.length <= 60 && !/\balready\b/i.test(text) && !TEAM_COUNT.test(text) && !notACompany(text) ? text.replace(/[.!]+$/, "") : null;
  }
  if (/team/i.test(question.label) && !/volume|month/i.test(question.label)) {
    const amount = text.replace(/,/g, "").match(/\b(\d{1,5})\b(?!\s*(?:min|mins|minutes|hrs|hours|calls|rs|k\b|lakh|lakhs|per month|a month))/i);
    return amount ? amount[1] : null;
  }
  if (/volume|month|team/i.test(question.label)) {
    const amount = text.replace(/,/g, "").match(/\b(\d{1,7})\b/);
    return amount ? amount[1] : null;
  }
  if (/issue|why/i.test(question.label)) return text.length > 8 ? text.slice(0, 180) : null;
  return text.length <= 120 ? text : null;
}

const ASKING = /\b(sollunga|solunga|sollungal|sollu|chollu|cheppandi|heli|share|type|kudunga|podunga|pannunga|bataiye|bataye|batayiye|batao|bata dijiye|bataiyega|likhiye|bhejiye|tell me|let me know|please share|pls share|pls tell|could you|can you|could u|can u|may i)\b/i;

export function asksSomething(text: string): boolean {
  return text.includes("?") || ASKING.test(text) || /\b(enna|evlo|epdi|eppo|yaaru|enga|kya|kitne|kitna|kaun|kab|kaise|kahan)\b/i.test(text);
}

function askedAbout(question: LeadQuestion, aiText: string): boolean {
  const sentences = aiText.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  const requests = sentences.filter((part) => part.includes("?") || ASKING.test(part));
  const ask = (requests.length ? requests : sentences.slice(-1)).join(" ").toLowerCase();
  if (!ask) return false;
  if (question.kind === "name") return /\b(name|peru|naam)\b/.test(ask) && !/company|business|brand|organi[sz]ation/.test(ask);
  if (question.kind === "phone") return /\b(number|phone|mobile|no\.)\b/.test(ask) && !/\b(permission|use panna|mind)\b/.test(ask);
  if (question.kind === "yesno") return /\bdemo\b/.test(ask);
  if (/company/i.test(question.label)) return /company|business name|brand|organi[sz]ation/.test(ask);
  if (/volume|month/i.test(question.label)) return /calls?\b.*\b(month|monthly|maasam|masam|mahine|mahina)|call volume|how many calls|kitne calls|kitni calls|evlo calls|(maasam|masam|mahine|mahina|month).*calls?\b/.test(ask);
  if (/team/i.test(question.label)) return /team|telecaller|agents|people|staff|per irukanga|log hain/.test(ask) && !/how many calls|kitne calls|evlo calls/.test(ask);
  if (/issue|why/i.test(question.label)) return /wrong|issue|problem|challenge|why|struggl|pain|prachanai|pirachanai|dikkat|samasya|kyun|enna problem/.test(ask);
  const keywords = question.label.toLowerCase().match(/[a-z]{4,}/g)?.filter((word) => !LABEL_FILLER.has(word)) ?? [];
  return keywords.some((word) => ask.includes(word.slice(0, Math.max(4, word.length - 2))));
}

const LABEL_FILLER = new Set(["what", "which", "when", "where", "your", "their", "this", "that", "with", "have", "know", "would", "like", "much", "many", "about", "there", "from", "into", "they", "them", "please", "share", "tell", "kind", "type", "home"]);

export function scriptQuestionFor(question: LeadQuestion, language?: string | null): string {
  const local = language?.startsWith("Tanglish") ? TANGLISH_QUESTIONS : language?.startsWith("Hinglish") ? HINGLISH_QUESTIONS : null;
  if (!local) return scriptQuestion(question);
  const key = scriptKey(question);
  return key ? local[key]! : scriptQuestion(question);
}

/** Canned wording only for the labels it was written for; another workspace's "team" or "month" label keeps its own question. */
function scriptKey(question: LeadQuestion): string | null {
  const label = question.label;
  if (question.kind === "name") return "name";
  if (question.kind === "phone") return "phone";
  if (/^company( name)?$/i.test(label.trim())) return "company";
  if (/telecall\w* team|team size/i.test(label)) return "team";
  if (/what is the issue|why do you think ai calling/i.test(label)) return "issue";
  if (/call volume|calls? (a|per) month/i.test(label)) return "volume";
  if (question.kind === "yesno" && /\bdemo\b/i.test(label)) return "demo";
  return null;
}

const TANGLISH_QUESTIONS: Record<string, string> = {
  name: "Unga peru enna?",
  phone: "Unga mobile number type pannunga?",
  company: "Unga company peru enna?",
  team: "Unga telecalling team la evlo per irukanga?",
  issue: "Ippo calls la enna problem irukku?",
  volume: "Maasam evlo calls handle panreenga?",
  demo: "Demo paakka interest irukka?",
};

const HINGLISH_QUESTIONS: Record<string, string> = {
  name: "Aapka naam kya hai?",
  phone: "Apna mobile number bhej do?",
  company: "Company ka naam kya hai?",
  team: "Telecalling team mein kitne log hain?",
  issue: "Abhi calls mein kya problem aa rahi hai?",
  volume: "Mahine mein kitni calls hoti hain?",
  demo: "Demo dekhna chahoge?",
};

/** Asking for their number, not just mentioning one, like "a number upfront would be easier". */
const ASKS_FOR_NUMBER = /\b(your|ur|which|what|best|share|send|give|type|drop|alternate|another|different)\b(?:\W+\w+){0,3}?\W+(number|phone|mobile|contact)\b|\b(number|phone|mobile)\b[^.?!]{0,20}\?/i;
const SAME_NUMBER_ASKED = /\bsame\b[^.?!]*\b(number|whatsapp)\b|\bthis\s+(whatsapp\s+)?number\b|\bwhatsapp number\b|\+\d{10,13}\s*\?/i;

export function asksSameNumberIn(text: string): boolean {
  return SAME_NUMBER_ASKED.test(text) && /\?|\bshall\b|\bcan\b|\bshould\b/i.test(text);
}

export function sameNumberQuestion(phoneE164: string): string {
  return `Shall the team call you on this same WhatsApp number, ${phoneE164}?`;
}

/** True when they agree the team can call the WhatsApp number they are chatting from. */
export function agreesToWhatsAppNumber(latest: string, lastAi: string): boolean {
  const text = latest.trim();
  if (!text) return false;
  if (/\bsame\b|\bthis (one|number|no)\b|\bthis whatsapp\b/i.test(text) && !/\bnot\b/i.test(text)) return true;
  if (!SAME_NUMBER_ASKED.test(lastAi)) return false;
  if (text.replace(/\D/g, "").length >= 10) return false;
  if (/\b(no|nope|nah|not|another|different|other|illa|venam|nahi)\b/i.test(text)) return false;
  return YES_ANSWER.test(text) || /\b(ok|okay|k|sure|fine|yes|yeah|ya|yep|haan|ha|aama|seri|sari|correct|call)\b/i.test(text);
}

/** On WhatsApp the number is known, so a "which number" question becomes "this same number?", asked once. */
export function askSameNumber(reply: string, phoneE164: string): string {
  let asked = false;
  return reply
    .split(/\n+/)
    .map((line) => line
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => {
        const asksNumber = (sentence.includes("?") || ASKING.test(sentence)) && ASKS_FOR_NUMBER.test(sentence) && !SAME_NUMBER_ASKED.test(sentence);
        if (!asksNumber && !SAME_NUMBER_ASKED.test(sentence)) return sentence;
        if (asked) return "";
        asked = true;
        return asksNumber ? sameNumberQuestion(phoneE164) : sentence;
      })
      .filter(Boolean)
      .join(" ")
      .trim())
    .filter(Boolean)
    .join("\n");
}

function askScore(question: LeadQuestion, sentence: string): number {
  const ask = sentence.toLowerCase();
  if (question.kind === "name" || question.kind === "phone" || question.kind === "yesno") return askedAbout(question, sentence) ? 2 : 0;
  const keywords = [...new Set(question.label.toLowerCase().match(/\bbhk\b|[a-z]{4,}/g)?.filter((word) => !LABEL_FILLER.has(word)) ?? [])];
  return keywords.reduce((score, word) => {
    if (word === "bhk") return score + (/\bbhk\b/.test(ask) ? 2 : 0);
    const forms = [word.slice(0, Math.max(4, word.length - 2)), ...(ASK_SYNONYMS[word] ?? [])];
    return score + (forms.some((form) => ask.includes(form)) ? 1 : 0);
  }, 0);
}

/** Everyday words people use for a label's topic word, so a reworded question still counts as asked. */
const ASK_SYNONYMS: Record<string, string[]> = {
  full: ["whole", "entire", "complete", "poora", "full"],
  selected: ["certain", "specific", "particular", "some rooms", "few rooms"],
  possession: ["handover", "hand over", "keys", "taking over", "take over", "move in"],
  budget: ["spend", "investment"],
};

/** A sentence that asks something, even when the model left out the question mark. */
export function isQuestionSentence(sentence: string): boolean {
  return sentence.includes("?")
    || /^\W*(?:(?:ok(?:ay)?|sure|got it|alright|noted|and|so|also)\W+)*(?:(?:sir|mam|ma'am)\W+)?(is|are|do|does|did|when|what|which|where|how|can|could|will|would|shall|may)\b/i.test(sentence);
}

/** A strict check that a message really asked this question: a question sentence sharing two topic words with it. */
export function questionAsked(question: LeadQuestion, text: string): boolean {
  if (text.includes(scriptQuestion(question))) return true;
  const keywords = [...new Set(question.label.toLowerCase().match(/[a-z]{4,}/g)?.filter((word) => !LABEL_FILLER.has(word)) ?? [])];
  const needed = Math.min(2, keywords.length);
  return text.split(/(?<=[.!?])\s+|\n+|(?<=\.\.)(?=[^\s.])/).some((sentence) => sentence.includes("?") && askScore(question, sentence) >= needed);
}

export function refusesNumber(text: string): boolean {
  return /\b(?:don'?t|do not|won'?t|will not|not going to|can'?t|cannot)\s+(?:want to\s+|wanna\s+)?(?:share|give|send)\b[^.?!]*\b(?:number|no\.?|contact|phone|mobile)\b|\bno (?:phone|number|calls?)\b|\bdon'?t call\b/i
    .test(text.replace(/[‘’`]/g, "'"));
}

/**
 * Removes questions about details they already gave. A question counts as the one it matches best,
 * so "which area and apartment" is the area question even though home type mentions apartments.
 */
export function dropAnsweredQuestions(reply: string, questions: LeadQuestion[], answeredIds: string[]): string {
  const answered = new Set(answeredIds);
  if (!answered.size) return reply;
  const repeatsAnswer = (sentence: string) => {
    if (!isQuestionSentence(sentence) && !ASKING.test(sentence)) return false;
    if (/\b(which day|what day|what time|day and time|time suits?|suit (?:u|you)|convenient time|good time)\b/i.test(sentence)) return false;
    const scored = questions.map((question) => ({ question, score: askScore(question, sentence) })).filter((item) => item.score > 0);
    if (!scored.length) return false;
    const best = Math.max(...scored.map((item) => item.score));
    const top = scored.filter((item) => item.score === best);
    return top.every((item) => answered.has(item.question.id));
  };
  return reply
    .split(/\n+/)
    .map((line) => line.split(/(?<=[.!?])\s+|(?<=\.\.)(?=[^\s.])/).filter((sentence) => !repeatsAnswer(sentence)).join(" ").trim())
    .filter(Boolean)
    .join("\n");
}

const ECHO_FILLER = new Set(["ok", "okay", "oh", "sir", "mam", "bro", "ji", "got", "it", "its", "it's", "noted", "nice", "good", "great", "sure", "alright", "so", "that", "sounds", "is", "a", "the", "for", "you", "u", "ur", "your", "then", "right", "cool", "fine", "perfect", "lovely", "super", "in", "at", "of", "and"]);

/**
 * Removes a line that only says their answer back, like "ok sir Puravankara Purva Meraki" or
 * "whole flat sounds good sir". A line with anything of its own, or a question, stays.
 */
export function dropEchoes(reply: string, latest: string): string {
  const said = new Set(latest.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  if (!said.size) return reply;
  const echoes = (sentence: string) => {
    if (sentence.includes("?")) return false;
    const words = sentence.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
    if (words.some((word) => word === "thanks" || word === "thank")) return false;
    const own = words.filter((word) => !ECHO_FILLER.has(word));
    return own.length > 0 && own.every((word) => said.has(word.replace(/'s$/, "")));
  };
  const kept = reply
    .split(/\n+/)
    .map((line) => line.split(/(?<=[.!?])\s+|(?<=\.\.)(?=[^\s.])/).filter((sentence) => !echoes(sentence)).join(" ").trim())
    .filter(Boolean)
    .join("\n");
  return kept || reply;
}

export function replyAsksFor(question: LeadQuestion, reply: string): boolean {
  return reply.includes(scriptQuestion(question)) || askedAbout(question, reply);
}

function scriptQuestion(question: LeadQuestion): string {
  const script: Record<string, string> = {
    name: "May I know your name?",
    phone: "Which number should the team call you on?",
    company: "Which company is this for?",
    team: "How big is your telecalling team?",
    issue: "What's not working with your calls right now?",
    volume: "Roughly how many calls do you handle a month?",
    demo: "Would you like to see a quick demo?",
  };
  const key = scriptKey(question);
  return key ? script[key]! : question.label;
}

export function collectionBrief(fields: ChecklistField[], sendWhen: ZohoSendWhen): string {
  const labels: Record<ChecklistField, string> = {
    projectType: "whether this is for a business, a creator, or an agency",
    city: "the city",
    requirement: "what they need",
    budget: "the budget, and record a decline if they will not share it",
    timeframe: "when they want to start, and record a decline if they will not share it",
  };
  const extra = fields.map((field) => labels[field]);
  return [
    "Collect one detail at a time.",
    "Always ask for a phone number and whether the team may call or WhatsApp that number.",
    extra.length ? `Also collect: ${extra.join("; ")}.` : "Do not ask for a city, budget, or timeline unless the person brings it up.",
    sendWhen === "QUALIFIED"
      ? "The lead is ready only after the phone, permission, and every detail above are recorded."
      : "The lead can be handed on once the phone number and permission are recorded. Keep asking for the other details when the person is willing.",
    "Never say a CRM record, Zoho lead, or booking was created.",
  ].join("\n");
}

export function openingForPost(ruleTemplate: string, postOpening: string | null | undefined): string {
  const custom = postOpening?.trim();
  return custom ? custom.slice(0, 1000) : ruleTemplate;
}

export function postSystemPrompt(prompt: string | null | undefined): string | null {
  const text = prompt?.trim();
  return text ? text.slice(0, 8000) : null;
}

export type PostNote = { id: string; caption: string; prompt: string; seen?: string | null; link?: string | null; where?: string | null };

function postLine(post: PostNote): string | null {
  const flat = (text: string | null | undefined, max: number) => (text ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const caption = flat(post.caption, 160);
  const seen = flat(post.seen, 220);
  const note = flat(post.prompt, 200);
  if (!caption && !seen && !note) return null;
  return [
    `- ${post.where ? `${post.where} post` : "Post"}: ${caption || "no caption"}`,
    seen ? ` | the picture shows: ${seen}` : "",
    note ? ` | team notes: ${note}` : "",
    post.link ? ` | link: ${post.link}` : "",
  ].join("");
}

export function assistantContext(input: {
  accountPrompt: string | null | undefined;
  activePostId: string | null;
  posts: PostNote[];
}): { account: string | null; active: string | null; catalog: string | null } {
  const account = input.accountPrompt?.trim().slice(0, 2000) || null;
  const activePost = input.posts.find((post) => post.id === input.activePostId);
  const active = activePost
    ? [activePost.prompt.trim().slice(0, 2000), postLine({ ...activePost, prompt: "" })].filter(Boolean).join("\n") || null
    : null;
  const others = [
    ...input.posts.filter((post) => post.id !== input.activePostId && post.prompt.trim()),
    ...input.posts.filter((post) => post.id !== input.activePostId && !post.prompt.trim()),
  ];
  const lines: string[] = [];
  let used = 0;
  for (const post of others) {
    const line = postLine(post);
    if (!line) continue;
    if (lines.length >= 30 || used + line.length > 6000) break;
    lines.push(line);
    used += line.length + 1;
  }
  return { account, active, catalog: lines.length ? lines.join("\n") : null };
}

export function resolveReplyPrompts(value: unknown): Record<ReplyPromptField, string> {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const resolved = { ...defaultReplyPrompts };
  for (const key of replyPromptFields) {
    const text = record[key];
    if (typeof text === "string" && text.trim()) resolved[key] = text.trim().slice(0, 500);
  }
  return resolved;
}

export function nextReplyPrompt(
  lead: LeadSnapshot,
  settings: QualificationSettings,
  prompts: Record<ReplyPromptField, string> = defaultReplyPrompts,
): { field: ReplyPromptField; prompt: string } {
  if (!lead.projectType) return { field: "projectType", prompt: prompts.projectType };
  if (!lead.city) return { field: "city", prompt: prompts.city };
  if (!lead.requirement) return { field: "requirement", prompt: prompts.requirement };
  if (!lead.budgetRaw && !lead.budgetDeclined && settings.requiredProjectFields.includes("budget")) {
    return { field: "budget", prompt: prompts.budget };
  }
  if (!lead.timeframeRaw && !lead.timeframeDeclined && settings.requiredProjectFields.includes("timeframe")) {
    return { field: "timeframe", prompt: prompts.timeframe };
  }
  if (!lead.phoneE164 && !lead.phoneDeclined) return { field: "phone", prompt: prompts.phone };
  if (!lead.whatsappE164 && !lead.whatsappDeclined && !lead.sameNumberConfirmed) {
    return { field: "whatsapp", prompt: prompts.whatsapp };
  }
  if (lead.phoneE164 && !lead.phonePermission && !(lead.whatsappE164 && lead.whatsappPermission)) {
    return { field: "permission", prompt: prompts.permission };
  }
  return { field: "closing", prompt: prompts.closing };
}

export function nextQuestion(lead: LeadSnapshot, settings: QualificationSettings): string | null {
  return nextReplyPrompt(lead, settings).prompt;
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

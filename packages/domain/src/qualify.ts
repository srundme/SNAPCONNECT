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
  phone: "What phone number should the team use?",
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

export type LeadQuestion = { id: string; label: string; kind: "name" | "phone" | "yesno" | "text"; zohoField: string | null };

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
    questions.push({ id, label, kind, zohoField });
    if (questions.length >= 8) break;
  }
  return questions;
}

export function questionsFromLines(text: string): LeadQuestion[] {
  return parseLeadQuestions(text.split("\n").map((line) => line.trim()).filter(Boolean).map((label) => ({ label })));
}

export function questionsFromRows(labels: string[], fields: string[]): LeadQuestion[] {
  return parseLeadQuestions(labels.map((label, index) => {
    const trimmed = label.trim();
    const submitted = (fields[index] ?? "").trim();
    return submitted ? { label: trimmed, zohoField: submitted } : { label: trimmed };
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
    if (question.kind === "phone") return `${index + 1}. ${question.label}. Ask them to type their mobile number. Do not ask for permission separately. When they type it, record phoneRaw and set phonePermission to yes. If they ask why, say the team will call on that number to fix a demo time.`;
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
}): { ready: boolean; cold: boolean; missing: string[] } {
  const missing: string[] = [];
  let cold = false;
  for (const question of input.questions) {
    if (question.kind === "name") {
      if (!input.name?.trim()) missing.push(question.label);
      continue;
    }
    if (question.kind === "phone") {
      if (!input.phoneE164) missing.push(question.label);
      continue;
    }
    const answer = input.answers[question.id]?.trim() ?? "";
    if (!answer) {
      missing.push(question.label);
      continue;
    }
    if (question.kind === "yesno" && NO_ANSWER.test(answer)) cold = true;
    if (question.kind === "yesno" && !YES_ANSWER.test(answer) && !NO_ANSWER.test(answer)) missing.push(question.label);
  }
  return { ready: !cold && missing.length === 0, cold, missing };
}

export function absorbTranscript(input: {
  questions: LeadQuestion[];
  messages: { author: string; body: string }[];
  name: string | null;
  phoneE164: string | null;
  answers: Record<string, string>;
  phoneRegion?: string;
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
        if (target.kind === "name") name = direct;
        else if (target.kind === "phone") phoneE164 = direct;
        else answers[target.id] = direct;
        if (text.length <= 40) continue;
      }
    }
    if (!phoneE164) {
      const phone = parsePhone(text, input.phoneRegion ?? "IN");
      if (phone.kind === "valid") phoneE164 = phone.e164;
    }
    for (const question of input.questions) {
      const askedThis = lastAi.includes(scriptQuestion(question)) || askedAbout(question, lastAi);
      if (question.kind === "name" && !name) name = nameFrom(text, askedThis && plain);
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
}): string {
  const screen = screenLead(input);
  if (screen.cold) return "Thanks for telling me. I'll leave this here.";
  if (screen.ready) return "Thanks. The team has these details and will take it from here.";
  const next = input.questions.find((question) => screen.missing.includes(question.label));
  const ask = next ? scriptQuestion(next) : "What should I know next?";
  const asked = /\b(how|what|works|voice|snapserve|price|cost)\b/i.test(input.latestUser);
  const explain = "SnapServe is an AI voice agent. It places and answers calls, follows your script, and passes a serious enquiry to your team.";
  return asked ? `${explain} ${ask}` : ask;
}

function notACompany(text: string): boolean {
  return /\?|\b(price|pricing|cost|fee|setup|demo|how|what|why|when|english|hindi|tamil|call me|later)\b/i.test(text)
    || indicMarkers(text) >= 2;
}

const TEAM_COUNT = /\b\d{1,4}\s*(?:peru|per(?!\s*(?:month|day|week|hour|min|call))|people|members|log|staff|agents|telecallers|callers|employees|persons)\b/i;

const NOT_A_NAME = /^(enoda|ennoda|en|enga|unga|mera|mere|my|naan|nan|hi|hello|hey|bro|sir|yes|haan|name|peru|naam|looking|interested|from|here|just|not|fine|good|ok|okay|ready|sure|also|still|very|really|the|a|an|in|at|on|with|planning|trying|working|calling|asking|new|back|done|busy|happy|glad|excited|curious|thinking|available)$/i;

function nameFrom(text: string, bareAllowed: boolean): string | null {
  const intro = text.match(/\b(?:i'm|i am|im|this is|naan)\s+([A-Za-z]{2,30})\b/i)?.[1]
    ?? text.match(/(?:^|\b(?:my|en|enoda|ennoda|yen|mera|mere|apna)\s+)(?:name|naam|peru)\s+(?:is\s+)?([A-Za-z]{2,30})\b/i)?.[1]
    ?? text.match(/\b([A-Za-z]{2,30})\s+(?:hai mera naam|en peru|naan dhaan|here)\b/i)?.[1];
  const bare = bareAllowed ? text.match(/^([A-Za-z]{2,30})(?:\s+[A-Za-z]{1,30}){0,2}[.!]?$/)?.[1] : undefined;
  const picked = [intro, bare].find((word) => word && !NOT_A_NAME.test(word) && !/ing$/i.test(word));
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
  if (question.kind === "name") return nameFrom(text, true);
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

function askedAbout(question: LeadQuestion, aiText: string): boolean {
  const ask = aiText.split(/(?<=[.!])\s+/).filter((part) => part.includes("?")).join(" ").toLowerCase();
  if (!ask) return false;
  if (question.kind === "name") return /\b(name|peru|naam)\b/.test(ask) && !/company|business|brand|organi[sz]ation/.test(ask);
  if (question.kind === "phone") return /\b(number|phone|mobile|no\.)\b/.test(ask) && !/\b(permission|use panna|mind)\b/.test(ask);
  if (question.kind === "yesno") return /\bdemo\b/.test(ask);
  if (/company/i.test(question.label)) return /company|business name|brand|organi[sz]ation/.test(ask);
  if (/volume|month/i.test(question.label)) return /calls?\b.*\b(month|monthly|maasam|masam|mahine|mahina)|call volume|how many calls|kitne calls|kitni calls|evlo calls|(maasam|masam|mahine|mahina|month).*calls?\b/.test(ask);
  if (/team/i.test(question.label)) return /team|telecaller|agents|people|staff|per irukanga|log hain/.test(ask) && !/how many calls|kitne calls|evlo calls/.test(ask);
  if (/issue|why/i.test(question.label)) return /wrong|issue|problem|challenge|why|struggl|pain|prachanai|pirachanai|dikkat|samasya|kyun|enna problem/.test(ask);
  return false;
}

export function scriptQuestionFor(question: LeadQuestion, language?: string | null): string {
  const local = language?.startsWith("Tanglish") ? TANGLISH_QUESTIONS : language?.startsWith("Hinglish") ? HINGLISH_QUESTIONS : null;
  if (!local) return scriptQuestion(question);
  const key = question.kind === "name" ? "name"
    : question.kind === "phone" ? "phone"
    : /company/i.test(question.label) ? "company"
    : /team/i.test(question.label) ? "team"
    : /issue|why/i.test(question.label) ? "issue"
    : /volume|month/i.test(question.label) ? "volume"
    : question.kind === "yesno" ? "demo"
    : null;
  return key ? local[key] : scriptQuestion(question);
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

export function replyAsksFor(question: LeadQuestion, reply: string): boolean {
  return reply.includes(scriptQuestion(question)) || askedAbout(question, reply);
}

function scriptQuestion(question: LeadQuestion): string {
  if (question.kind === "name") return "What is your name?";
  if (question.kind === "phone") return "What phone number should the team use?";
  if (/company/i.test(question.label)) return "What is the company name?";
  if (/team/i.test(question.label)) return "How many people are on the telecalling team?";
  if (/issue|why/i.test(question.label)) return "What is going wrong with the calls today?";
  if (/volume|month/i.test(question.label)) return "About how many calls do you handle in a month?";
  if (question.kind === "yesno") return "Do you want to attend a demo?";
  return question.label;
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

export type PostNote = { id: string; caption: string; prompt: string };

export function assistantContext(input: {
  accountPrompt: string | null | undefined;
  activePostId: string | null;
  posts: PostNote[];
}): { account: string | null; active: string | null; catalog: string | null } {
  const account = input.accountPrompt?.trim().slice(0, 2000) || null;
  const activePost = input.posts.find((post) => post.id === input.activePostId);
  const active = activePost?.prompt.trim().slice(0, 2000) || null;
  const others = [
    ...input.posts.filter((post) => post.id !== input.activePostId && post.prompt.trim()),
    ...input.posts.filter((post) => post.id !== input.activePostId && !post.prompt.trim()),
  ];
  const lines: string[] = [];
  let used = 0;
  for (const post of others) {
    const caption = post.caption.trim().replace(/\s+/g, " ").slice(0, 80);
    const note = post.prompt.trim().replace(/\s+/g, " ").slice(0, 160);
    if (!caption && !note) continue;
    const line = note ? `- ${caption || "Post"}: ${note}` : `- ${caption}`;
    if (lines.length >= 20 || used + line.length > 2400) break;
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

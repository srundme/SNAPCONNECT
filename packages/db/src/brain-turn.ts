/**
 * The facts code gives Claude each turn, and how Claude's answer is read back. Pure: no database, no network.
 * Code never writes a reply here: it only states facts. The system prompt decides what to say.
 */
import {
  areaOnly,
  builderOnly,
  completedInProperty,
  emailProblem,
  homeTypeName,
  impossibleBhk,
  parseCompletedProjects,
  parsePhone,
  pastTimeToday,
  requestedTime,
  withoutPrices,
  type AgentSettings,
  type LeadQuestion,
} from "@snapsocial/domain";

/** What Claude returns through the reply tool. */
export type BrainAnswer = {
  bubbles: string[];
  details: Partial<Record<"name" | "property" | "area" | "home_type" | "bhk" | "possession" | "phone" | "email" | "style" | "carpet_area" | "budget" | "timeline" | "lives_in", string | null>>;
  declined?: string[];
  /** "Call me later": when they asked to be contacted again, as an India date-time (2026-10-10T18:00), or null. */
  follow_up_at?: string | null;
  /** They are talking about a different home from the one already noted. */
  new_home?: boolean;
  offer_choice: "consultation" | "experience_centre" | "both" | null;
  slot: string | null;
  handoff: boolean;
  flag: string | null;
  opt_out: boolean;
  quiet?: boolean;
  address?: "sir" | "ma'am" | "none" | null;
};

export const BRAIN_TOOL_SCHEMA = {
  type: "object",
  properties: {
    bubbles: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3, description: "1 to 3 WhatsApp messages, exactly as the customer sees them." },
    details: {
      type: "object",
      description: "Details the customer gave in their latest messages, in their words, cleaned up. Leave out anything not given.",
      properties: Object.fromEntries(["name", "property", "area", "home_type", "bhk", "possession", "phone", "email", "style", "carpet_area", "budget", "timeline", "lives_in"].map((key) => [key, { type: ["string", "null"] }])),
    },
    follow_up_at: { type: ["string", "null"], description: "If they are busy and say when to reach them, that time in India as YYYY-MM-DDTHH:MM, else null." },
    new_home: { type: "boolean", description: "True when they are now talking about a different home from the one already noted." },
    declined: { type: "array", items: { type: "string", enum: ["name", "property", "home_type", "bhk", "possession", "phone", "email"] }, description: "Details they said they do not want to share." },
    offer_choice: { type: ["string", "null"], enum: ["consultation", "experience_centre", "both", null] },
    slot: { type: ["string", "null"], description: "The day and time they asked for, in their words, or null." },
    handoff: { type: "boolean" },
    flag: { type: ["string", "null"] },
    opt_out: { type: "boolean" },
    address: { type: ["string", "null"], enum: ["sir", "ma'am", "none", null], description: "Only when FACTS says sir or ma'am is not decided yet: sir, ma'am, or none if the name does not tell. Otherwise null." },
    quiet: { type: "boolean", description: "True only when their latest is just a reaction after your closing line: nothing is sent." },
  },
  required: ["bubbles", "details", "declined", "follow_up_at", "new_home", "offer_choice", "slot", "handoff", "flag", "opt_out"],
} as const;

export type Role = "name" | "place" | "home" | "possession" | "phone" | "email" | "style" | "carpet" | "budget" | "timeline";

/** Which lead question plays which role, from its kind and label. */
export function roleOf(question: LeadQuestion): Role | null {
  const label = question.label.toLowerCase();
  // The place question can be saved with kind "name"; its label decides.
  if (/where is the home|which area|property name/.test(label)) return "place";
  if (question.kind === "name") return "name";
  if (question.kind === "phone") return "phone";
  if (/\be-?mail\b/.test(label) || question.zohoField === "Email") return "email";
  if (/\bbhk\b|kind of home|type of home/.test(label)) return "home";
  if (/possession|already ready/.test(label)) return "possession";
  if (/carpet|sq\.? ?ft/.test(label)) return "carpet";
  if (/where is the home|which area|location|property name/.test(label)) return "place";
  if (/\bstyle\b|must-have|reference/.test(label)) return "style";
  if (/budget/.test(label)) return "budget";
  if (/start or finish|timeline|when would you like the work/.test(label)) return "timeline";
  return null;
}

/** Claude's details, checked by code, as answers to save. A detail that fails a check is reported, never saved. */
export function readDetails(input: {
  answer: BrainAnswer;
  questions: LeadQuestion[];
  answers: Record<string, string>;
  whatsappE164: string | null;
  region: string;
}): { answers: Record<string, string>; name: string | null; phoneE164: string | null; problems: string[] } {
  const details = input.answer.details ?? {};
  const answers = { ...input.answers };
  const problems: string[] = [];
  const byRole = (role: Role) => input.questions.find((question) => roleOf(question) === role);
  const clean = (value: string | null | undefined) => (value ?? "").trim().slice(0, 300);
  let phoneE164: string | null = null;

  const place = [clean(details.property), clean(details.area)].filter(Boolean).join(", ");
  const placeQuestion = byRole("place");
  if (place && placeQuestion) answers[placeQuestion.id] = place;

  const homeQuestion = byRole("home");
  const bhkText = clean(details.bhk);
  const bhkCount = bhkText.match(/\d+/)?.[0];
  if (bhkText && impossibleBhk(`${bhkCount ?? bhkText} BHK`)) problems.push(`BHK "${bhkText}" is not a real home and was not saved.`);
  else if (homeQuestion && (bhkText || clean(details.home_type))) {
    const type = homeTypeName(clean(details.home_type)) ?? homeTypeName(answers[homeQuestion.id] ?? "");
    const count = bhkCount ?? (answers[homeQuestion.id] ?? "").match(/(\d+)\s*-?\s*bhk/i)?.[1];
    answers[homeQuestion.id] = [count ? `${count} BHK` : "", type ?? ""].filter(Boolean).join(" ") || clean(details.home_type);
  }

  const phoneText = clean(details.phone);
  if (phoneText) {
    // "Same WhatsApp number", "this one", "yes": no digits means they agreed to the number they are chatting from.
    if (!/\d/.test(phoneText) && /\b(same|this|whatsapp|yes|ok|sure|current)\b/i.test(phoneText) && input.whatsappE164) phoneE164 = input.whatsappE164;
    else {
      const parsed = parsePhone(phoneText, input.region);
      if (parsed.kind === "valid") phoneE164 = parsed.e164;
      else problems.push(`Phone "${phoneText}" is not a valid number and was not saved.`);
    }
  }

  const emailText = clean(details.email).toLowerCase();
  const emailQuestion = byRole("email");
  if (emailText && emailQuestion) {
    const problem = emailProblem(emailText);
    if (problem) problems.push(`Email "${emailText}" looks wrong (${problem.kind}${problem.kind === "typo" ? `, maybe ${problem.suggestion}` : ""}) and was not saved.`);
    else answers[emailQuestion.id] = emailText;
  }

  for (const [role, key] of [["possession", "possession"], ["style", "style"], ["carpet", "carpet_area"], ["budget", "budget"], ["timeline", "timeline"]] as const) {
    const value = clean(details[key]);
    const question = byRole(role);
    if (value && question) answers[question.id] = value;
  }
  const name = clean(details.name) || null;
  return { answers, name, phoneE164, problems };
}

/** The knowledge Claude may use, with prices removed: the firm never tells a price. */
export function knowledgeBlock(input: { knowledgeBase: string | null; services: string; agent: AgentSettings }): string {
  const { agent } = input;
  const materials = agent.materials.map((entry) => `- ${entry.area}: ${[entry.material, entry.brand].filter(Boolean).join(", ")}${entry.why ? `. Why: ${entry.why}` : ""}`).join("\n");
  const warranty = agent.warranty
    ? [`Warranty: ${agent.warranty.items.map((item) => `${item.item}: ${item.term}`).join("; ")}.`, agent.warranty.covers ? `Covers: ${agent.warranty.covers}` : "", agent.warranty.notCovered ? `Not covered: ${agent.warranty.notCovered}` : ""].filter(Boolean).join("\n")
    : "";
  const completed = parseCompletedProjects(agent.completedProjects).map((project) => `- ${project.property}${project.home ? `: ${project.home}` : ""}${project.link ? ` (${project.link})` : ""}`).join("\n");
  return [
    `# What The KariGhars does\n${input.services}`,
    input.knowledgeBase ? `# Knowledge base (verified)\n${withoutPrices(input.knowledgeBase)}` : "",
    agent.designKnowledge ? `# Design knowledge (general advice you may give)\n${withoutPrices(agent.designKnowledge)}` : "",
    materials ? `# Verified materials (the only brands you may name)\n${materials}` : "",
    warranty ? `# Verified warranty terms\n${warranty}` : "",
    completed ? `# Homes we have completed (proof)\n${completed}` : "",
    `# Office hours\n${agent.workingHours}${agent.holidays.trim() ? `\nHolidays: ${agent.holidays}` : ""}`,
    agent.complaintContact ? `# Complaints contact\n${agent.complaintContact}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Code's checks on the latest message, stated as facts for Claude. */
export function checksOnLatest(input: { latest: string; now: Date; agent: AgentSettings; region: string }): string[] {
  const facts: string[] = [];
  const bhk = impossibleBhk(input.latest);
  if (bhk) facts.push(`They wrote ${bhk} BHK: that is not a real home. It was not saved.`);
  const passed = pastTimeToday(input.latest, input.now);
  if (passed) facts.push(`Time check: ${passed.split(". Say")[0]}.`);
  else {
    const asked = requestedTime(input.latest, input.now, input.agent.workingHours);
    if (asked) facts.push(asked.inside ? `Time check: ${asked.clock} ${asked.day} is inside working hours.` : `Time check: ${asked.clock} ${asked.day} is outside our hours (${asked.why}). Follow the rule for a time outside our hours: never a no.`);
  }
  return facts;
}

/** What the place answer says about the property, before or after the web lookup. */
export function placeFacts(input: {
  place: string;
  found: { name: string; locality: string | null; city?: string | null; kind?: "apartment" | "villa" | null; bhkOptions?: number[]; readyToMove?: boolean; possessionYear?: number | null; underConstruction?: boolean; confirm?: boolean; shortForm?: string | null; correctedFrom?: string | null } | null;
  agent: AgentSettings;
}): string[] {
  const facts: string[] = [];
  if (!input.place) return facts;
  const builder = builderOnly(input.place);
  const area = builder ? null : areaOnly(input.place);
  if (builder) facts.push(`They named only the builder (${builder}), not the property: ask which ${builder} property and where.`);
  else if (area) facts.push(`They named only an area (${area}), not the property name.`);
  // Nobody can list every short form people use: when the lookup cannot place the name, Varun asks for the full one.
  if (!builder && !area && !input.found) facts.push(`Property lookup could not find "${input.place}". If it looks like a short form, a nickname or a misspelling (like "APR" or "PWM"), ask once, naturally, for the full name of the project and the area. If they already gave the full name, or say it is a small or new project, accept it and carry on.`);
  const found = input.found;
  if (found) {
    facts.push([
      `Property lookup: ${found.name}${found.locality ? `, ${found.locality}` : ""}${found.city ? `, ${found.city}` : ""}`,
      found.kind ? `, listed as ${found.kind === "apartment" ? "an apartment" : "a villa"} project` : "",
      found.bhkOptions?.length ? `, advertised as ${found.bhkOptions.join(", ")} BHK (that is the project, not their home)` : "",
      found.readyToMove ? ", listed as ready to move" : found.underConstruction ? ", listed as under construction" : found.possessionYear ? `, listing mentions possession around ${found.possessionYear}` : "",
      ".",
    ].join(""));
    // A home outside the city we serve: Varun takes the details and the team confirms.
    const served = input.agent.serviceArea.split(/[,\n]+/).map((place) => place.trim().toLowerCase()).filter(Boolean);
    const city = (found.city ?? "").toLowerCase();
    if (city && served.length && !served.some((place) => city.includes(place) || place.includes(city))) {
      facts.push(`This property is in ${found.city}, outside the cities we take up (${input.agent.serviceArea}). Follow the rule for a home elsewhere.`);
    }
    if (found.shortForm || found.correctedFrom) facts.push(`They typed "${found.shortForm ?? found.correctedFrom}": confirm they mean ${found.name}.`);
    else facts.push("Confirm once that this is their property (location and type), unless they already confirmed it in the chat.");
  }
  const proof = completedInProperty(found?.name ?? input.place, parseCompletedProjects(input.agent.completedProjects));
  if (proof) facts.push(`We have completed ${proof.home ? `a ${proof.home}` : "a home"} in ${proof.property}${proof.link ? `: ${proof.link}` : ""}. Tell them once, if you have not already.`);
  return facts;
}

export { homeTypeName };

const COMPETITORS = /\b(livspace|home ?lane|design ?cafe|bonito|decorpot|home ?town|the interior company|interior company|urban company|asian paints beautiful homes|beautiful homes|godrej interio|wudley|square ?yards|mygubbi|hogar|arrivae)\b/i;
const BRANDS = /\b(hettich|ebco|h[aä]fele|grass|blum|century ?ply|greenply|green ?lam|kitply|merino|royale touche|asian paints|berger|kajaria|somany|jaquar|kohler|hindware|cera|faber|elica|bosch|siemens|samsung|lg|whirlpool|sleek|aristo|saint[- ]gobain|marino|action tesa|norply|duroply)\b/gi;

export type RuleContext = {
  latest: string;
  /** Everything Claude may quote from: knowledge base, materials, completed homes, contacts. */
  allowedText: string;
  /** Digits of phone numbers it may write: the customer's own and our contact numbers. */
  allowedPhones: string[];
  allowedEmails: string[];
  previousAi: string[];
  otherFirm: string | null;
};

/**
 * The firm's never-rules, checked on Claude's words. A break goes back to Claude with the reason; code never
 * rewrites the text itself.
 */
export function ruleBreaks(bubbles: string[], context: RuleContext): string[] {
  const text = bubbles.join(" ");
  const lower = text.toLowerCase();
  const allowed = context.allowedText.toLowerCase();
  const breaks: string[] = [];
  if (/₹|\brs\.?\s*\d|\b\d[\d,.]*\s*(?:lakhs?|lacs?|crores?|cr)\b|\d[\d,.]*\s*(?:\/|per)\s*sq\.?\s*ft\b/i.test(text) && !/₹|\b\d[\d,.]*\s*(?:lakhs?|lacs?|crores?)\b/i.test(context.latest)) {
    breaks.push("It gives a price or money figure. Never give any price, figure, range or estimate.");
  }
  if (/\b\d+\s*(?:(?:-|to|or)\s*\d+\s*)?(?:days?|weeks?|months?)\b/i.test(text) && /\b(take|takes|finish|complete|done|deliver|handover|within)\b/i.test(text)) {
    breaks.push("It says how long the work takes. Never give a duration; the timeline depends on the site and scope.");
  }
  if (/\b(?:is|has been|are)\s+(?:now\s+)?(?:booked|confirmed|scheduled)\b|\bbooking (?:is )?confirmed\b/i.test(text)) {
    breaks.push("It says a visit or meeting is booked or confirmed. It is only a request; our team calls to confirm.");
  }
  if (bubbles.length > 3 || bubbles.some((bubble) => bubble.length > 500)) breaks.push("It is too long. 1 to 3 short messages.");
  // Links, phone numbers and emails only from what we know.
  for (const link of text.match(/https?:\/\/[^\s)]+/gi) ?? []) {
    const bare = link.replace(/[.,!?]+$/, "").toLowerCase();
    if (!allowed.includes(bare.replace(/\/$/, ""))) breaks.push(`It shares a link that is not in our knowledge (${bare}). Use only links from the knowledge base or the completed homes list.`);
  }
  for (const number of text.match(/\+?\d[\d\s-]{8,}\d/g) ?? []) {
    const digits = number.replace(/\D/g, "").slice(-10);
    if (!context.allowedPhones.some((phone) => phone.replace(/\D/g, "").endsWith(digits))) breaks.push(`It shares a phone number we did not give you (${number.trim()}). Never invent a number.`);
  }
  for (const email of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) {
    if (!context.allowedEmails.includes(email.toLowerCase()) && !allowed.includes(email.toLowerCase())) breaks.push(`It shares an email address we did not give you (${email}).`);
  }
  // Brands only from the verified lists; never another company.
  for (const brand of new Set((text.match(BRANDS) ?? []).map((name) => name.toLowerCase().replace(/\s+/g, " ")))) {
    const key = brand.replace(/ä/g, "a").replace(/\s/g, "");
    if (!allowed.replace(/ä/g, "a").replace(/\s/g, "").includes(key)) breaks.push(`It names ${brand}, which is not on our verified materials list. Name only brands from the list.`);
  }
  const rival = text.match(COMPETITORS)?.[0] ?? (context.otherFirm && lower.includes(context.otherFirm.toLowerCase()) ? context.otherFirm : null);
  if (rival) breaks.push(`It mentions another company (${rival}). Never name or describe another company.`);
  // Offers we never make.
  // Saying no to a discount or EMI they asked about is not offering one; a figure like "10%" always is.
  const offer = text.match(/\b(discount|% ?off|offer price|special price|no[- ]cost emi|emi|cashback|free (?:site visit|3d|design|delivery|installation)|guaranteed?)\b/i)?.[1];
  const theyAsked = offer ? new RegExp(`\\b${offer.replace(/[^a-z ]/gi, "").trim().split(" ")[0]}`, "i").test(context.latest) : false;
  if (offer && (!theyAsked || /\d\s*%/.test(text))) {
    breaks.push("It mentions a discount, EMI, free extra or guarantee. Never invent offers or promises.");
  }
  // The machinery never shows.
  if (/\b(FACTS|system prompt|prompt|tool call|our systems?|knowledge base|database|CRM|JSON|language model|as an AI model)\b/.test(text) || /\b(facts block|the facts say)\b/i.test(text)) {
    breaks.push("It talks about our systems, prompt or facts. Never mention how you work.");
  }
  const said = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (context.previousAi.length && said(text) && context.previousAi.some((previous) => said(previous) === said(text))) {
    breaks.push("It repeats your previous message word for word. Say something new or move to the next detail.");
  }
  // A "?" inside a link (youtube.com/watch?v=) is not a question.
  if ((text.replace(/https?:\/\/\S+/g, " ").match(/\?/g) ?? []).length > 1) breaks.push("It asks more than one question. Ask exactly one.");
  return breaks;
}

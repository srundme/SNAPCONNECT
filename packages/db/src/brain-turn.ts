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
  materialLine,
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
  details: Partial<Record<"name" | "property" | "area" | "home_type" | "bhk" | "possession" | "phone" | "email" | "style" | "carpet_area" | "budget" | "timeline", string | null>>;
  offer_choice: "consultation" | "experience_centre" | "both" | null;
  slot: string | null;
  handoff: boolean;
  flag: string | null;
  opt_out: boolean;
};

export const BRAIN_TOOL_SCHEMA = {
  type: "object",
  properties: {
    bubbles: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3, description: "1 to 3 WhatsApp messages, exactly as the customer sees them." },
    details: {
      type: "object",
      description: "Details the customer gave in their latest messages, in their words, cleaned up. Leave out anything not given.",
      properties: Object.fromEntries(["name", "property", "area", "home_type", "bhk", "possession", "phone", "email", "style", "carpet_area", "budget", "timeline"].map((key) => [key, { type: ["string", "null"] }])),
    },
    offer_choice: { type: ["string", "null"], enum: ["consultation", "experience_centre", "both", null] },
    slot: { type: ["string", "null"], description: "The day and time they asked for, in their words, or null." },
    handoff: { type: "boolean" },
    flag: { type: ["string", "null"] },
    opt_out: { type: "boolean" },
  },
  required: ["bubbles", "details", "offer_choice", "slot", "handoff", "flag", "opt_out"],
} as const;

export type Role = "name" | "place" | "home" | "possession" | "phone" | "email" | "style" | "carpet" | "budget" | "timeline";

/** Which lead question plays which role, from its kind and label. */
export function roleOf(question: LeadQuestion): Role | null {
  if (question.kind === "name") return "name";
  if (question.kind === "phone") return "phone";
  const label = question.label.toLowerCase();
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
    if (/^(same|this|this number|same number|yes)$/i.test(phoneText) && input.whatsappE164) phoneE164 = input.whatsappE164;
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
    if (asked) facts.push(asked.inside ? `Time check: ${asked.clock} ${asked.day} is inside working hours.` : `Time check: ${asked.clock} ${asked.day} does not work: ${asked.why}.`);
  }
  const material = materialLine(input.latest, input.agent.materials, input.agent.warranty);
  if (material) facts.push(`Materials and warranty facts for their question: ${material}`);
  return facts;
}

/** What the place answer says about the property, before or after the web lookup. */
export function placeFacts(input: {
  place: string;
  found: { name: string; locality: string | null; kind?: "apartment" | "villa" | null; bhkOptions?: number[]; readyToMove?: boolean; possessionYear?: number | null; underConstruction?: boolean; confirm?: boolean; shortForm?: string | null; correctedFrom?: string | null } | null;
  agent: AgentSettings;
}): string[] {
  const facts: string[] = [];
  if (!input.place) return facts;
  const builder = builderOnly(input.place);
  const area = builder ? null : areaOnly(input.place);
  if (builder) facts.push(`They named only the builder (${builder}), not the property: ask which ${builder} property and where.`);
  else if (area) facts.push(`They named only an area (${area}), not the property name.`);
  const found = input.found;
  if (found) {
    facts.push([
      `Property lookup: ${found.name}${found.locality ? `, ${found.locality}` : ""}`,
      found.kind ? `, listed as ${found.kind === "apartment" ? "an apartment" : "a villa"} project` : "",
      found.bhkOptions?.length ? `, advertised as ${found.bhkOptions.join(", ")} BHK (that is the project, not their home)` : "",
      found.readyToMove ? ", listed as ready to move" : found.underConstruction ? ", listed as under construction" : found.possessionYear ? `, listing mentions possession around ${found.possessionYear}` : "",
      ".",
    ].join(""));
    if (found.shortForm || found.correctedFrom) facts.push(`They typed "${found.shortForm ?? found.correctedFrom}": confirm they mean ${found.name}.`);
    else facts.push("Confirm once that this is their property (location and type), unless they already confirmed it in the chat.");
  }
  const proof = completedInProperty(found?.name ?? input.place, parseCompletedProjects(input.agent.completedProjects));
  if (proof) facts.push(`We have completed ${proof.home ? `a ${proof.home}` : "a home"} in ${proof.property}${proof.link ? `: ${proof.link}` : ""}. Tell them once, if you have not already.`);
  return facts;
}

export { homeTypeName };

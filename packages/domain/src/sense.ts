import { homeTypeName, selectedRoomsOnly } from "./rating";
import { bareBudget, rupeesIn, sizeIn } from "./style";

export type ContextCheck = {
  /** Stable for the same answers, so each doubt is raised once and again only when the answer changes. */
  key: string;
  /** The question being double-checked, which the agent may ask about again in this reply. */
  questionId: string | null;
  /** Shown to staff in the chat. */
  note: string;
  /** Told to the agent for this reply. */
  line: string;
};

type Question = { id: string; label: string };

const BUDGET = /budget|price|spend|cost/i;
const SIZE = /sq\.?\s*ft|square|carpet/i;
const HOME_TYPE = /bhk|kind of home|type of home|property type/i;
const SCOPE = /full home|selected rooms|scope/i;
const WHEN = /possession|start|finish|move in|handover|timeline/i;
const PLACE = /where is the home|location|which city|which area|locality/i;
const POSSESSION = /possession|already ready|home ready|handover/i;
export const RENOVATING = /\b(renovat\w*|remodel\w*|revamp\w*|makeover|redo(?:ing)? (?:my|our|the) (?:home|house|flat)|re-?do (?:my|our|the) (?:home|house|flat)|old (?:house|home|flat))\b/i;
const LIVING_IN = /\b(?:already|currently|now) (?:living|staying)\b|\b(?:living|staying) (?:already|now|there)\b|\b(?:living|staying) (?:already|now|there)\b|\b(?:living|staying) (?:already|now|there)\b|\b(?:living|staying) (?:in|on|at) (?:that|this|the|my|our) (?:house|home|flat|villa)\b|\bwe live (?:there|in it)\b/i;

/** Lowest believable budget for full-home premium interiors, by BHK. Anything below is respected but checked. */
const FULL_HOME_FLOOR: Record<number, number> = { 1: 300_000, 2: 400_000, 3: 500_000, 4: 700_000, 5: 1_000_000 };
/** Usual carpet area by BHK; far outside means a typo or a mixed-up answer. */
const CARPET_RANGE: Record<number, [number, number]> = { 1: [250, 1000], 2: [450, 1700], 3: [750, 3000], 4: [1100, 5500], 5: [1600, 9000] };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// Whole month words only: "maybe", "marriage" and "decided" are not months, and "may" needs a date around it.
const MONTH_WORDS = [/\bjan(?:uary)?\b/i, /\bfeb(?:ruary)?\b/i, /\bmar(?:ch)?\b/i, /\bapr(?:il)?\b/i, /\bmay\s*(?:'|20)?\d{2}\b|\b(?:in|by|of|till|until|from|before|after|end)\s+may\b/i, /\bjune?\b/i, /\bjuly?\b/i, /\baug(?:ust)?\b/i, /\bsep(?:t|tember)?\b/i, /\boct(?:ober)?\b/i, /\bnov(?:ember)?\b/i, /\bdec(?:ember)?\b/i];

function monthIn(text: string): number {
  return MONTH_WORDS.findIndex((pattern) => pattern.test(text));
}
const CITIES = [
  "chennai", "madras", "hyderabad", "secunderabad", "mumbai", "bombay", "navi mumbai", "thane", "pune", "delhi", "new delhi", "noida", "gurgaon", "gurugram",
  "ghaziabad", "faridabad", "kolkata", "calcutta", "kochi", "cochin", "trivandrum", "thiruvananthapuram", "kozhikode", "calicut", "coimbatore", "madurai",
  "trichy", "tiruchirappalli", "salem", "vellore", "pondicherry", "puducherry", "mysore", "mysuru", "mangalore", "mangaluru", "hubli", "dharwad", "belgaum",
  "belagavi", "davangere", "shimoga", "hosur", "vijayawada", "visakhapatnam", "vizag", "tirupati", "warangal", "ahmedabad", "surat", "vadodara", "baroda",
  "rajkot", "jaipur", "udaipur", "lucknow", "kanpur", "nagpur", "nashik", "aurangabad", "indore", "bhopal", "chandigarh", "mohali", "ludhiana", "amritsar",
  "goa", "panaji", "bhubaneswar", "patna", "ranchi", "guwahati", "dehradun", "dubai", "abu dhabi", "singapore", "london", "usa",
];

/** "budget 8" or "carpet area 1200 sq ft": a labelled answer, even when that question was not the one just asked. */
export function labelledAnswers(questions: Question[], text: string): Record<string, string> {
  const found: Record<string, string> = {};
  const budget = text.match(/\bbudget(?:\s*(?:is|of|:|-|around|about|approx\w*|max\w*|roughly))*\s*((?:rs\.?|₹|inr)?\s*\d[\d,.]*\s*(?:lakhs?|lacs?|l|crores?|cr|k|thousand)?)\b/i);
  const budgetId = questionFor(questions, BUDGET)?.id;
  if (budget && budgetId) found[budgetId] = budget[1]!.trim();
  const size = text.match(/\b(?:carpet|built[- ]?up|super built[- ]?up|area|size)\s*(?:area)?(?:\s*(?:is|of|:|-|around|about|approx\w*|roughly))*\s*(\d[\d,.]*\s*(?:sq\.?\s*(?:ft|feet|m|mt|mtrs?|meters?|metres?|yards?|yds?)|square\s*\w+|sqft|sft|sqm|cents?|guntas?)?)/i);
  const sizeId = questionFor(questions, SIZE)?.id;
  if (size && sizeId) found[sizeId] = size[1]!.trim();
  const possessionId = questionFor(questions, POSSESSION)?.id;
  if (possessionId && LIVING_IN.test(text)) found[possessionId] = "Ready: they already live there (renovation)";
  else if (possessionId && RENOVATING.test(text)) found[possessionId] = "Ready: renovating a home they already have";
  const email = text.match(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/);
  const emailId = questionFor(questions, /e-?mail/i)?.id;
  if (email && emailId) found[emailId] = email[0];
  return found;
}

const OWN_LAND = /\b(?:ind[ei]p\w*nd\w*|indiv\w*d\w*l|own|standalone|separate)\s+(?:villa|house|home|bungalow|building)\b|\bown (?:land|plot|site)\b|\bbuilt (?:it )?(?:on|in) (?:our|my) (?:own )?(?:land|plot|site)\b|\bbungalow\b/i;

/** A home on their own land, like an independent villa or house, which has no project to look up. */
export function ownLandHome(text: string): boolean {
  return OWN_LAND.test(text);
}

/** Their answer to where the home is, which may name the apartment project. */
export function placeAnswer(questions: Question[], answers: Record<string, string>): string {
  return answerFor(questions, answers, PLACE);
}

function questionFor(questions: Question[], pattern: RegExp): Question | undefined {
  return questions.find((item) => pattern.test(item.label));
}

function answerFor(questions: Question[], answers: Record<string, string>, pattern: RegExp): string {
  const question = questionFor(questions, pattern);
  return question ? String(answers[question.id] ?? "").trim() : "";
}

function bhkIn(text: string): number | null {
  const match = text.match(/(?<!\d)(\d{1,2})\s*-?\s*(?:bhk|bed\s*rooms?|br)\b/i);
  return match ? Number(match[1]) : null;
}

function rupeeWords(rupees: number): string {
  if (rupees >= 10_000_000) return `${+(rupees / 10_000_000).toFixed(2)} crore`;
  if (rupees >= 100_000) return `${+(rupees / 100_000).toFixed(2)} lakh`;
  return `${rupees.toLocaleString("en-IN")} rupees`;
}

/** A month and year that are already behind us, like "January 2024" in October 2026. */
function pastDate(text: string, now: Date): string | null {
  const year = Number(text.match(/\b(20\d{2})\b/)?.[1] ?? NaN);
  if (!Number.isFinite(year)) return null;
  const monthIndex = monthIn(text);
  const thisYear = now.getFullYear();
  if (/\b(ready|done|completed|received|got|handed|already|moved)\b/i.test(text)) return null;
  if (year < thisYear) return `${monthIndex >= 0 ? `${MONTHS[monthIndex]!.toUpperCase()} ` : ""}${year}`;
  if (year === thisYear && monthIndex >= 0 && monthIndex < now.getMonth()) return `${MONTHS[monthIndex]!.toUpperCase()} ${year}`;
  return null;
}

/** How many months ahead a date like "March 2028", "end of 2027" or "after 2 years" is. */
function monthsAway(text: string, now: Date): number | null {
  if (/\bnext month\b/i.test(text)) return 1;
  if (/\bthis month\b/i.test(text)) return 0;
  const months = text.match(/\b(?:after|in|within)\s+(\d+(?:\.\d+)?)\s*months?\b/i);
  if (months) return Math.round(Number(months[1]));
  if (/\b(?:within|in)\s+(?:a|1|one)\s*(?:year|yr)\b|\bnext year\b/i.test(text)) return 12;
  const years = text.match(/\b(?:after|in|within)\s+(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/i);
  if (years) return Math.round(Number(years[1]) * 12);
  const year = Number(text.match(/\b(20\d{2})\b/)?.[1] ?? NaN);
  if (!Number.isFinite(year)) return null;
  const named = monthIn(text);
  const month = named >= 0 ? named : /\bend\b/i.test(text) ? 11 : /\b(start|early|beginning)\b/i.test(text) ? 0 : 6;
  return (year - now.getFullYear()) * 12 + month - now.getMonth();
}

function whenMonths(text: string, now: Date): number | null {
  if (!text) return null;
  if (/\b(ready|already|living|staying|renovat)\b/i.test(text)) return 0;
  return monthsAway(text, now);
}

/** A budget whose meaning is unclear: a rate per sq ft, a bare "3", a few thousand for a full home, or a crore for a flat. */
function budgetShorthand(
  text: string,
  budget: number | null,
  home: { fullHome: boolean; villa: boolean; bhk: number | null },
): Omit<ContextCheck, "questionId"> | null {
  if (!text || budget === null) return null;
  if (/per\s*(sq|square|ft|sft)|\/\s*(sq|sft)|\bpsf\b/i.test(text)) {
    return {
      key: `budget-rate:${budget}`,
      note: `Budget given as a rate per sq ft: "${text}".`,
      line: `They gave a rate per sq ft ("${text}"), not a total budget. That is fine: do not do the maths and do not quote a total. If it fits, lightly ask what total budget they have in mind.`,
    };
  }
  const bare = bareBudget(text);
  if (bare !== null) {
    return {
      key: `budget-unit:${bare}`,
      note: `Budget "${text}" has no unit; most likely ${bare} lakh.`,
      line: `They said "${text}" for the budget with no unit. For home interiors that almost surely means ${bare} lakh, never crore. Confirm it lightly in a few words, like "${bare} lakh, right?", and never laugh at it.`,
    };
  }
  if (budget >= 1_000 && budget < 100_000 && home.fullHome) {
    return {
      key: `budget-small:${budget}`,
      note: `Budget "${text}" for a full home; they may mean lakhs or a budget per room.`,
      line: `They said "${text}" for the full home, which is far below what any full home costs. They may mean lakhs. Check lightly what they meant, without making them feel bad. Never suggest doing it room by room.`,
    };
  }
  if (budget >= 10_000_000 && !home.villa && home.bhk && home.bhk <= 4) {
    return {
      key: `budget-crore:${budget}`,
      note: `Budget "${text}" is very high for a flat's interiors; it may be the flat's price.`,
      line: `They said "${text}". For a flat's interiors that is very high, so it may be the price of the flat itself. Lightly check whether that is the budget for the interiors.`,
    };
  }
  return null;
}

const ROAD_AFTER = /^(?:road|rd|cross|highway|expressway|main)\b/;

function otherCity(text: string, serviceArea: string[]): string | null {
  const lower = ` ${text.toLowerCase().replace(/[^a-z ]+/g, " ")} `;
  if (serviceArea.some((place) => place && lower.includes(` ${place} `))) return null;
  return CITIES.find((city) => {
    const needle = ` ${city} `;
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(needle, from);
      if (at < 0) return false;
      if (!ROAD_AFTER.test(lower.slice(at + needle.length))) return true;
      from = at + needle.length;
    }
    return false;
  }) ?? null;
}

/** The latest single BHK and home type they stated, so a correction replaces the earlier one. */
export function preferLatestHome(current: string, texts: string[]): string {
  let bhk: string | null = null;
  let kind: string | null = null;
  for (const text of texts) {
    const nums = [...text.matchAll(/\b([1-9])\s*-?\s*bhk\b/gi)].map((match) => match[1]!);
    if (new Set(nums).size === 1) bhk = `${nums[0]} BHK`;
    const type = homeTypeName(text);
    if (type) kind = type;
  }
  if (!bhk && !kind) return current;
  const kept = current.match(/\b([1-9])\s*-?\s*bhk\b/i);
  const currentBhk = kept ? `${kept[1]} BHK` : null;
  const nextBhk = bhk ?? currentBhk;
  const nextKind = kind ?? homeTypeName(current);
  return [nextBhk, nextKind].filter(Boolean).join(" ");
}

const PLACE_FIX = /\b(actually|sorry|i meant|not that|wrong project|it(?:'s| is) in)\b/i;
const NAME_OR_CONTACT = /\bmy name\b|\bcall me\b|\b(?:i am|i'm|im)\s+(?!in\b)|\bmy (?:no\.?|number|phone|mobile|email|e-?mail)\b|@|^\+?\d[\d\s-]{8,}$/i;

/** A name, phone or email correction, which must not be saved as where the home is. */
// Bengaluru developers and their brands. A builder alone is not a property: "Puravankara" has dozens.
const BUILDER_NAMES: Array<[RegExp, string]> = [
  [/\bpuravankara\b/i, "Puravankara"], [/\bpurva\b/i, "Purva"], [/\bprovident\b/i, "Provident"],
  [/\bprestige\b/i, "Prestige"], [/\bsobha\b/i, "Sobha"], [/\bbrigade\b/i, "Brigade"], [/\bgodrej\b/i, "Godrej"],
  [/\bembassy\b/i, "Embassy"], [/\bsalarpuria\b/i, "Salarpuria"], [/\bsattva\b/i, "Sattva"], [/\bmantri\b/i, "Mantri"],
  [/\bshriram\b/i, "Shriram"], [/\bassetz\b/i, "Assetz"], [/\badarsh\b/i, "Adarsh"], [/\bconcorde\b/i, "Concorde"],
  [/\btotal environment\b/i, "Total Environment"], [/\bsumadhura\b/i, "Sumadhura"], [/\bvaswani\b/i, "Vaswani"],
  [/\bnitesh\b/i, "Nitesh"], [/\bmahindra\b/i, "Mahindra"], [/\btata housing\b/i, "Tata Housing"], [/\bdlf\b/i, "DLF"],
  [/\bsnn\b/i, "SNN"], [/\bcasagrand\b/i, "Casagrand"], [/\bbhartiya\b/i, "Bhartiya"], [/\bmana\b/i, "Mana"],
  [/\bsterling\b/i, "Sterling"], [/\bkolte\s*patil\b/i, "Kolte Patil"], [/\blodha\b/i, "Lodha"], [/\bbirla\b/i, "Birla"],
];

/**
 * The developer's name with nothing that picks one of their properties: "Puravankara",
 * "Prestige at Bangalore", "it's a Sobha flat". Returns the builder, or null when a property is named.
 */
export function builderOnly(text: string): string | null {
  const plain = text.replace(/^\(Replied to:[\s\S]*?\)\s*/, "").trim();
  const builder = BUILDER_NAMES.find(([pattern]) => pattern.test(plain));
  if (!builder) return null;
  const rest = plain
    .replace(builder[0], " ")
    .replace(/\b(bengaluru|bangalore|banglore|blr|in|at|it'?s|its|a|an|the|my|our|flat|flats|home|house|apartment|apartments|villa|villas|project|property|builder|group|developers?|projects|from|by|is|sir|mam|ji|only|one|ok|yes)\b/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim();
  return rest ? null : builder[1];
}

export function notAPlaceSentence(text: string): boolean {
  return NAME_OR_CONTACT.test(text.replace(/^\(Replied to:[\s\S]*?\)\s*/, "").trim());
}

/** A later "actually, it's in Whitefield" replaces the project they named first. */
export function preferLatestPlace(current: string, texts: string[]): string {
  let next = current;
  for (const text of texts) {
    const cleaned = text.replace(/^\(Replied to:[\s\S]*?\)\s*/, "").trim();
    if (!PLACE_FIX.test(cleaned) || cleaned.length < 8 || cleaned.length > 160) continue;
    if (/^\s*(?:actually|sorry|i meant)[, ]+\d\s*-?\s*bhk\b/i.test(cleaned)) continue;
    if (notAPlaceSentence(cleaned)) continue;
    next = cleaned.replace(/^(?:actually|sorry|i meant)[, ]+/i, "").trim();
  }
  return next;
}

/**
 * Common sense a good consultant applies without being told: a budget that cannot cover the scope,
 * a size that does not fit the home, a date already gone, a home outside the area served.
 * These do not block anything; they shape one reply and leave a note for the team.
 */
export function contextChecks(input: {
  questions: Question[];
  answers: Record<string, string>;
  now: Date;
  serviceArea?: string;
}): ContextCheck[] {
  const { questions, answers } = input;
  const checks: ContextCheck[] = [];
  const homeType = answerFor(questions, answers, HOME_TYPE);
  const bhk = bhkIn(homeType) ?? bhkIn(Object.values(answers).join(" "));
  const villa = /\bvilla|independent|bungalow|row house\b/i.test(homeType);

  const budgetText = answerFor(questions, answers, BUDGET);
  const budget = budgetText ? rupeesIn(budgetText) : null;
  const budgetId = questionFor(questions, BUDGET)?.id ?? null;
  const scope = answerFor(questions, answers, SCOPE);
  const fullHome = !selectedRoomsOnly(scope) && (!scope || /\b(full|whole|entire|complete|all rooms|end to end)\b/i.test(scope));
  const floor = villa ? 1_000_000 : bhk ? FULL_HOME_FLOOR[Math.min(bhk, 5)] : undefined;
  const shorthand = budgetShorthand(budgetText, budget, { fullHome, villa, bhk });
  if (shorthand) {
    checks.push({ ...shorthand, questionId: budgetId });
  } else if (budget && budget >= 10_000 && fullHome && floor && budget < floor) {
    const what = villa ? "full villa" : `full ${bhk} BHK`;
    checks.push({
      key: `budget-scope:${budget}:${what}`,
      questionId: null,
      note: `Budget of ${rupeeWords(budget)} looks low for a ${what} with premium interiors. Worth a review before the call.`,
      line: `Their budget of ${rupeeWords(budget)} is on the low side for premium interiors for a ${what}. Respect it fully: never say it is too low, never mock it, never turn them away and never suggest a cheaper package, stages, or selected rooms. Say in one line that the designer will see what fits the full home in that range, then continue.`,
    });
  }

  const sizeText = answerFor(questions, answers, SIZE);
  const size = sizeIn(sizeText);
  const feet = size?.feet ?? NaN;
  const sizeId = questionFor(questions, SIZE)?.id ?? null;
  if (size?.unit) {
    checks.push({
      key: `area-unit:${size.value}:${size.unit}`,
      questionId: null,
      note: `Size given as ${size.value} ${size.unit}${size.plot ? " (land or plot size, not the carpet area)" : `, about ${Math.round(feet).toLocaleString("en-IN")} sq ft`}.`,
      line: size.plot
        ? `They gave ${size.value} ${size.unit}, which is the land or plot size, not the carpet area of the home. That is fine. If it matters, lightly ask the built-up or carpet area of the home itself.`
        : `They gave the size as ${size.value} ${size.unit}, which is about ${Math.round(feet).toLocaleString("en-IN")} sq ft. Understand it that way and do not ask again for the size.`,
    });
  }
  const builtUp = /\b(built[- ]?up|super|sba|saleable)\b/i.test(sizeText);
  const range = bhk && !villa && !size?.plot ? CARPET_RANGE[Math.min(bhk, 5)] : undefined;
  const upper = range ? range[1] * (builtUp ? 1.4 : 1) : 0;
  if (Number.isFinite(feet) && feet >= 100 && range && (feet < range[0] || feet > upper)) {
    const shown = Math.round(feet).toLocaleString("en-IN");
    checks.push({
      key: `area-bhk:${Math.round(feet)}:${bhk}`,
      questionId: sizeId,
      note: `${shown} sq ft for a ${bhk} BHK is unusual. Confirm on the call.`,
      line: `They said ${shown} sq ft for a ${bhk} BHK, which is unusual (a ${bhk} BHK is usually about ${range[0]} to ${range[1]} sq ft carpet). Check once, lightly, whether that is carpet or built-up area or a typo. Do not insist, accept what they say.`,
    });
  }

  for (const question of questions.filter((item) => WHEN.test(item.label))) {
    const text = String(answers[question.id] ?? "");
    const far = text ? monthsAway(text, input.now) : null;
    if (far !== null && far > 12) {
      checks.push({
        key: `far-date:${question.id}:${far}`,
        questionId: null,
        note: `Early stage: "${text}" is about ${far} months away. Not urgent; keep in touch.`,
        line: `They said "${text}", which is more than a year away, so they are early. Help them fully and keep it warm, but do not push for a call or a site visit now. Say the team can plan the design closer to the date, or start early on design if they want to.`,
      });
      continue;
    }
    const past = text ? pastDate(text, input.now) : null;
    if (!past) continue;
    checks.push({
      key: `past-date:${question.id}:${past}`,
      questionId: question.id,
      note: `"${text}" for "${question.label}" is already in the past.`,
      line: `They said "${text}" for ${question.label.toLowerCase().replace(/\?$/, "")}, but that date has already passed. Lightly check whether they meant next year, or whether the home is already handed over. One short question, no fuss.`,
    });
  }

  const possessionText = answerFor(questions, answers, POSSESSION);
  const timelineText = questions
    .filter((question) => /\b(start|finish|timeline)\b/i.test(question.label) && !POSSESSION.test(question.label))
    .map((question) => String(answers[question.id] ?? "").trim())
    .find(Boolean) ?? "";
  const possessionMonths = whenMonths(possessionText, input.now);
  const timelineMonths = whenMonths(timelineText, input.now);
  const soon = (months: number | null) => months !== null && months <= 3;
  const distant = (months: number | null) => months !== null && months >= 18;
  if (possessionText && timelineText && ((soon(possessionMonths) && distant(timelineMonths)) || (distant(possessionMonths) && soon(timelineMonths)))) {
    checks.push({
      key: `date-clash:${possessionMonths}:${timelineMonths}`,
      questionId: null,
      note: `Possession "${possessionText}" and timeline "${timelineText}" do not sit together.`,
      line: `They said possession is "${possessionText}" and the work timing is "${timelineText}". Those do not sit together. Check once, lightly, which one they mean. Do not insist, and do not ask any other question in that reply.`,
    });
  }

  const place = answerFor(questions, answers, PLACE);
  const area = (input.serviceArea ?? "").split(/[,\n]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  const city = area.length && place ? otherCity(place, area) : null;
  if (city) {
    const served = (input.serviceArea ?? "").split(/[,\n]+/)[0]!.trim();
    checks.push({
      key: `outside-area:${city}`,
      questionId: null,
      note: `Home is in ${city}, outside the usual service area (${served}). The team should confirm whether they can take it up.`,
      line: `Their home is in ${city}, which is outside where the team usually works (${served}). Do not promise anything: say the team will confirm whether they can take up a project there, keep collecting the details, and do not turn them away.`,
    });
  }
  return checks;
}

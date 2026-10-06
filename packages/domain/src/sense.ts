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

/** Lowest believable budget for full-home premium interiors, by BHK. Anything below is respected but checked. */
const FULL_HOME_FLOOR: Record<number, number> = { 1: 300_000, 2: 400_000, 3: 500_000, 4: 700_000, 5: 1_000_000 };
/** Usual carpet area by BHK; far outside means a typo or a mixed-up answer. */
const CARPET_RANGE: Record<number, [number, number]> = { 1: [250, 1000], 2: [450, 1700], 3: [750, 3000], 4: [1100, 5500], 5: [1600, 9000] };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
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
  return found;
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
  const match = text.match(/(\d)\s*-?\s*(?:bhk|bed\s*rooms?|br)\b/i);
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
  const monthIndex = MONTHS.findIndex((month) => new RegExp(`\\b${month}[a-z]*\\b`, "i").test(text));
  const thisYear = now.getFullYear();
  if (/\b(ready|done|completed|received|got|handed|already|moved)\b/i.test(text)) return null;
  if (year < thisYear) return `${monthIndex >= 0 ? `${MONTHS[monthIndex]!.toUpperCase()} ` : ""}${year}`;
  if (year === thisYear && monthIndex >= 0 && monthIndex < now.getMonth()) return `${MONTHS[monthIndex]!.toUpperCase()} ${year}`;
  return null;
}

/** How many months ahead a date like "March 2028", "end of 2027" or "after 2 years" is. */
function monthsAway(text: string, now: Date): number | null {
  const years = text.match(/\b(?:after|in)\s+(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/i);
  if (years) return Math.round(Number(years[1]) * 12);
  const year = Number(text.match(/\b(20\d{2})\b/)?.[1] ?? NaN);
  if (!Number.isFinite(year)) return null;
  const named = MONTHS.findIndex((month) => new RegExp(`\\b${month}[a-z]*\\b`, "i").test(text));
  const month = named >= 0 ? named : /\bend\b/i.test(text) ? 11 : /\b(start|early|beginning)\b/i.test(text) ? 0 : 6;
  return (year - now.getFullYear()) * 12 + month - now.getMonth();
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
      line: `They said "${text}" for the full home, which is far below what any full home costs. They may mean lakhs, or a budget per room. Check lightly what they meant, without making them feel bad.`,
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

function otherCity(text: string, serviceArea: string[]): string | null {
  const lower = ` ${text.toLowerCase().replace(/[^a-z ]+/g, " ")} `;
  if (serviceArea.some((place) => place && lower.includes(` ${place} `))) return null;
  return CITIES.find((city) => lower.includes(` ${city} `)) ?? null;
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
  const fullHome = /\b(full|whole|entire|complete|all rooms|end to end)\b/i.test(scope);
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
      line: `Their budget of ${rupeeWords(budget)} is on the low side for premium interiors for a ${what}. Respect it fully: never say it is too low, never mock it, never turn them away and never suggest a cheaper package. Say in one line that the team will look at what is possible in that range, perhaps by doing it in stages or starting with the key rooms, then continue.`,
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

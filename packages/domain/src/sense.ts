import { rupeesIn } from "./style";

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
  const scope = answerFor(questions, answers, SCOPE);
  const fullHome = /\b(full|whole|entire|complete|all rooms|end to end)\b/i.test(scope);
  const floor = villa ? 1_000_000 : bhk ? FULL_HOME_FLOOR[Math.min(bhk, 5)] : undefined;
  if (budget && budget >= 10_000 && fullHome && floor && budget < floor) {
    const what = villa ? "full villa" : `full ${bhk} BHK`;
    checks.push({
      key: `budget-scope:${budget}:${what}`,
      questionId: null,
      note: `Budget of ${rupeeWords(budget)} looks low for a ${what} with premium interiors. Worth a review before the call.`,
      line: `Their budget of ${rupeeWords(budget)} is on the low side for premium interiors for a ${what}. Respect it fully: never say it is too low, never mock it, never turn them away and never suggest a cheaper package. Say in one line that the team will look at what is possible in that range, perhaps by doing it in stages or starting with the key rooms, then continue.`,
    });
  }

  const sizeText = answerFor(questions, answers, SIZE);
  const feet = Number(sizeText.replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0] ?? NaN);
  const range = bhk && !villa ? CARPET_RANGE[Math.min(bhk, 5)] : undefined;
  if (Number.isFinite(feet) && feet >= 100 && range && (feet < range[0] || feet > range[1])) {
    checks.push({
      key: `area-bhk:${feet}:${bhk}`,
      questionId: questionFor(questions, SIZE)?.id ?? null,
      note: `${feet.toLocaleString("en-IN")} sq ft for a ${bhk} BHK is unusual. Confirm on the call.`,
      line: `They said ${feet.toLocaleString("en-IN")} sq ft for a ${bhk} BHK, which is unusual (a ${bhk} BHK is usually about ${range[0]} to ${range[1]} sq ft carpet). Check once, lightly, whether that is carpet or built-up area or a typo. Do not insist, accept what they say.`,
    });
  }

  for (const question of questions.filter((item) => WHEN.test(item.label))) {
    const text = String(answers[question.id] ?? "");
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

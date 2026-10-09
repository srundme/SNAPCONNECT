import { openDays, openHours } from "@snapsocial/domain";
import { istDay } from "./ist";

/** Middle value of a list of durations; null when there is none. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** "12.5 hrs" or "45 min" for an estimate in minutes. */
export function hoursLabel(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  return `${hours < 10 ? hours.toFixed(1).replace(/\.0$/, "") : Math.round(hours).toLocaleString("en-IN")} hrs`;
}

const WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Whether a moment falls outside the office hours written like "Tuesday to Sunday, 10 AM to 7 PM".
 * Returns null when the hours cannot be read, so the page can say so instead of guessing.
 */
export function officeClock(workingHours: string): ((at: Date) => boolean) | null {
  const hours = openHours(workingHours);
  const days = openDays(workingHours);
  if (!hours || !days) return null;
  return (at: Date) => {
    const india = new Date(at.getTime() + 330 * 60_000);
    if (!days.has(WEEK[india.getUTCDay()]!)) return true;
    const minutes = india.getUTCHours() * 60 + india.getUTCMinutes();
    return minutes < hours.open || minutes >= hours.close;
  };
}

/** A customer asking about money. "How much time" is about the schedule, not the price. */
const PRICE_WORDS = /\b(price|prices|pricing|cost|costs|costing|how much|budget|rate|rates|quote|quotation|ballpark|approx|kitna|evlo)\b/i;
export function asksPrice(text: string): boolean {
  return PRICE_WORDS.test(text.replace(/how much time/gi, ""));
}

export const HOME_BUCKETS = ["3 BHK", "4 BHK", "5+ BHK", "Villa / independent house", "Under 3 BHK", "Other answer", "Not given"] as const;
export type HomeBucket = (typeof HOME_BUCKETS)[number];

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

/** Home size from an answer like "3 BHK Apartment", "4bhk villa", "Villa" or "studio". Villas and independent houses form their own group. */
export function homeBucket(text: string | null): HomeBucket {
  const value = text?.trim().toLowerCase() ?? "";
  if (!value) return "Not given";
  if (/\b(villa|independent|bungalow|row ?house|duplex|standalone)\b/.test(value)) return "Villa / independent house";
  const digits = value.match(/(\d+(?:\.\d)?)\s*-?\s*(?:bhk|bed ?rooms?|br|bed)\b/);
  const words = value.match(/\b(one|two|three|four|five|six|seven|eight)\s*-?\s*(?:bhk|bed ?rooms?)\b/);
  const count = digits ? Number(digits[1]) : words ? NUMBER_WORDS[words[1]!]! : /\b(studio|1 ?rk)\b/.test(value) ? 1 : null;
  if (count === null) return "Other answer";
  if (count >= 5) return "5+ BHK";
  if (count >= 4) return "4 BHK";
  if (count >= 3) return "3 BHK";
  return "Under 3 BHK";
}

/** One key per project or area: "Adarsh Palm Retreat, Bellandur, Bengaluru" and "adarsh palm retreat, bellandur" match. */
export function areaKey(text: string | null): string | null {
  let value = text?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  for (let pass = 0; pass < 3; pass += 1) {
    value = value.replace(/[\s,.-]*\b(bengaluru|bangalore|blr|karnataka|india)\b[\s,.]*$/i, "").replace(/[\s,.-]+$/, "");
  }
  return value.length >= 2 ? value : null;
}

export function titleCase(key: string): string {
  return key.replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

export const POSSESSION_BUCKETS = ["Ready now", "Within 6 months", "Later", "Unclear", "Not given"] as const;
export type PossessionBucket = (typeof POSSESSION_BUCKETS)[number];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAME = /\b(?:(jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)(?:uary|ruary|ch|il|e|y|ust|t|tember|ober|ember)?|(may)(?=\s*[-'’/ ]?\s*\d))\.?\s*[-'’/ ]?\s*(\d{4}|\d{2})?\b/;
const HAS_KEYS = /\b(with me|got (?:the )?keys?|have (?:the )?keys?|keys? (?:received|in hand)|possession (?:is |was )?(?:done|taken|received|over|completed)|handed over|moved in|living there|occupied)\b/i;
const READY = /\b(ready|already|completed|done)\b/i;
const SOON = /\b(this year|next month|this month|soon|few months|couple of months|coming months|in a month|within a month|immediately|asap|right away)\b/i;
const LATER = /\b(next year|under construction|construction|not yet|later|years?|long time)\b/i;

/**
 * When they will have the home, read from free text like "Ready", "it's with me", "Dec 2026" or "next year".
 * Months are counted from this India month. Text that cannot be read is "Unclear", never guessed.
 */
export function possessionBucket(text: string | null, now: Date): PossessionBucket {
  const value = text?.trim().toLowerCase() ?? "";
  if (!value) return "Not given";
  if (HAS_KEYS.test(value)) return "Ready now";
  const dated = monthsAway(value, now);
  if (dated) return dated;
  if (/\bunder construction\b|\bnot (?:yet )?ready\b|\bnext year\b/.test(value)) return "Later";
  if (READY.test(value)) return "Ready now";
  if (SOON.test(value)) return "Within 6 months";
  if (LATER.test(value)) return "Later";
  return "Unclear";
}

function monthsAway(value: string, now: Date): PossessionBucket | null {
  const [year, month] = istDay(now).split("-").map(Number) as [number, number];
  const current = year * 12 + (month - 1);
  const inMonths = value.match(/\b(\d{1,2})\s*(?:-|to)?\s*(\d{1,2})?\s*months?\b/);
  if (inMonths) return Number(inMonths[2] ?? inMonths[1]) <= 6 ? "Within 6 months" : "Later";
  const named = value.match(MONTH_NAME);
  const yearOnly = value.match(/\b(20\d{2})\b/);
  if (named) {
    const index = MONTHS.indexOf(named[1] ?? named[2]!);
    const givenYear = named[3] ? (named[3].length === 2 ? 2000 + Number(named[3]) : Number(named[3])) : yearOnly ? Number(yearOnly[1]) : null;
    const target = givenYear !== null ? givenYear * 12 + index : year * 12 + index + (index < month - 1 ? 12 : 0);
    const away = target - current;
    if (away < 0) return "Ready now";
    return away <= 6 ? "Within 6 months" : "Later";
  }
  if (yearOnly) {
    const givenYear = Number(yearOnly[1]);
    if (givenYear < year) return "Ready now";
    return givenYear === year ? "Within 6 months" : "Later";
  }
  return null;
}

/** A short name for a lead question, as the team would say it on a chart. */
export function shortQuestion(question: { label: string; kind: string }): string {
  if (question.kind === "name") return "Name";
  if (question.kind === "phone") return "Phone number";
  if (/\bbhk\b/i.test(question.label)) return "Home";
  if (/where is the home|\b(project|locality|location|area)\b/i.test(question.label)) return "Project / area";
  if (/possession/i.test(question.label)) return "Possession";
  if (/\bemail\b/i.test(question.label)) return "Email";
  if (/budget/i.test(question.label)) return "Budget";
  const label = question.label.replace(/\?$/, "").trim();
  return label.length > 28 ? `${label.slice(0, 27)}…` : label;
}

import type { LeadQuestion } from "./qualify";

export type LeadRating = "HOT" | "JUNK" | "UNRATED";

const LAKH = 100_000;

/** A budget in lakhs, read like a person would: "30L", "30-50 lakhs", "50L+", "under 20L", "1.2 cr", "35,00,000". */
export function budgetLakhs(text: string): { low: number; high: number | null } | null {
  const plain = text.toLowerCase().replace(/[–—]/g, "-").replace(/(\d),(?=\d)/g, "$1");
  const unit = (word: string | undefined, value: number): number => {
    if (word && /^(cr|crore|crores)$/.test(word)) return value * 100;
    if (word && /^(k|thousand)$/.test(word)) return value / 100;
    if (!word && value >= LAKH) return value / LAKH;
    return value;
  };
  const range = plain.match(/(\d+(?:\.\d+)?)\s*(l|lac|lacs|lakh|lakhs|cr|crore|crores|k|thousand)?\s*(?:-|to|till|se|muthal)\s*(\d+(?:\.\d+)?)\s*(l|lac|lacs|lakh|lakhs|cr|crore|crores|k|thousand)?\b/);
  if (range) {
    const highUnit = range[4] ?? range[2];
    const high = unit(highUnit, Number(range[3]));
    const low = unit(range[2] ?? highUnit, Number(range[1]));
    if (low <= high) return { low, high };
  }
  const single = plain.match(/(\d+(?:\.\d+)?)\s*(l|lac|lacs|lakh|lakhs|cr|crore|crores|k|thousand)?\b\s*(\+|plus|and above|or more|above)?/);
  if (!single) return null;
  const value = unit(single[2], Number(single[1]));
  if (!single[2] && value < 1) return null;
  if (/\b(under|below|less than|within|max(?:imum)?|upto|up to)\b/.test(plain)) return { low: 0, high: value };
  if (single[3] || /\b(above|more than|over|minimum|at least)\b/.test(plain)) return { low: value, high: null };
  return { low: value, high: value };
}

const FULL_SCOPE = /\b(full|fully|whole|entire|complete|pura|poora|puraa|pooraa|saara|sara|pure|poore|muzhu|muzhusa|fullaa?|all rooms|everything|sab kuch)\b/i;

/** "Only the kitchen", "2 bedrooms and wardrobes", "selected rooms": a part of the home, not the full project. */
export function selectedRoomsOnly(scope: string): boolean {
  return !FULL_SCOPE.test(scope) && /\b(selected|some|few|only|just|one|single|kitchen|wardrobes?|bed ?rooms?|living|bathrooms?|rooms?|sirf|kuch|bas|mattum)\b/i.test(scope);
}

const BIG_HOME = /\b(villa|independent house|individual house|bungalow|row house|duplex|penthouse|triplex)\b/i;

function answerFor(questions: LeadQuestion[], answers: Record<string, string>, pattern: RegExp): string {
  const question = questions.find((item) => pattern.test(item.label));
  return question ? answers[question.id] ?? "" : "";
}

/**
 * HOT is a project at or above the workspace's budget line; everything else is JUNK but still served.
 * Without a budget, the size of the project decides: a full big home is usually above the line.
 */
export function rateLead(input: { questions: LeadQuestion[]; answers: Record<string, string>; hotBudgetLakhs: number }): { rating: LeadRating; reason: string } {
  const line = input.hotBudgetLakhs;
  if (!line) return { rating: "UNRATED", reason: "No budget line set" };
  const budgetText = answerFor(input.questions, input.answers, /budget/i);
  const budget = budgetText ? budgetLakhs(budgetText) : null;
  const scopeText = answerFor(input.questions, input.answers, /full home|selected rooms|scope/i);
  if (selectedRoomsOnly(scopeText)) return { rating: "JUNK", reason: `Only some rooms (${scopeText.trim()}), not a full home` };
  if (budget) {
    return budget.low >= line
      ? { rating: "HOT", reason: `Budget ${budgetText.trim()} (${line}L+ line)` }
      : { rating: "JUNK", reason: `Budget ${budgetText.trim()} is under ${line}L` };
  }
  const home = answerFor(input.questions, input.answers, /bhk|kind of home|home type|property/i);
  const scope = answerFor(input.questions, input.answers, /full home|selected rooms|scope/i);
  const area = answerFor(input.questions, input.answers, /carpet|sq\.? ?ft|area in/i);
  const bhk = Number(home.match(/(\d+)\s*-?\s*bhk/i)?.[1] ?? 0);
  const sqft = Number(area.replace(/(\d),(\d)/g, "$1$2").match(/\d{3,5}/)?.[0] ?? 0);
  const full = FULL_SCOPE.test(scope);
  const estimate = `Estimated from project size (no budget ${budgetText ? "given" : "yet"})`;
  if (full && (BIG_HOME.test(home) || bhk >= 3 || sqft >= 1500)) return { rating: "HOT", reason: `${estimate}: full home, ${home.trim() || `${sqft} sq ft`}` };
  if (bhk && bhk <= 2) return { rating: "JUNK", reason: `${estimate}: ${bhk} BHK` };
  if (full && sqft && sqft < 1500) return { rating: "JUNK", reason: `${estimate}: ${sqft} sq ft` };
  return { rating: "UNRATED", reason: "Not enough detail yet" };
}

/** Flat, bungalow, individual house: the words people use, in the type the team works with. */
export function homeTypeName(text: string): string | null {
  const said = text.toLowerCase();
  if (/\b(flat|apartment|apt|appartment|appartement|society flat|gated community flat)\b/.test(said)) return "Apartment";
  if (/\b(villa|bungalow|bunglow)\b/.test(said)) return "Villa";
  if (/\b(independent|individual|standalone) (house|home|building)\b|\bthani veedu\b/.test(said)) return "Independent house";
  if (/\brow ?house\b/.test(said)) return "Row house";
  if (/\bduplex\b/.test(said)) return "Duplex";
  if (/\bpenthouse\b/.test(said)) return "Penthouse";
  return null;
}

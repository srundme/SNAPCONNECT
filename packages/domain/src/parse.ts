import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { BudgetParse, PhoneParse, ProjectType, WorkType } from "./types";

const DECLINED = /\b(not sure|don't know|do not know|prefer not|rather not|won't share|will not share|skip|no budget|don't want to share|do not want to share)\b/i;

function parseAmountToken(token: string): number | null {
  const cleaned = token.replace(/[, ]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function parseBudget(text: string | null | undefined): BudgetParse {
  const raw = (text ?? "").trim();
  if (!raw) return { kind: "absent" };
  if (DECLINED.test(raw) && !/\d/.test(raw)) return { kind: "declined", raw };

  const range = raw.match(
    /(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr|k|thousand)?/i,
  );
  if (range?.[1] && range[2]) {
    const unit = (range[3] ?? "").toLowerCase();
    const left = parseAmountToken(range[1]);
    const right = parseAmountToken(range[2]);
    if (left === null || right === null) return { kind: "ambiguous", raw };
    const factor = unitFactor(unit);
    if (!unit) return { kind: "ambiguous", raw };
    const currency = /\$|usd/i.test(raw) ? "USD" : "INR";
    return {
      kind: "range",
      currency,
      minMinor: Math.round(Math.min(left, right) * factor),
      maxMinor: Math.round(Math.max(left, right) * factor),
      raw,
    };
  }

  const single = raw.match(
    /(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr|k|thousand)?/i,
  );
  if (!single?.[1]) {
    if (DECLINED.test(raw)) return { kind: "declined", raw };
    return { kind: "ambiguous", raw };
  }
  const amount = parseAmountToken(single[1]);
  const unit = (single[2] ?? "").toLowerCase();
  if (amount === null) return { kind: "ambiguous", raw };
  const factor = unitFactor(unit);
  const currency = /\$|usd/i.test(raw) ? "USD" : unit || /₹|rs|inr|lakh|crore/i.test(raw) ? "INR" : "";
  if (!unit && !/₹|rs\.?|inr|\$|usd/i.test(raw)) return { kind: "ambiguous", raw };
  if (!currency) return { kind: "ambiguous", raw };
  return { kind: "amount", currency, amountMinor: Math.round(amount * factor), raw };
}

function unitFactor(unit: string): number {
  if (/^lakhs?$|^lacs?$/.test(unit)) return 100_000;
  if (/^crores?$|^cr$/.test(unit)) return 10_000_000;
  if (unit === "k" || unit === "thousand") return 1_000;
  return 1;
}

export function parsePhone(text: string | null | undefined, defaultRegion = "IN"): PhoneParse {
  const raw = (text ?? "").trim();
  if (!raw) return { kind: "absent" };
  if (DECLINED.test(raw) && !/\d{5,}/.test(raw)) return { kind: "declined", raw };
  const [primary = "IN", ...alsoFrom] = defaultRegion.split(",").map((region) => region.trim()).filter(Boolean);
  const cleaned = raw.replace(/^\s*00(?=[1-9])/, "+").replace(/^\s*0(?=91[\s-]*[6-9](?:[\s-]*\d){9}\s*$)/, "+");
  for (const region of [primary, ...alsoFrom]) {
    const e164 = realNumber(cleaned, region);
    if (e164) return { kind: "valid", e164, raw };
  }
  return { kind: "invalid", raw };
}

/**
 * A valid, non-patterned number read with this region as the default. A second region is only
 * tried when the person is known to be there, so a mistyped Indian number never passes as foreign.
 */
function realNumber(text: string, region: string): string | null {
  const parsed = parsePhoneNumberFromString(text, region as "IN");
  if (!parsed || !parsed.isValid()) return null;
  const national = String(parsed.nationalNumber);
  if (parsed.country === "IN" ? !realIndianMobile(national) : patternedNumber(national)) return null;
  return parsed.number;
}

/** Digits someone types to get past a form, in any country: one digit over and over, a short repeat, or a run like 12345678. */
function patternedNumber(national: string): boolean {
  if (/(\d)\1{6,}/.test(national) || /^(\d{1,2})\1+$/.test(national)) return true;
  for (let start = 0; start + 8 <= national.length; start += 1) {
    const run = national.slice(start, start + 8);
    if (ASCENDING.includes(run) || DESCENDING.includes(run)) return true;
  }
  return false;
}

const ASCENDING = "01234567890123456789";
const DESCENDING = "98765432109876543210";

export function realIndianMobile(national: string): boolean {
  if (!/^[6-9]\d{9}$/.test(national)) return false;
  if (/(\d)\1{6,}/.test(national)) return false;
  if (/^(\d{1,2})\1+$/.test(national)) return false;
  for (let start = 0; start + 8 <= national.length; start += 1) {
    const run = national.slice(start, start + 8);
    if (ASCENDING.includes(run) || DESCENDING.includes(run)) return false;
  }
  return true;
}

function digitRuns(text: string, minDigits: number): string[] {
  return (text.match(/\+?\d[\d\s().-]{4,}\d/g) ?? [])
    .map((run) => run.trim())
    .filter((run) => run.replace(/\D/g, "").length >= minDigits);
}

export function swapNumber(text: string, oldE164: string, newE164: string): string {
  const local = oldE164.replace(/\D/g, "").slice(-10);
  if (local.length < 8) return text;
  const pattern = new RegExp(`(?:\\+?\\d{1,3}[\\s-]?)?${local.split("").join("[\\s-]?")}(?!\\d)`, "g");
  return text.replace(pattern, newE164);
}

export function wrongPhoneIn(text: string, defaultRegion = "IN", minDigits = 6): string | null {
  const runs = digitRuns(text, minDigits);
  if (!runs.length) return null;
  if (runs.some((run) => parsePhone(run, defaultRegion).kind === "valid")) return null;
  const first = runs[0]!;
  return `${/^\+|^00/.test(first) ? "+" : ""}${first.replace(/\D/g, "").replace(/^00/, "")}`;
}

export function validPhonesIn(text: string, defaultRegion = "IN"): string[] {
  return digitRuns(text, 6).flatMap((run) => {
    const parsed = parsePhone(run, defaultRegion);
    return parsed.kind === "valid" ? [parsed.e164] : [];
  });
}

export function mentionsPermission(text: string, channel: "phone" | "whatsapp"): boolean {
  const value = text.toLowerCase();
  if (!/\b(yes|ok|okay|sure|please|you can|contact me|call me|message me|follow up|reach me)\b/i.test(value)) {
    return false;
  }
  if (channel === "whatsapp") return /whats\s?app/.test(value) || /same number/.test(value);
  return /call|phone|contact|follow up|reach me/.test(value);
}

export function confirmsSameNumber(text: string): boolean {
  return /\b(same number|whatsapp (is |uses )?the same|same for whatsapp|yes,? same)\b/i.test(text);
}

export function projectTypeFromText(text: string): ProjectType | null {
  if (/\b(creator|influencer|personal|individual)\b/i.test(text)) return "other";
  if (/\b(home|house|residential|apartment|flat|villa|bhk)\b/i.test(text)) return "residential";
  if (/\b(commercial|office|shop|retail|showroom|business|agency|brand|company|studio|clinic|restaurant|store|hotel)\b/i.test(text)) return "commercial";
  return null;
}

export function workTypeFromText(text: string): WorkType | null {
  if (/\brenovat/i.test(text)) return "renovation";
  if (/\bnew (work|home|build|construction)\b/i.test(text)) return "new";
  return null;
}

export function evidenceInMessage(evidence: string, message: string): boolean {
  const needle = evidence.trim().toLowerCase();
  if (needle.length < 2) return false;
  return message.toLowerCase().includes(needle);
}

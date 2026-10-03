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
  const parsed = parsePhoneNumberFromString(raw, defaultRegion as "IN");
  if (!parsed || !parsed.isValid()) return { kind: "invalid", raw };
  return { kind: "valid", e164: parsed.number, raw };
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
  if (/\b(commercial|office|shop|retail|showroom)\b/i.test(text)) return "commercial";
  if (/\b(home|house|residential|apartment|flat|villa|bhk)\b/i.test(text)) return "residential";
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

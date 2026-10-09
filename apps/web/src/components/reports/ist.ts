import { zonedDay } from "@snapsocial/domain";
import { isOldTest } from "@/lib/format";

/** All report and dashboard days are India days, whatever timezone the server runs in. */
export const IST_ZONE = "Asia/Kolkata";
const DAY_MS = 86_400_000;

/** "2026-10-09" for the India calendar day of `date`. */
export function istDay(date: Date): string {
  return zonedDay(date, IST_ZONE);
}

/** Midnight India time for a "YYYY-MM-DD" India day. India has no daylight saving, so +05:30 is exact. */
export function istMidnight(day: string): Date {
  return new Date(`${day}T00:00:00+05:30`);
}

/** Start of the India day `daysBack` days before today (0 = today). */
export function istDayStart(now: Date, daysBack = 0): Date {
  return new Date(istMidnight(istDay(now)).getTime() - daysBack * DAY_MS);
}

/** The last `count` India days, oldest first, ending today. */
export function istDays(now: Date, count: number): string[] {
  const today = istMidnight(istDay(now)).getTime();
  return Array.from({ length: count }, (_, index) => istDay(new Date(today - (count - 1 - index) * DAY_MS + 12 * 3_600_000)));
}

/** "9 Oct" or "9 Oct 2026" for an India day. */
export function istDateLabel(day: string, withYear = false): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST_ZONE, day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }).format(istMidnight(day));
}

export type ContactNames = { username: string | null; displayName: string | null; chosenName: string | null };

/** Contacts archived by chat resets carry "(old test n)" on one of their names. */
export function isTestContact(contact: ContactNames | null | undefined): boolean {
  if (!contact) return false;
  return isOldTest(contact.username) || isOldTest(contact.displayName) || isOldTest(contact.chosenName);
}

export function contactName(contact: ContactNames | null | undefined): string {
  return contact?.chosenName?.trim() || contact?.displayName?.trim() || contact?.username?.trim() || "Unnamed contact";
}

/** Whole-number share of `whole`, capped at 100% and shown as "–" when there is nothing to divide by. */
export function percentOf(part: number, whole: number): string {
  if (!whole) return "–";
  return `${Math.min(100, Math.round((part / whole) * 100))}%`;
}

export function duration(ms: number | null): string {
  if (ms === null) return "–";
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)} min`;
}

export const OFFER_ACCEPTED = /^Offer answer: (?:consultation|experience)\b/;

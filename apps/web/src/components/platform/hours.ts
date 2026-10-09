import { openDays, openHours, parseAgentSettings } from "@snapsocial/domain";

const ZONE = "Asia/Kolkata";
const FALLBACK_DAYS = new Set(["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
const FALLBACK_HOURS = { open: 10 * 60, close: 19 * 60 };

export type OfficeHours = { days: Set<string>; open: number; close: number };

/** A workspace's working hours from its assistant settings, or 10 AM–7 PM with Mondays off when they cannot be read. */
export function officeHours(agentSettings: unknown): OfficeHours {
  const text = parseAgentSettings(agentSettings).workingHours;
  const hours = openHours(text) ?? FALLBACK_HOURS;
  const days = openDays(text) ?? FALLBACK_DAYS;
  return { days, open: hours.open, close: hours.close };
}

const weekday = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "long" });

/** True when `at` falls outside the office's open days or hours, read in India time. */
export function outsideHours(at: Date, office: OfficeHours): boolean {
  if (!office.days.has(weekday.format(at))) return true;
  const india = new Date(at.getTime() + 330 * 60_000);
  const minutes = india.getUTCHours() * 60 + india.getUTCMinutes();
  return minutes < office.open || minutes >= office.close;
}

/** Every time in the console is shown in India time, the way the team reads it. */
const ZONE = "Asia/Kolkata";

function parts(date: Date) {
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return day;
}

/** "10:42 AM" today, "Yesterday, 6:05 PM", "8 Oct, 11:20 AM", or "8 Oct 2025" in another year. */
export function whenIST(value: Date | string | null | undefined, now = new Date()): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: ZONE, hour: "numeric", minute: "2-digit", hour12: true }).format(date).toUpperCase();
  const today = parts(now);
  const yesterday = parts(new Date(now.getTime() - 86_400_000));
  const that = parts(date);
  if (that === today) return time;
  if (that === yesterday) return `Yesterday, ${time}`;
  const sameYear = new Intl.DateTimeFormat("en-IN", { timeZone: ZONE, year: "numeric" }).format(date)
    === new Intl.DateTimeFormat("en-IN", { timeZone: ZONE, year: "numeric" }).format(now);
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: ZONE, day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(date);
  return sameYear ? `${day}, ${time}` : day;
}

/** "9 Oct 2026, 10:42 AM" for detail pages. */
export function fullIST(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: ZONE, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(date).replace(/\b(am|pm)\b/, (m) => m.toUpperCase());
}

/** "5 min ago", "2 hr ago", or the IST time for anything older than a day. */
export function agoIST(value: Date | string | null | undefined, now = new Date()): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} hr ago`;
  return whenIST(date, now);
}

/** Test and archived contacts from chat resets: hidden from the team by default. */
export function isOldTest(name: string | null | undefined): boolean {
  return /\(old test/i.test(name ?? "");
}

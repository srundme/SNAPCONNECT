
export type Situation = {
  /** Stable per situation, so the staff note is written once per chat. */
  key: string;
  /** Shown to staff in the chat. */
  note: string;
  /** Told to the agent for this reply. */
  line: string;
  /** When set, staff take the chat after this reply. */
  handoff?: string;
  /** Applies every time it comes up, not only the first time. */
  always?: boolean;
};

/** "Just looking" or "call me later" pauses the script. A date such as "after Diwali" does not. */
export function notNow(text: string): boolean {
  const plain = text.replace(/^\(Replied to:[\s\S]*?\)\s*/, "");
  // "Give me a number, then I will decide" is pushing for an answer, not putting it off.
  if (/\b(give|tell|share|send|number|estimate|ballpark|figure|quote|price|cost|timeline|how much|how long)\b/i.test(plain)) return false;
  return /\b(?:just (?:looking|browsing|checking|enquiring|inquiring|asking)|only looking|not now|not right now|maybe later|not urgent|not serious|i(?:'ll| will) (?:think|decide|see)|call me later|call me after|call me next year)\b/i.test(plain);
}

/** "Today 10 am" when it is already past 10 in India: the model does not reliably compare times itself. */
function passedToday(text: string, now: Date): { said: string; time: string; clock: string } | null {
  const said = text.match(/\btoday\b[^.?!\n]*?\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i)
    ?? text.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b[^.?!\n]*?\btoday\b/i);
  if (!said) return null;
  const hour = (Number(said[1]) % 12) + (said[3]!.toLowerCase() === "pm" ? 12 : 0);
  const minute = Number(said[2] ?? 0);
  const india = new Date(now.getTime() + 330 * 60_000);
  const current = india.getUTCHours() * 60 + india.getUTCMinutes();
  if (hour * 60 + minute > current) return null;
  const clock = `${india.getUTCHours() % 12 || 12}:${String(india.getUTCMinutes()).padStart(2, "0")} ${india.getUTCHours() >= 12 ? "PM" : "AM"}`;
  const time = `${said[1]}${said[2] ? `:${said[2]}` : ""} ${said[3]!.toUpperCase()}`;
  return { said: said[0], time, clock };
}

export function pastTimeToday(text: string, now: Date): string | null {
  const passed = passedToday(text, now);
  if (!passed) return null;
  return `They asked for ${passed.said}, but it is already ${passed.clock} now, so that time has passed. Say so kindly in a few words and ask for a later time today or another day.`;
}

// "how much time" and "minimum how many days" are about time, not price.
const PRICE = /\b(how much(?!\s+(?:time|days?|weeks?|months?|years?|long|duration))|price|pricing|cost|rate|approx\w*|ballpark|rough(ly)? (cost|idea|estimate)|estimate|quote|starting (price|from)|per sq ?ft|minimum (?:price|cost|budget|amount|charge)|budget (range|kitna|evlo)|evlo aagum|kitna (lagega|hoga))\b/i;

/** A direct price question, not a decision to go ahead. */
export function askingPrice(text: string): boolean {
  return PRICE.test(text.replace(/^\(Replied to:[\s\S]*?\)\s*/, ""));
}

const NATIONAL_HOLIDAYS = ["01-26 Republic Day", "08-15 Independence Day", "10-02 Gandhi Jayanti", "12-25 Christmas"];

function istDate(now: Date, addDays = 0): { iso: string; weekday: string } {
  const shifted = new Date(now.getTime() + addDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" }).formatToParts(shifted);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return { iso: `${part("year")}-${part("month")}-${part("day")}`, weekday: part("weekday") };
}

/** Today's festival or holiday in India, from the built-in list and the team's own holidays. */
export function festivalToday(now: Date, holidays = ""): string | null {
  return holidayOn(istDate(now).iso, holidays);
}

function holidayOn(iso: string, holidays: string): string | null {
  const lines = [...NATIONAL_HOLIDAYS, ...holidays.split(/\n+/)].map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^(\d{4}-)?(\d{2}-\d{2})\s+(.+)$/);
    if (!match) continue;
    if (match[1] ? `${match[1]}${match[2]}` === iso : iso.endsWith(match[2]!)) return match[3]!.trim();
  }
  return null;
}

const WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Open days read from working hours like "Tuesday to Sunday, 10 AM to 7 PM"; null when it does not say. */
export function openDays(workingHours: string): Set<string> | null {
  if (/all days|every ?day|7 days|daily|all week/i.test(workingHours)) return new Set(WEEK);
  const range = workingHours.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?\s*(?:to|-|–|till|until|through)\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*/i);
  if (!range) return null;
  const from = WEEK.findIndex((day) => day.toLowerCase().startsWith(range[1]!.toLowerCase()));
  const to = WEEK.findIndex((day) => day.toLowerCase().startsWith(range[2]!.toLowerCase()));
  const days = new Set<string>();
  for (let step = 0; step < 7; step += 1) {
    const day = (from + step) % 7;
    days.add(WEEK[day]!);
    if (day === to) break;
  }
  return days;
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

function clockLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour >= 12 ? "PM" : "AM"}`;
}

export type OfficeNow = {
  kind: "open" | "passed" | "before" | "off" | "unknown";
  /** "tomorrow", "Tuesday", or "later today". */
  next: string;
  openLabel: string;
  closeLabel: string;
};

function nextOpenLabel(now: Date, days: Set<string>, start: number, holidays = ""): string {
  for (let add = start; add < 8; add += 1) {
    const day = istDate(now, add);
    if (!days.has(day.weekday) || holidayOn(day.iso, holidays)) continue;
    return add === 1 ? "tomorrow" : day.weekday;
  }
  return "the next working day";
}

export function officeNow(now: Date, workingHours: string, holidays = ""): OfficeNow {
  const hours = openHours(workingHours);
  const days = openDays(workingHours);
  if (!hours || !days) return { kind: "unknown", next: "", openLabel: "", closeLabel: "" };
  const india = new Date(now.getTime() + 330 * 60_000);
  const nowMinutes = india.getUTCHours() * 60 + india.getUTCMinutes();
  const today = istDate(now);
  const openLabel = clockLabel(hours.open);
  const closeLabel = clockLabel(hours.close);
  if (!days.has(today.weekday)) return { kind: "off", next: nextOpenLabel(now, days, 1, holidays), openLabel, closeLabel };
  if (nowMinutes < hours.open) return { kind: "before", next: "later today", openLabel, closeLabel };
  if (nowMinutes >= hours.close) return { kind: "passed", next: nextOpenLabel(now, days, 1, holidays), openLabel, closeLabel };
  return { kind: "open", next: "", openLabel, closeLabel };
}

/** Fed on every turn so a reply can say "open until 7" or "hours have passed, tomorrow" instead of a vague "working hours". */
/** Whether the office is open now, as facts only: what to say is the system prompt's job. */
export function officeFacts(now: Date, workingHours: string, holidays = ""): string {
  if (holidayOn(istDate(now).iso, holidays)) return "Today is a holiday: the team is off";
  const status = officeNow(now, workingHours, holidays);
  if (status.kind === "unknown") return "";
  if (status.kind === "open") return `The office is open now, until ${status.closeLabel}`;
  if (status.kind === "before") return `The office is closed now and opens at ${status.openLabel} today`;
  if (status.kind === "off") return `Today is the weekly off. The office opens ${status.next === "tomorrow" ? "tomorrow" : `on ${status.next}`} at ${status.openLabel}`;
  return `The office closed at ${status.closeLabel} and opens ${status.next === "tomorrow" ? "tomorrow" : `on ${status.next}`} at ${status.openLabel}`;
}

/** Opening and closing minutes read from working hours like "Tuesday to Sunday, 10 AM to 7 PM". */
export function openHours(workingHours: string): { open: number; close: number } | null {
  const match = workingHours.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\s*(?:to|-|–|till|until)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)/i);
  if (!match) return null;
  const at = (hour: string, minute: string | undefined, half: string) => ((Number(hour) % 12) + (half.toLowerCase() === "pm" ? 12 : 0)) * 60 + Number(minute ?? 0);
  return { open: at(match[1]!, match[2], match[3]!), close: at(match[4]!, match[5], match[6]!) };
}

type RequestedTime = { clock: string; day: string; inside: boolean; why: string; /** India time, like "2026-10-13T16:00:00+05:30". */ at: string };

/** The time they asked for, worked out in code: the model gets "in next 1 hr" and working-hour checks wrong. */
export function requestedTime(text: string, now: Date, workingHours: string): RequestedTime | null {
  const hours = openHours(workingHours);
  if (!hours) return null;
  const india = new Date(now.getTime() + 330 * 60_000);
  const nowMinutes = india.getUTCHours() * 60 + india.getUTCMinutes();
  let minutes: number;
  let addDays = 0;
  const relative = text.match(/\b(?:in|within|after|next)\s+(?:the\s+)?(?:next\s+)?(\d+|an?|one|two|three|four|five|six|half an?)\s*(hours?|hrs?|minutes?|mins?)\b/i);
  const absolute = text.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i);
  // A 24-hour time like "13:00" or "@ 18.30"; 1:00 to 7:59 without am or pm means the afternoon.
  const clock24 = absolute ? null : text.match(/(?:^|[^\d])([01]?\d|2[0-3])[:.]([0-5]\d)(?![\d.]|\s*(?:am|pm))/i);
  // A date like "16 Oct", "16th October 2026", "Oct 16" or "16/10".
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const named = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*(\d{4}))?/i)
    ?? (() => { const m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i); return m ? [m[0], m[2], m[1], m[3]] as unknown as RegExpMatchArray : null; })();
  const numeric = named ? null : text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  const onDate = named ? { day: Number(named[1]), month: MONTHS.indexOf(String(named[2]).slice(0, 3).toLowerCase()), year: named[3] ? Number(named[3]) : null }
    : numeric ? { day: Number(numeric[1]), month: Number(numeric[2]) - 1, year: numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : null } : null;
  if (relative) {
    const word = relative[1]!.toLowerCase();
    const amount = word.startsWith("half") ? 0.5 : NUMBER_WORDS[word] ?? Number(word);
    const delta = /^h/i.test(relative[2]!) ? amount * 60 : amount;
    const target = nowMinutes + Math.round(delta);
    addDays = Math.floor(target / 1440);
    minutes = target % 1440;
  } else if (absolute || clock24) {
    if (absolute) minutes = ((Number(absolute[1]) % 12) + (absolute[3]!.toLowerCase() === "pm" ? 12 : 0)) * 60 + Number(absolute[2] ?? 0);
    else {
      const hour = Number(clock24![1]);
      minutes = (hour >= 1 && hour <= 7 ? hour + 12 : hour) * 60 + Number(clock24![2]);
    }
    const weekday = text.match(/\b(sun|mon|tue|wed|thu|fri|sat)(?:s|nes|rs|ur)?(?:day)?\b/i);
    if (onDate && onDate.month >= 0 && onDate.day >= 1 && onDate.day <= 31) {
      // An exact date: days from today in India. A date already gone is left to the reply to point out.
      const todayUtc = Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), india.getUTCDate());
      const target = Date.UTC(onDate.year ?? india.getUTCFullYear(), onDate.month, onDate.day);
      addDays = Math.round((target - todayUtc) / 86_400_000);
      if (addDays < 0 || (addDays === 0 && minutes <= nowMinutes)) return null;
    } else if (/\btomorrow\b|\bkal\b|\bnaalai\b|\bnaale\b/i.test(text)) addDays = 1;
    else if (weekday && !/\btoday\b/i.test(text)) {
      // "Saturday 11 am" means the coming Saturday, not today.
      const target = WEEK.findIndex((day) => day.toLowerCase().startsWith(weekday[1]!.toLowerCase()));
      const todayIndex = WEEK.indexOf(istDate(now).weekday);
      addDays = (target - todayIndex + 7) % 7;
      if (addDays === 0 && minutes <= nowMinutes) addDays = 7;
    } else if (minutes <= nowMinutes) return null;
  } else {
    return null;
  }
  const day = istDate(now, addDays).weekday;
  const dayWord = addDays === 0 ? "today" : addDays === 1 ? "tomorrow" : day;
  const open = openDays(workingHours);
  const clock = clockLabel(minutes);
  const date = new Date(india.getTime() + addDays * 86_400_000).toISOString().slice(0, 10);
  const at = `${date}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00+05:30`;
  if (open && !open.has(day)) return { clock, day: dayWord, at, inside: false, why: `${day} is the team's weekly off` };
  if (minutes < hours.open || minutes >= hours.close) return { clock, day: dayWord, at, inside: false, why: `it is outside working hours (${clockLabel(hours.open)} to ${clockLabel(hours.close)})` };
  return { clock, day: dayWord, at, inside: true, why: "" };
}

/** The next open time to offer when they want a consultation but have not named one. */
export function proposeConsultation(now: Date, workingHours: string): string | null {
  const hours = openHours(workingHours);
  const open = openDays(workingHours);
  if (!hours || !open) return null;
  const india = new Date(now.getTime() + 330 * 60_000);
  const nowMinutes = india.getUTCHours() * 60 + india.getUTCMinutes();
  for (let add = 0; add < 8; add += 1) {
    const day = istDate(now, add);
    if (!open.has(day.weekday)) continue;
    if (add === 0) {
      const earliest = Math.max(hours.open, Math.ceil((nowMinutes + 60) / 60) * 60);
      if (earliest + 60 <= hours.close) return `today at ${clockLabel(earliest)}`;
      continue;
    }
    const label = add === 1 ? "tomorrow" : day.weekday;
    return `${label} at ${clockLabel(hours.open)}`;
  }
  return null;
}


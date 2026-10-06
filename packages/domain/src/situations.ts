import { parsePhoneNumberFromString } from "libphonenumber-js";
import { RENOVATING } from "./sense";

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

const FAMILY = "parents|father|mother|dad|daddy|mom|mummy|amma|appa|brother|sister|son|daughter|uncle|aunt|aunty|in[- ]?laws?|father[- ]in[- ]law|mother[- ]in[- ]law|friend|boss|client|relative|cousin|grandparents?";
const NUMBER_OWNER = "husband|hubby|wife|father|mother|dad|mom|appa|amma|brother|sister|son|daughter|son[- ]in[- ]law|manager|assistant|secretary|friend|uncle";

const JOB = /\b(looking for (a )?(job|work|opportunit\w*|internship)|any (job|jobs|vacanc\w*|openings?)|job (openings?|vacanc\w*)|are you hiring|vacanc(y|ies)|internship|my (resume|cv)|send(ing)? (my )?(resume|cv))\b/i;
const VENDOR = /\b(we (are )?(supply|suppliers?|manufactur\w*|dealers?|distribut\w*|wholesal\w*)|i am (a |an )?(supplier|vendor|dealer|manufacturer|contractor|carpenter|painter|electrician|plumber|fabricator|mason)\b|vendor registration|empanel\w*|tie[- ]?up with you|collaborat\w*|business partnership|labou?r contract)\b/i;
const SPAM = /\b(crypto|bitcoin|forex|trading tips|loan (offer|approved)|click (here|the link)|earn (rs\.?\s*)?\d+|work from home job|seo services|digital marketing services|(increase|buy) (your )?followers|lottery|you have won)\b/i;
const ABUSE = /\b(fuck\w*|f\*+k|bitch|bastard|asshole|motherf\w*|madarchod|behenchod|bhenchod|chutiya|chutiye|gandu|punda|thevidiya|bosadi\w*|randi)\b/i;
const FLIRT = /\b(are you single|date me|go on a date|send (me )?your (pic|photo|selfie)\b(?!s)|i love you|you('re| are) (so )?(sexy|hot|cute|beautiful)|marry me|sexy|nude)\b/i;
const TINY = /\b(only|just)\b[^.?!]{0,25}\b(curtains?|blinds?|one (chair|door|hinge|shelf|wall|cupboard|drawer)|a (chair|hinge|handle|lock|tap)|repair\w*|fix(ing)?|polish\w*|hinges?)\b|\b(repair|fix) (my |a |the |one )?(hinge|handle|drawer|door|chair|sofa|tap|lock|cupboard door)\b/i;
const WORK = /\b(previous|past|earlier|completed|recent|your) (work|works|projects?|designs?|homes)\b|\bportfolio\b|\bgallery\b|\b(show|send|share)( me)? (some )?(photos|pics|pictures|images|samples|designs|work)\b|\bsamples? of (your )?work\b|\bsend (me )?everything\b/i;
const CREDENTIALS = /\bhow many (clients|customers|projects|homes|years|people)\b|\b(how much experience|years of experience|track record|how long have you been|how old is (your|the) company|since when)\b/i;
const CONSULT = /\b(book|schedule|fix|arrange|set ?up)\b(?:\s+\w+){0,3}?\s+(consultation|meeting|appointment|site visit|visit|call)\b|\b(want|need) (a |the )?(consultation|site visit|meeting)\b/i;
const RENTED = /\b(rented|on rent|tenant|renting|rental (flat|house|home|apartment)|leased)\b/i;
const LETTING = /\b(rent (it )?out|give (it )?(on|for) rent|let out|rental income|to rent)\b/i;
const FOR_SOMEONE = new RegExp(`\\b(?:for|on behalf of) (?:my )?(${FAMILY})(?:'s)?\\b|\\bmy (${FAMILY})(?:'s|s)? (?:flat|home|house|villa|apartment|place)\\b`, "i");
const OTHER_NUMBER = new RegExp(`\\bmy (${NUMBER_OWNER})(?:'s|s)? (?:number|no\\.?|mobile|phone|contact)\\b|\\bcall my (${NUMBER_OWNER})\\b|\\b(?:it|this|that) is (?:my )?(${NUMBER_OWNER})(?:'s|s)? (?:number|no\\b)`, "i");
const COMPETITORS = [
  "livspace", "homelane", "home lane", "design cafe", "designcafe", "decorpot", "bonito", "interior company", "hipcouch",
  "beautiful homes", "godrej interio", "urban ladder", "pepperfry", "arrivae", "flipspaces",
];
const QUOTE = /\b(got|have|received|another|other|someone|they|their|local)\b[^.?!]{0,40}\b(quote|quoted|quotation|estimate)\b|\b(beat|match) (that|this|their|the|his) (price|quote|rate)|\bcheaper (than|elsewhere|somewhere)\b/i;
const RUSH = /\b(?:in|within)\s+(?:\d{1,2}|a|one|two|three|four)\s+(?:days?|weeks?)\b|\bbefore (?:the |our )?(?:griha ?pravesh\w*|gruha ?pravesh\w*|house ?warming|diwali|deepavali|pongal|sankranti|ugadi|onam|wedding|marriage|christmas|new year)\b|\b(?:urgent\w*|asap|immediately|by next week|this week itself)\b/i;

/** Living abroad, said in words: "I'm in Dubai", "we are settled in the US", "NRI". */
const ABROAD_PLACES: Record<string, string> = {
  dubai: "AE", "abu dhabi": "AE", sharjah: "AE", uae: "AE", qatar: "QA", doha: "QA", saudi: "SA", riyadh: "SA", jeddah: "SA",
  kuwait: "KW", oman: "OM", muscat: "OM", bahrain: "BH", singapore: "SG", malaysia: "MY", "kuala lumpur": "MY",
  us: "US", usa: "US", america: "US", "united states": "US", canada: "CA", toronto: "CA", uk: "GB", london: "GB", england: "GB",
  germany: "DE", australia: "AU", sydney: "AU", melbourne: "AU", "new zealand": "NZ", ireland: "IE", netherlands: "NL", japan: "JP",
};
const ABROAD_SAID = new RegExp(
  `\\b(?:i am|i'm|im|we are|we're|currently|presently|staying|living|live|based|settled|working)\\b[^.?!]{0,20}?\\b(?:in|at)\\s+(${Object.keys(ABROAD_PLACES).sort((a, b) => b.length - a.length).join("|")}|abroad|overseas)\\b`,
  "i",
);
/** One clock per country where that is true; elsewhere the agent asks which time zone. */
const COUNTRY_ZONE: Record<string, string> = {
  AE: "Asia/Dubai", QA: "Asia/Qatar", SA: "Asia/Riyadh", KW: "Asia/Kuwait", OM: "Asia/Muscat", BH: "Asia/Bahrain", SG: "Asia/Singapore",
  MY: "Asia/Kuala_Lumpur", GB: "Europe/London", IE: "Europe/Dublin", DE: "Europe/Berlin", NL: "Europe/Amsterdam", JP: "Asia/Tokyo", NZ: "Pacific/Auckland",
};

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function localTime(zone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: zone, weekday: "long", hour: "numeric", minute: "2-digit", hour12: true }).format(now);
}

function quoted(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 120 ? `${clean.slice(0, 117)}...` : clean;
}

/**
 * Real-world situations a sharp consultant spots in what someone just wrote: not a customer at all,
 * a job too small, a rented home, someone enquiring for family, a number that is not theirs,
 * a competitor's quote, a rush. Each shapes one reply and leaves a note for the team.
 */
export function messageSituations(text: string, brandName: string): Situation[] {
  const said = quoted(text);
  if (!said) return [];
  const found: Situation[] = [];
  if (ABUSE.test(text)) {
    found.push({
      key: "abuse",
      note: `Abusive language: "${said}"`,
      line: "They used abusive language. Stay calm and polite in one short line. Do not sell, do not ask anything, and say the team will take it from here.",
      handoff: "Abusive language. Staff should take this chat.",
    });
    return found;
  }
  if (SPAM.test(text)) {
    found.push({
      key: "spam",
      note: `Looks like spam or a promotion: "${said}"`,
      line: `This looks like spam or a promotion, not a customer. Reply with one short polite line that you can only help with ${brandName} interiors. Ask nothing.`,
      handoff: "Looks like spam. Staff can review or ignore.",
    });
    return found;
  }
  if (FLIRT.test(text)) {
    found.push({
      key: "flirt",
      note: `Personal or flirty message: "${said}"`,
      line: `They sent a personal or flirty message. Do not play along and do not lecture. In one short, polite line, say you are ${brandName}'s AI assistant and only help with interiors. Ask nothing.`,
      handoff: "Personal or flirty messages. Staff should take this chat.",
    });
    return found;
  }
  const job = JOB.test(text);
  if (job || VENDOR.test(text)) {
    found.push({
      key: job ? "not-a-lead:job" : "not-a-lead:vendor",
      note: job ? `Looking for a job, not a customer: "${said}"` : `Vendor, supplier or contractor, not a customer: "${said}"`,
      line: `This person is not a customer: they are ${job ? "looking for a job" : "offering their products or services"}. Do not ask any lead questions and do not sell. Thank them warmly in one or two lines and say you will pass it to the ${brandName} team, who will get back if there is a fit. Never promise a job, an order or a meeting.`,
      handoff: job ? "Job enquiry, not a customer. Staff should reply." : "Vendor or supplier enquiry, not a customer. Staff should reply.",
    });
    return found;
  }
  if (WORK.test(text)) {
    found.push({
      key: "wants-portfolio",
      note: `Asked to see previous work: "${said}"`,
      line: `They want to see ${brandName}'s previous work. Share the one link from the knowledge base that fits them best (the page for their BHK only if they already told you their BHK and the knowledge base has a page for that exact BHK, never a smaller one, otherwise the portfolio, and the gallery if they ask again), and a matching post link if one fits. Write the link exactly as given, on its own. Offer a visit to the experience centre to see real room setups. Never say you will send photos, and never invent a link.`,
      always: true,
    });
  }
  if (CREDENTIALS.test(text)) {
    found.push({
      key: "credentials",
      note: `Asked about experience or track record: "${said}"`,
      line: "They asked about experience, track record or how many clients. Answer with the facts in the knowledge base only, like the year started and the number of completed projects, in one line. Never invent numbers, awards or famous clients.",
      always: true,
    });
  }
  if (CONSULT.test(text)) {
    found.push({
      key: "book-consultation",
      note: `Wants to book a consultation: "${said}"`,
      line: "They want to book the free consultation. If they have not said when, ask which day and time suit them for the team's call, within working hours. When they give one, say it is noted for the team and that the team will call to confirm it. Never confirm a booked slot yourself. In a line, say what happens in it (the designer understands their needs, then a site visit and 3D designs) if the knowledge base covers that.",
      always: true,
    });
  }
  if (RENOVATING.test(text)) {
    found.push({
      key: "renovation",
      note: `Renovating a home they already have: "${said}"`,
      line: "They are renovating a home they already have, so it is ready: never ask about possession or whether it is ready. Talk like a renovation consultant: find out what is not working in the current home or what they most want to change, and share one useful renovation point, like dismantling the old work, doing it room by room so they can keep living there, or the team checking the old wiring and plumbing at the site visit.",
    });
  }
  if (TINY.test(text)) {
    found.push({
      key: "small-job",
      note: `Small job request: "${said}". The team may not take this up on its own.`,
      line: `They seem to want a small job ("${said}"). ${brandName} mainly does home interiors, not small repairs or single items. Say honestly and kindly, in one line, that the team mainly takes up interior projects and will confirm whether they can help with this, then ask if they are planning anything else for the home. Do not promise.`,
    });
  }
  if (RENTED.test(text) && !LETTING.test(text)) {
    found.push({
      key: "rented-home",
      note: `Home is rented: "${said}". Owner's permission may be needed.`,
      line: "Their home is rented. Lightly ask whether the owner is fine with the work. Tenants usually prefer movable furniture they can take along over built-in work, so mention that once if it helps. Never refuse them.",
    });
  }
  const forWhom = text.match(FOR_SOMEONE);
  if (forWhom) {
    const who = (forWhom[1] ?? forWhom[2] ?? "family").toLowerCase();
    const whose = who.endsWith("s") ? `${who}'` : `${who}'s`;
    found.push({
      key: `for-someone:${who}`,
      note: `Enquiring for their ${whose} home.`,
      line: `The home is their ${whose}. Lightly find out who will decide on the interiors and whose number the team should call, without making it a form. Their own name stays as the contact unless they say otherwise.`,
    });
  }
  const owner = text.match(OTHER_NUMBER);
  if (owner) {
    const who = (owner[1] ?? owner[2] ?? owner[3] ?? "family member").toLowerCase();
    found.push({
      key: `number-owner:${who}`,
      note: `The number given is their ${who}'s. Ask for the ${who} when calling.`,
      line: `The number is their ${who}'s. Say in a few words that the team will ask for their ${who} when calling, and do not ask for another number.`,
    });
  }
  const lower = text.toLowerCase();
  const rival = COMPETITORS.find((name) => lower.includes(name));
  if (rival || QUOTE.test(text)) {
    found.push({
      key: `competitor:${rival ?? "quote"}`,
      note: `Comparing with ${rival ? rival.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "another quote"}: "${said}"`,
      line: `They mentioned ${rival ? "another company" : "another quote"} ("${said}"). Never criticise the other company, never match or beat a price, and never promise a discount. Say in one line that the team will walk them through exactly what is included, the materials and the warranty, so they can compare properly.`,
    });
  }
  if (RUSH.test(text)) {
    found.push({
      key: "rush",
      note: `In a hurry: "${said}"`,
      line: "They sound in a hurry. Never promise a finish date or a call time. If it is about finishing the work, share the usual timeline from the knowledge base and say the team will check what is possible. If it is about a call, say the team calls in working hours.",
    });
  }
  return found;
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

/** The model sometimes skips the passed-time hint and moves on to its next question. */
export function pastTimeReply(text: string, now: Date): string | null {
  const passed = passedToday(text, now);
  if (!passed) return null;
  return `${passed.time} today has already passed, it's ${passed.clock} now. Would a later time today or another day work for u?`;
}

const PRICE = /\b(how much|price|pricing|cost|rate|approx\w*|ballpark|rough(ly)? (cost|idea|estimate)|estimate|quote|starting (price|from)|per sq ?ft|minimum|budget (range|kitna|evlo)|evlo aagum|kitna (lagega|hoga))\b/i;

/** Asking the price again after hearing it depends: the same explanation again would read like a script. */
export function pricePush(prospectTexts: string[]): Situation | null {
  const asked = prospectTexts.filter((text) => PRICE.test(text));
  if (asked.length < 2 || !PRICE.test(prospectTexts[prospectTexts.length - 1] ?? "")) return null;
  return {
    key: "price-push",
    note: `Asked about price ${asked.length} times.`,
    line: "They are asking about the price again. Do not repeat your earlier explanation or its words. Acknowledge plainly that they want a number, give one fresh honest reason it varies so much (for example the same 3 BHK can differ a lot by materials and how much storage and custom work they want), and offer the quickest way to a real estimate: a short call with the team or a visit to the experience centre. Still never quote a number.",
    always: true,
  };
}

/** Someone outside India, known from their WhatsApp number or from what they said. */
export function abroadSituation(input: { phoneE164?: string | null; texts: string[]; now: Date }): (Situation & { country: string | null }) | null {
  const phone = input.phoneE164 ? parsePhoneNumberFromString(input.phoneE164) : undefined;
  const fromPhone = phone?.country && phone.country !== "IN" ? phone.country : null;
  const words = input.texts.join("\n");
  const place = words.match(ABROAD_SAID)?.[1]?.toLowerCase() ?? null;
  const nri = /\bNRI\b/.test(words);
  const fromWords = place ? ABROAD_PLACES[place] ?? null : null;
  if (!fromPhone && !place && !nri) return null;
  const country = fromWords ?? fromPhone;
  const where = country ? countryName(country) : "abroad";
  const zone = country ? COUNTRY_ZONE[country] : undefined;
  const why = fromWords || place || nri ? "from what they said" : `from their ${phone?.countryCallingCode ? `+${phone.countryCallingCode} ` : ""}number`;
  const clock = zone ? ` It is about ${localTime(zone, input.now)} there now.` : " Ask which time zone they are in before suggesting a time.";
  return {
    country,
    key: `abroad:${country ?? "unknown"}`,
    note: `Customer seems to be outside India (${where}, ${why}).${zone ? ` Local time now: ${localTime(zone, input.now)}.` : ""} Plan the call in their time zone.`,
    line: `They seem to live outside India, in ${where} (${why}). Many NRIs do interiors for a home in India from abroad, so if you do not know yet, ask where the home in India is.${clock} When a call time comes up, think in their local time, ask what suits them in their time zone and note it with the time zone. The team can coordinate remotely and will confirm a call or video call. A phone number from their country is fine if it has the country code.`,
  };
}

const NATIONAL_HOLIDAYS = ["01-26 Republic Day", "08-15 Independence Day", "10-02 Gandhi Jayanti", "12-25 Christmas"];

function istDate(now: Date, addDays = 0): { iso: string; weekday: string } {
  const shifted = new Date(now.getTime() + addDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" }).formatToParts(shifted);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return { iso: `${part("year")}-${part("month")}-${part("day")}`, weekday: part("weekday") };
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

/** Festivals, holidays and weekly off days: the team is off, and a warm wish fits. */
export function dayOffLine(now: Date, holidays: string, workingHours: string): string {
  const today = istDate(now);
  const tomorrow = istDate(now, 1);
  const festival = holidayOn(today.iso, holidays);
  const open = openDays(workingHours);
  if (festival) return `Today is ${festival}. Wish them in a few words if it fits the chat, and say the team will call on the next working day.`;
  if (open && !open.has(today.weekday)) {
    const start = WEEK.indexOf(today.weekday);
    const back = [1, 2, 3, 4, 5, 6].map((step) => WEEK[(start + step) % 7]!).find((day) => open.has(day));
    return `Today is ${today.weekday}, the team's weekly off, so say the team will call ${back ? `on ${back}` : "on the next working day"}.`;
  }
  const next = holidayOn(tomorrow.iso, holidays);
  if (next) return `Tomorrow is ${next} and the team may be off, so do not promise a call tomorrow.`;
  return open && !open.has(tomorrow.weekday) ? `Tomorrow, ${tomorrow.weekday}, is the team's weekly off, so do not promise a call tomorrow.` : "";
}

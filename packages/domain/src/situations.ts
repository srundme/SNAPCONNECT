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
      line: "They want the free consultation. If they have not named a time, ask which time inside working hours suits them. When they name one, say it is noted for the team to confirm. Never say the slot is booked. Never mention designers, 3D designs, layouts or site visits.",
      always: true,
    });
  }
  if (RENOVATING.test(text)) {
    found.push({
      key: "renovation",
      note: `Renovating a home they already have: "${said}"`,
      line: "They are renovating a home they already have, so it is ready: never ask about possession or whether it is ready. They are still only enquiring. Never suggest doing it room by room, one room at a time, or while they keep living there, and never talk as if the work is already planned. Ask what they are considering.",
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
      line: `They are comparing ("${said}"). They have not chosen the company. Never criticise the other company, never match or beat a price, and never promise a discount. Give one or two concrete strengths from the knowledge base, such as the materials, the fixed price or the warranty. Do not offer a call unless they ask for one.`,
    });
  }
  if (RUSH.test(text)) {
    found.push({
      key: "rush",
      note: `In a hurry: "${said}"`,
      line: "They sound in a hurry. Never promise a finish date or a call time. If it is about finishing the work, share the usual timeline from the knowledge base and say the team will check what is possible. If it is about a call, say the team calls in working hours.",
    });
  }
  if (priceShock(text)) {
    found.push({
      key: "price-shock",
      note: `Reacted to the price, not a budget: "${said}"`,
      line: "They are reacting to a price, not stating a budget. Do not save this as their budget and never say within that range or that it fits a budget. One calm line is enough, then continue with the next real detail. Do not jump to the phone because of this.",
      always: true,
    });
  }
  if (notNow(text)) {
    found.push({
      key: "not-now",
      note: `Not ready to go ahead: "${said}"`,
      line: "They are not ready to go ahead now. Pause the questions. One short warm line, and tell them they can message here when they are ready. Do not ask for the phone, email, photos, carpet area or timeline.",
      always: true,
    });
  }
  if (notAHome(text)) {
    found.push({
      key: "not-a-home",
      note: `Not a home: "${said}"`,
      line: "This is not a home. The company does home interiors only, not an office, shop, clinic or restaurant. Say that kindly and stop. Do not ask anything else. If they then say there is a home to do, continue.",
      always: true,
    });
  }
  if (aboutTheBuilding(text)) {
    found.push({
      key: "builder-mixup",
      note: `Asking about the building, not the interiors: "${said}"`,
      line: `They are asking about the building, not the interiors. Say once, plainly, that ${brandName} does the interiors and the builder handles the flat, its price and its possession. Then continue with the interiors. Do not invent a possession date or a flat price.`,
      always: true,
    });
  }
  if (alreadyHasDesigner(text)) {
    found.push({
      key: "has-designer",
      note: `Already has a designer or architect: "${said}"`,
      line: "Someone else is already designing it. Ask once whether they want the company to execute that design. Do not restart the questionnaire and do not ask about style.",
      always: true,
    });
  }
  if (asksInclusions(text)) {
    found.push({
      key: "inclusions",
      note: `Asked what the price includes: "${said}"`,
      line: "They asked what the price includes. Never give a figure. Say: 'The budget will be quoted by our team after understanding your requirement, the scope and the materials you choose.' Do not invent a list of inclusions, appliances or a per sq ft rate.",
      always: true,
    });
  }
  if (mentionsTwoHomes(text)) {
    found.push({
      key: "two-homes",
      note: `More than one home: "${said}"`,
      line: "They mentioned more than one home. Ask only which home this chat is about. Do not mix the BHK of one with the area of the other.",
      always: true,
    });
  }
  return found;
}

/** "Huge amount" after a price is a reaction, not a budget they can spend. */
export function priceShock(text: string): boolean {
  const plain = text.replace(/^\(Replied to:[\s\S]*?\)\s*/, "");
  if (/\d/.test(plain) && /\b(?:lakh|lac|crore|rs|₹)\b/i.test(plain)) return false;
  return /\b(?:huge amount|too much|very (?:high|costly|expensive)|so (?:much|costly|expensive)|too costly|too expensive|can(?:not|'t|t) afford|out of (?:my |our )?budget|lot of money)\b/i.test(plain);
}

/** "Just looking" or "call me later" pauses the script. A date such as "after Diwali" does not. */
export function notNow(text: string): boolean {
  const plain = text.replace(/^\(Replied to:[\s\S]*?\)\s*/, "");
  return /\b(?:just (?:looking|browsing|checking|enquiring|inquiring|asking)|only looking|not now|not right now|maybe later|not urgent|not serious|i(?:'ll| will) (?:think|decide|see)|call me later|call me after|call me next year)\b/i.test(plain);
}

/** An office, shop, clinic or restaurant, unless they are also describing a home. */
export function notAHome(text: string): boolean {
  if (/\bhome office\b/i.test(text)) return false;
  // Asking about our office or showroom is not a commercial enquiry.
  if (/\b(?:your|ur|the karighars'?|karighars'?)\s+(?:office|showroom|experience cent(?:re|er)|studio)\b|\bwhere\s+(?:is|r|are)\s+(?:the\s+|your\s+|ur\s+)?(?:office|showroom)\b|\b(?:visit|come to|address of)\s+(?:the\s+|your\s+|ur\s+)?(?:office|showroom|experience cent(?:re|er))\b/i.test(text)) return false;
  if (/\b(\d\s*-?\s*bhk|apartment|flat|villa|independent house|bungalow|my house|my home|our house|our home)\b/i.test(text)) return false;
  return /\b(?:office|shop|showroom|clinic|restaurant|café|cafe|warehouse|godown|commercial space|salon|hotel)\b/i.test(text);
}

/** They think the interiors firm is the builder of the flat. */
export function aboutTheBuilding(text: string): boolean {
  return /\bwhen\b[^?]{0,40}\b(?:flat|apartment|villa|project)\b[^?]{0,24}\b(?:ready|possession)\b|\b(?:price|cost|rate) of (?:the |my |our )?(?:flat|apartment|plot|unit)\b|\b(?:booking amount|which tower|rera)\b/i.test(text);
}

/** An architect or interior designer is already on the job. */
export function alreadyHasDesigner(text: string): boolean {
  return /\b(?:we|i) (?:already )?have (?:an? )?(?:interior designer|architect|designer)\b|\b(?:our|my) (?:architect|interior designer|designer) (?:will|is)\b|\barchitect (?:is|has) (?:already )?/i.test(text);
}

/** What the published starting price covers. */
export function asksInclusions(text: string): boolean {
  return /\b(?:what(?:'s| is) included|does (?:it|that|this|the price|\d+|₹)[^?]{0,24}include|include[sd]? (?:the )?(?:kitchen|false ceiling|appliances|wardrobes?)|with (?:the )?kitchen and)\b/i.test(text);
}

/** Two different homes in one message, so the chat has to pick one. */
export function mentionsTwoHomes(text: string): boolean {
  if (/\b(?:both|another|second|two) (?:flats|houses|homes|villas|apartments|flat|house|home|villa|apartment)\b/i.test(text)) return true;
  if (/\b(?:parents?|mom|dad|in[- ]?laws?)(?:'s|s)?\b/i.test(text) && /\b(?:and|also|plus)\b/i.test(text) && /\b(?:flat|house|home|villa|apartment)\b/i.test(text)) return true;
  const homes = text.match(/\b(?:flats|apartments|villas|houses|homes|flat|apartment|villa|house|home)\b/gi) ?? [];
  const places = (text.match(/\b(?:in|at)\s+[A-Za-z][a-z]+/gi) ?? [])
    .filter((place) => !/\s(?:the|a|an|my|our|your|ur|this|that|least|earliest|present|moment|once|all|first|last|end|home|house|flat|time|any|some|one)$/i.test(place));
  return homes.length >= 2 && places.length >= 2;
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

// "how much time" and "minimum how many days" are about time, not price.
const PRICE = /\b(how much(?!\s+(?:time|days?|weeks?|months?|years?|long|duration))|price|pricing|cost|rate|approx\w*|ballpark|rough(ly)? (cost|idea|estimate)|estimate|quote|starting (price|from)|per sq ?ft|minimum (?:price|cost|budget|amount|charge)|budget (range|kitna|evlo)|evlo aagum|kitna (lagega|hoga))\b/i;

/** A direct price question, not a decision to go ahead. */
export function askingPrice(text: string): boolean {
  return PRICE.test(text.replace(/^\(Replied to:[\s\S]*?\)\s*/, ""));
}

const PROCEED = /\b(?:book|schedule|fix|arrange|set ?up)\b(?:\s+\w+){0,3}?\s+(?:a |the )?(?:consultation|meeting|appointment|site visit|visit|call)\b|\b(?:call me|please call|give me a call|want (?:a |the )?call|let'?s (?:go ahead|proceed|do this|start)|i want to (?:proceed|go ahead|start|book)|we(?:'d| would) like to (?:proceed|go ahead|start)|ready for (?:a |the )?(?:consultation|call)|send (?:the |your )?team)\b/i;

/** They asked for a call or said they want to go ahead. A price question is not this. */
export function readyToProceed(text: string): boolean {
  const plain = text.replace(/^\(Replied to:[\s\S]*?\)\s*/, "");
  if (/\b(?:do not|don't|dont|no)\b[^.]{0,24}\b(?:call|proceed|consultation)\b/i.test(plain)) return false;
  return PROCEED.test(plain);
}

/** Asking the price again after hearing it depends: the same explanation again would read like a script. */
export function pricePush(prospectTexts: string[]): Situation | null {
  const asked = prospectTexts.filter((text) => PRICE.test(text));
  if (asked.length < 2 || !PRICE.test(prospectTexts[prospectTexts.length - 1] ?? "")) return null;
  return {
    key: "price-push",
    note: `Asked about price ${asked.length} times.`,
    line: "They are asking about the price again. Never give any figure. In fresh words, say the team quotes after understanding their requirement, the scope and the materials they choose. Offer the free consultation or an experience centre visit as the way to get the quote.",
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

/** Whether the team can call at this moment. The model gets this wrong if it only sees a clock and a hours string. */
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
export function officeNowLine(now: Date, workingHours: string, holidays = ""): string {
  if (holidayOn(istDate(now).iso, holidays)) {
    return "The team is off today for a holiday. Do not say they will call today or during working hours. If someone is waiting for a call, say you will check with the team, and that maybe they will call on the next working day.";
  }
  const status = officeNow(now, workingHours, holidays);
  if (status.kind === "unknown") return "";
  if (status.kind === "open") return `The team is in working hours right now, until ${status.closeLabel}. If a call has not happened, say you will check with the team. Do not answer with only "during working hours". Never promise when they will call, and never say they will call soon.`;
  if (status.kind === "before") return `Working hours have not started. They start at ${status.openLabel} today. If someone is waiting for a call, say you will check with the team, and that maybe they will call later today after ${status.openLabel}. Do not say only "during working hours".`;
  if (status.kind === "off") return `Today is the weekly off. The next time the team can call is ${status.next} from ${status.openLabel}. If someone is waiting, say you will check with the team, and that today is off so maybe they will call ${status.next === "tomorrow" ? "tomorrow" : `on ${status.next}`}. Do not say only "during working hours".`;
  return `Working hours ended at ${status.closeLabel}. The next time the team can call is ${status.next} from ${status.openLabel}. If someone is waiting for a call, say you will check with the team, and that working hours have passed so maybe they will call ${status.next === "tomorrow" ? "tomorrow" : `on ${status.next}`}. Do not say only "during working hours", and do not tell them how many minutes ago their details were sent.`;
}

const WAITING_CALL = /\bnot called\b|\bno(?:body| one)\b(?:\s+\w+){0,6}\s+call(?:ed|ing)?\b|\b(?:haven'?t|hasn'?t|didn'?t|did not|yet to|still not|not yet)\b(?:\s+\w+){0,5}\s+call(?:ed)?\b|\bwaiting for\b(?:\s+\w+){0,4}\s+call\b|\bno call (?:yet|till now|until now|so far|from)\b/i;
const REFUSE_CALL = /\b(?:do not|don't|dont)\s+call\b|\bno (?:need|thanks)\b[^.?!\n]{0,16}\bcall\b|\bnot interested\b/i;

/** They are chasing a call that has not happened, not asking for one and not refusing one. */
export function waitingOnCall(text: string): boolean {
  const said = text.replace(/^\(Replied to:[\s\S]*?\)\s*/, "");
  if (REFUSE_CALL.test(said)) return false;
  return WAITING_CALL.test(said);
}

/** The whole reply when they say the team has not called. No minute count, no vague "working hours". */
export function callWaitReply(now: Date, workingHours: string, holidays = "", alreadyAsked = false): string {
  const lead = alreadyAsked ? "I have asked the team to check" : "I'll check with my team";
  if (holidayOn(istDate(now).iso, holidays)) return `${lead}. today is a holiday, so maybe they will call on the next working day`;
  const status = officeNow(now, workingHours, holidays);
  if (status.kind === "open" || status.kind === "unknown") return lead;
  if (status.kind === "before") return `${lead}. working hours start at ${status.openLabel}, so maybe later today`;
  if (status.kind === "off") return `${lead}. today is the weekly off, so maybe they will call u ${status.next === "tomorrow" ? "tomorrow" : `on ${status.next}`}`;
  if (status.next === "tomorrow") return `${lead}. working hours have passed, so maybe they will call u tomorrow`;
  return `${lead}. working hours have passed, and tomorrow is off, so maybe they will call u on ${status.next}`;
}

/** Opening and closing minutes read from working hours like "Tuesday to Sunday, 10 AM to 7 PM". */
export function openHours(workingHours: string): { open: number; close: number } | null {
  const match = workingHours.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\s*(?:to|-|–|till|until)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)/i);
  if (!match) return null;
  const at = (hour: string, minute: string | undefined, half: string) => ((Number(hour) % 12) + (half.toLowerCase() === "pm" ? 12 : 0)) * 60 + Number(minute ?? 0);
  return { open: at(match[1]!, match[2], match[3]!), close: at(match[4]!, match[5], match[6]!) };
}

type RequestedTime = { clock: string; day: string; inside: boolean; why: string };

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
  if (relative) {
    const word = relative[1]!.toLowerCase();
    const amount = word.startsWith("half") ? 0.5 : NUMBER_WORDS[word] ?? Number(word);
    const delta = /^h/i.test(relative[2]!) ? amount * 60 : amount;
    const target = nowMinutes + Math.round(delta);
    addDays = Math.floor(target / 1440);
    minutes = target % 1440;
  } else if (absolute) {
    minutes = ((Number(absolute[1]) % 12) + (absolute[3]!.toLowerCase() === "pm" ? 12 : 0)) * 60 + Number(absolute[2] ?? 0);
    const weekday = text.match(/\b(sun|mon|tue|wed|thu|fri|sat)(?:s|nes|rs|ur)?(?:day)?\b/i);
    if (/\btomorrow\b|\bkal\b|\bnaalai\b|\bnaale\b/i.test(text)) addDays = 1;
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
  if (open && !open.has(day)) return { clock, day: dayWord, inside: false, why: `${day} is the team's weekly off` };
  if (minutes < hours.open || minutes >= hours.close) return { clock, day: dayWord, inside: false, why: `it is outside working hours (${clockLabel(hours.open)} to ${clockLabel(hours.close)})` };
  return { clock, day: dayWord, inside: true, why: "" };
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

export function requestedTimeLine(time: RequestedTime): string {
  return time.inside
    ? `They want ${time.clock} ${time.day}. That is INSIDE working hours, so it is fine: say you have noted ${time.clock} ${time.day} here for the team to confirm. Never say it is outside or past working hours.`
    : `They want ${time.clock} ${time.day}, but ${time.why}. Say so kindly and ask for a time within working hours.`;
}

const HOURS_CLAIM = /\b(past|outside|after|beyond|not (?:in|within))\b[^.?!\n]{0,25}\b(working|office|business) hours\b|\b(working|office) hours (?:are |is )?(?:over|closed|done)\b|\bteam is closed\b/i;
const ACCEPTS = /\b(fine|noted|works?|ok(?:ay)?|sure|done|perfect)\b/i;

/** The reply to send instead when the model contradicts the working-hours check. */
export function requestedTimeReply(time: RequestedTime, reply: string): string | null {
  if (time.inside && HOURS_CLAIM.test(reply)) return `${time.clock} ${time.day} works, I've noted it here for the team to confirm.`;
  if (!time.inside && ACCEPTS.test(reply) && !/\b(working hours|weekly off|closed|another time|other time)\b/i.test(reply)) {
    return `${time.clock} ${time.day} won't work since ${time.why}. Which other time suits u?`;
  }
  return null;
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

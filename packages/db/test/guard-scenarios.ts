/** Shared scenario generator for the guard risk tests (pure text, and the full engine). */
import type { LeadQuestion } from "@snapsocial/domain";

export const QUESTIONS: LeadQuestion[] = [
  { id: "name", kind: "name", label: "May I know your name?", required: true, zohoField: "Last_Name" },
  { id: "place", kind: "text", label: "Where is the home: which area, and what is the property name?", required: true, zohoField: "Project_Location" },
  { id: "home", kind: "text", label: "What kind of home is it: apartment, villa or independent house, and how many BHK?", required: true, zohoField: "Home_Type" },
  { id: "possession", kind: "text", label: "When do you get possession, or is the home already ready?", required: true, zohoField: "Possession" },
  { id: "phone", kind: "phone", label: "Which number should the team call you on?", required: true, zohoField: "Phone" },
  { id: "email", kind: "text", label: "Email for the team to share the details?", required: true, zohoField: "Email" },
];
export const ORDER = QUESTIONS.map((question) => question.id);
export const QUOTE_LINE = "We will share the exact budget after understanding your requirement, the scope and the materials you choose.";
export const VISIT_OFFER = "Shall I book a free consultation for you, or would you like to visit our experience centre?";
export type Lang = "en" | "hinglish" | "tanglish";

// Next-detail questions, several phrasings each. `key` must reach the customer.
const ASKS: Record<Lang, Record<string, Array<{ text: string; key: string }>>> = {
  en: {
    name: [{ text: "May I know your name?", key: "your name" }, { text: "What should I call you?", key: "call you" }, { text: "Could you tell me your name?", key: "your name" }],
    place: [
      { text: "Which area is your home in, and what is the property name?", key: "property name" },
      { text: "What is the property name and the area?", key: "property name" },
      { text: "Where is the home located?", key: "home located" },
      { text: "Which area is it in? And what is the property name?", key: "which area is it in" },
    ],
    home: [
      { text: "Is it an apartment, villa or independent house, and how many BHK?", key: "how many bhk" },
      { text: "How many BHK is the home?", key: "how many bhk" },
      { text: "What kind of home is it, and how many BHK?", key: "how many bhk" },
    ],
    possession: [
      { text: "When do you get possession, or is the home already ready?", key: "possession" },
      { text: "Is the home ready, or when is possession?", key: "possession" },
    ],
    phone: [
      { text: "Which number should we call you on?", key: "number" },
      { text: "Could you share your phone number?", key: "phone number" },
      { text: "What is the best number to reach you?", key: "best number" },
    ],
    email: [{ text: "What email should we send the details to?", key: "email" }, { text: "Could you share your email?", key: "email" }],
    done: [{ text: VISIT_OFFER, key: "free consultation" }],
  },
  hinglish: {
    name: [{ text: "Aapka naam kya hai?", key: "naam" }],
    place: [{ text: "Ghar kis area mein hai, aur property ka naam kya hai?", key: "property ka naam" }],
    home: [{ text: "Kitne BHK ka ghar hai?", key: "kitne bhk" }],
    possession: [{ text: "Possession kab milega, ya ghar ready hai?", key: "possession kab" }],
    phone: [{ text: "Kaunse number pe call karein?", key: "kaunse number" }],
    email: [{ text: "Aapka email kya hai?", key: "email" }],
    done: [{ text: "Free consultation book karein, ya experience centre visit karenge?", key: "free consultation" }],
  },
  tanglish: {
    name: [{ text: "Unga peru enna?", key: "peru" }],
    place: [{ text: "Veedu entha area la irukku, property peru enna?", key: "property peru" }],
    home: [{ text: "Ethana BHK veedu?", key: "ethana bhk" }],
    possession: [{ text: "Possession eppo kidaikkum?", key: "possession eppo" }],
    phone: [{ text: "Unga number sollunga?", key: "number" }],
    email: [{ text: "Unga email id sollunga?", key: "email" }],
    done: [{ text: "Free consultation book pannatuma, illa experience centre visit pannuveengala?", key: "free consultation" }],
  },
};

// What the customer asked and the answer that must survive. `design` = they asked about design, `price` = they asked price.
type Topic = { ask: string; answer: string; key: string; design?: boolean; price?: boolean; bot?: boolean; material?: boolean };
const TOPICS: Record<Lang, Topic[]> = {
  en: [
    { ask: "Which plywood do you use?", answer: "We use BWP grade plywood for the kitchen and bathrooms.", key: "bwp grade plywood", material: true },
    { ask: "What hinges do you use?", answer: "We use Hettich hinges with soft close on every shutter.", key: "hettich hinges", material: true },
    { ask: "Is there a warranty?", answer: "The modular kitchen comes with a lifetime warranty on the hardware.", key: "lifetime warranty", material: true },
    { ask: "How long does it take?", answer: "A full home usually takes about 60 to 90 days.", key: "60 to 90 days" },
    { ask: "How long will the work take?", answer: "When the site is ready, we finish a full home in about 75 days.", key: "75 days" },
    { ask: "How fast can you finish?", answer: "Can be done in about 60 days after you sign off.", key: "60 days" },
    { ask: "Do you work in Whitefield?", answer: "We work across Bengaluru, including Whitefield and Sarjapur.", key: "across bengaluru" },
    { ask: "Do you do villas?", answer: "Yes, we do villas and independent houses too.", key: "villas and independent houses" },
    { ask: "What is the price for 3bhk?", answer: QUOTE_LINE, key: "exact budget", price: true },
    { ask: "Will I see a 3D design first?", answer: "Yes, you will see 3D views of every room before work starts.", key: "3d views", design: true },
    { ask: "Are you a bot?", answer: "Yes, I am Varun, the AI assistant for The KariGhars.", key: "ai assistant", bot: true },
    { ask: "Is the experience centre open today?", answer: "Our experience centre is open today till 7 PM.", key: "till 7 pm" },
    { ask: "Can I come on Monday?", answer: "We are closed on Mondays, so Tuesday to Sunday works best.", key: "closed on mondays" },
    { ask: "Do you do false ceiling?", answer: "Yes, false ceiling and lighting are part of our full home work.", key: "false ceiling" },
    { ask: "Will you handle electrical work?", answer: "Will handle the electrical and painting work as part of the full home.", key: "electrical and painting" },
    { ask: "Is it turnkey?", answer: "Is fully turnkey, from civil changes to the final cleaning.", key: "fully turnkey" },
  ],
  hinglish: [
    { ask: "Plywood kaunsa use karte ho?", answer: "Hum kitchen mein BWP plywood use karte hain.", key: "bwp plywood", material: true },
    { ask: "Kitna time lagega?", answer: "Pura ghar lagbhag 60 se 90 din mein ho jata hai.", key: "60 se 90 din" },
    { ask: "Price kya hai 3bhk ka?", answer: QUOTE_LINE, key: "exact budget", price: true },
  ],
  tanglish: [
    { ask: "Enna plywood use panreenga?", answer: "Kitchen ku BWP plywood dhan use panrom.", key: "bwp plywood", material: true },
    { ask: "Evlo naal aagum?", answer: "Full veedu 60 to 90 days la mudichiduvom.", key: "60 to 90 days" },
  ],
};

// Answers to the last question (no question from them), e.g. "3 bhk", "Prestige Lakeside, Whitefield".
const ANSWERS: Record<string, string[]> = {
  name: ["Karthik", "my name is Priya", "Rahul here"],
  place: ["Prestige Lakeside Habitat, Whitefield", "Sobha Dream Acres in Panathur", "APR, Sarjapur road"],
  home: ["3 bhk apartment", "4 BHK villa", "independent house 5bhk"],
  possession: ["December", "home is ready", "next March"],
  phone: ["9845011111", "my number is 9886022222"],
  email: ["priya@gmail.com", "rahul.k@outlook.com"],
};

const ACKS: Record<Lang, string[]> = {
  en: ["Got it.", "Thank you.", "Okay sir.", "Noted, thank you.", ""],
  hinglish: ["Theek hai sir.", "Samajh gaya.", ""],
  tanglish: ["Seri sir.", "Purinjidhu.", ""],
};

// Things that must never reach the customer. `when` limits it to scenarios where it is wrong.
type Bad = { text: string; drop: RegExp; keep?: string; name: string };
const BAD_EN: Bad[] = [
  { name: "price", text: "Our full home packages start from 12 lakhs.", drop: /lakh|start from/i },
  { name: "designer", text: "Our designer will prepare a 3D layout for you.", drop: /designer|3d layout/i },
  { name: "site-visit", text: "We can also arrange a site visit.", drop: /site visit/i },
  { name: "praise", text: "That is a comfortable size.", drop: /comfortable size/i },
  { name: "canned", text: "Have a great day!", drop: /great day/i },
  { name: "day-announce", text: "Tomorrow is Saturday so that works.", drop: /tomorrow is saturday/i },
  { name: "team-voice", text: "The team will confirm the details.", drop: /\bthe team will\b/i, keep: "confirm the details" },
  { name: "short-forms", text: "Pls share ur photos if u have them.", drop: /\b(pls|ur|u)\b/i, keep: "photos" },
  { name: "callback", text: "Our team will call you shortly.", drop: /will call you shortly/i },
];
const BAD_HINGLISH: Bad[] = [
  { name: "female-hindi", text: "Main aapko details bataungi.", drop: /bataungi/i, keep: "bataunga" },
  { name: "tamil-ending", text: "Kitchen la BWP plywood lagate hain.", drop: /kitchen la\b/i, keep: "kitchen mein" },
  { name: "price", text: "Package 12 lakh se start hota hai.", drop: /lakh/i },
];

// Deterministic pseudo random, so the run is the same every time.
export function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

export type Scenario = {
  id: number;
  lang: Lang;
  kind: string;
  customer: string;
  draft: string;
  collected: string[];
  next: string;
  metBefore: boolean;
  mustKeep: string[];
  mustDrop: Array<{ name: string; re: RegExp }>;
  material: boolean;
};

export function build(count: number): Scenario[] {
  const random = rng(20261009);
  const pick = <T,>(list: T[]): T => list[Math.floor(random() * list.length)]!;
  const out: Scenario[] = [];
  for (let id = 0; out.length < count; id += 1) {
    const lang: Lang = random() < 0.7 ? "en" : random() < 0.6 ? "hinglish" : "tanglish";
    const collectedCount = Math.floor(random() * (ORDER.length + 1));
    const collected = ORDER.slice(0, collectedCount);
    const next = ORDER[collectedCount] ?? "done";
    const metBefore = collectedCount > 0 || random() < 0.3;
    const asksTopic = random() < 0.45;
    const topic = asksTopic ? pick(TOPICS[lang]) : null;
    const lastAnswered = collected[collected.length - 1];
    const customer = topic ? topic.ask : lastAnswered ? pick(ANSWERS[lastAnswered]!) : pick(["hi", "hello", "I want interiors for my new home"]);
    const ask = pick(ASKS[lang][next]!);
    const ack = topic ? "" : pick(ACKS[lang]);
    const parts: string[] = [];
    const mustKeep: string[] = [ask.key];
    const mustDrop: Scenario["mustDrop"] = [];
    if (ack) parts.push(ack);
    if (topic) {
      parts.push(topic.answer);
      mustKeep.push(topic.key);
    }
    // 0 to 2 bad insertions, plus the structural risks.
    const bads = lang === "en" ? BAD_EN : lang === "hinglish" ? BAD_HINGLISH : [];
    const badCount = bads.length ? Math.floor(random() * 3) : 0;
    const chosen = new Set<Bad>();
    for (let index = 0; index < badCount; index += 1) chosen.add(pick(bads));
    for (const bad of chosen) {
      if (topic?.design && /designer|site-visit/.test(bad.name)) continue;
      if (topic?.price && bad.name === "price") continue;
      parts.push(bad.text);
      mustDrop.push({ name: bad.name, re: bad.drop });
      if (bad.keep && !(topic?.material && bad.name === "team-voice")) mustKeep.push(bad.keep);
    }
    const structural = random();
    let kind = topic ? `answer:${topic.key}` : "answer-detail";
    if (structural < 0.15 && collected.length) {
      // Re-asks a detail already collected, before the real next question.
      const again = pick(collected);
      const text = again === "name" ? "Could you share your name?" : pick(ASKS.en[again] ?? ASKS.en.place!).text;
      if (lang === "en") {
        parts.push(text);
        mustDrop.push({ name: `reask-${again}`, re: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\?$/, ""), "i") });
        kind += "+reask";
      }
    } else if (structural < 0.25 && metBefore && !topic?.bot && lang === "en") {
      parts.unshift("Hi, I am Varun, the AI assistant for The KariGhars.");
      mustDrop.push({ name: "reintro", re: /I am Varun, the AI assistant/i });
      kind += "+reintro";
    } else if (structural < 0.35 && next !== "done") {
      // A second, different missing detail asked after the real one.
      const later = ORDER.slice(collectedCount + 1);
      if (later.length) {
        parts.push(pick(ASKS[lang][pick(later)]!).text);
        kind += "+second-question";
      }
    }
    parts.push(ask.text);
    out.push({
      id,
      lang,
      kind,
      customer,
      draft: parts.join(random() < 0.5 ? " " : "\n"),
      collected,
      next,
      metBefore,
      mustKeep,
      mustDrop,
      material: Boolean(topic?.material),
    });
  }
  return out;
}


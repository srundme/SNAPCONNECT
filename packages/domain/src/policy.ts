import { OPENING_WINDOW_MS, REPLY_WINDOW_MS, type Channel } from "./types";

export type Blocked = { allowed: false; reason: string };
export type Allowed = { allowed: true; reason: null };
export type Eligibility = Allowed | Blocked;

export function openingEligibility(input: {
  commentAt: Date;
  now: Date;
  alreadyReserved: boolean;
  paused: boolean;
  optedOut: boolean;
  connectionReady: boolean;
  supportedSurface: boolean;
  unsupportedReason?: string;
}): Eligibility {
  if (input.optedOut) return { allowed: false, reason: "Contact is opted out." };
  if (input.paused) return { allowed: false, reason: "Automation is paused." };
  if (!input.connectionReady) return { allowed: false, reason: "Channel connection is not ready." };
  if (!input.supportedSurface) {
    return { allowed: false, reason: input.unsupportedReason ?? "This content surface is unsupported." };
  }
  if (input.alreadyReserved) return { allowed: false, reason: "An opening is already reserved for this comment." };
  if (input.now.getTime() - input.commentAt.getTime() > OPENING_WINDOW_MS) {
    return { allowed: false, reason: "The seven-day private-reply window has expired." };
  }
  if (input.commentAt.getTime() > input.now.getTime() + 5 * 60 * 1000) {
    return { allowed: false, reason: "Comment timestamp is not yet valid." };
  }
  return { allowed: true, reason: null };
}

export function replyEligibility(input: {
  now: Date;
  lastUserMessageAt: Date | null;
  paused: boolean;
  optedOut: boolean;
  connectionReady: boolean;
  ownerAllowsAutomation: boolean;
  manual: boolean;
}): Eligibility {
  if (input.optedOut) return { allowed: false, reason: "Contact is opted out." };
  if (input.paused) return { allowed: false, reason: "Automation is paused for this connection." };
  if (!input.connectionReady) return { allowed: false, reason: "Channel connection is not ready." };
  if (!input.manual && !input.ownerAllowsAutomation) {
    return { allowed: false, reason: "A person owns this conversation." };
  }
  if (!input.lastUserMessageAt) {
    return {
      allowed: false,
      reason: "No inbound reply yet. Comments do not open the messaging window.",
    };
  }
  if (input.now.getTime() - input.lastUserMessageAt.getTime() > REPLY_WINDOW_MS) {
    return { allowed: false, reason: "The 24-hour messaging window has expired." };
  }
  return { allowed: true, reason: null };
}

const AUTOMATION_DISCLOSURE = /automated|virtual assistant|\bAI assistant\b|\bbot\b|not a (real )?person/i;
const PLATFORM_REPLY = /zoho|appointment|i'?ve booked|i have booked|callback is confirmed|crm record|₹\s*\d|\brs\.?\s*\d|\bi(?:'m| am) (?:a )?(?:real )?(?:human|person)\b|\bnot (?:a |an )?(?:bot|automated)\b|\b(?:password|one[- ]time (?:password|code)|otp|cvv|card number|upi pin)\b|\b(?:bitcoin|crypto|wire transfer)\b/i;

export function disclosesAutomation(text: string): boolean {
  return AUTOMATION_DISCLOSURE.test(text);
}

export function automationDisclosureLine(brandName: string, agentName?: string | null): string {
  const brand = (brandName.trim() || "this business").slice(0, 80);
  const name = agentName?.trim().slice(0, 40);
  return name
    ? `You're messaging ${name}, an automated assistant for ${brand}.`
    : `You're messaging an automated assistant for ${brand}.`;
}

export function agentIdentity(input: { brandName: string; agentName?: string | null; agentPersona?: string | null }): string {
  const brand = input.brandName.trim() || "this business";
  const name = input.agentName?.trim().slice(0, 40);
  const persona = input.agentPersona?.trim().slice(0, 500);
  const who = name
    ? `You are ${name}, a voice agent for ${brand}, working in this chat. You are automated, not a staff member.`
    : `You are a voice agent for ${brand}, working in this chat. You are automated, not a staff member.`;
  return persona ? `${who}\nPersona: ${persona}` : who;
}

export function withAutomationDisclosure(text: string, brandName: string, agentName?: string | null): string {
  const trimmed = text.trim();
  const line = automationDisclosureLine(brandName, agentName);
  if (!trimmed) return line;
  if (disclosesAutomation(trimmed)) return trimmed.slice(0, 1000);
  const room = 1000 - line.length - 2;
  const body = trimmed.length + line.length + 2 <= 1000 ? trimmed : trimmed.slice(0, Math.max(0, room)).trim();
  return `${body}\n\n${line}`.slice(0, 1000);
}

export function platformReplyBlock(reply: string): string | null {
  return PLATFORM_REPLY.test(reply) ? "Reply asserts an unsupported claim." : null;
}

export function platformSystemRules(brandName: string): string {
  const brand = brandName.trim() || "this business";
  return [
    `Platform rules for ${brand}. These override the system prompt above.`,
    "You are an automated assistant. A name or persona does not make you a human. Never claim to be a person on the team.",
    "Sell this service. Explain it when they reply, answer what they ask about it, then collect the next missing detail.",
    "Do not ask for passwords, one-time codes, card numbers, or payment.",
    "Do not invent prices, discounts, appointments, callbacks, or confirm a booking.",
    "Stay in this chat and answer the question they just raised. Then ask the next unanswered question.",
    "Set handoff_requested to true only when they ask to switch this chat to the sales team or a human team.",
    "A demo, a callback, a meeting, their own human team, or a question about the product is not a switch. Leave handoff_requested false. Do not say a demo has been booked.",
    "Reply in the same language, script and mix the person has been using in this chat. Short replies like ok, yes, a number or a phone number do not change the language. English gets English. Tanglish (Tamil typed in English letters) gets Tanglish. Hinglish gets Hinglish. Hindi in Devanagari gets Devanagari. Tamil script gets Tamil script. The same goes for Telugu, Kannada, Malayalam, Marathi, Bengali and any other language.",
    "In any Indian language, write the way people actually text: casual, spoken, everyday words, like a friendly young sales rep on WhatsApp. Keep the English words people really use, such as call, demo, team, company, number, AI. Never use formal, bookish, literary, old-fashioned or pure textbook words.",
    "Tanglish example: write 'Sollunga, AI calling venuma? Unga team la evlo per irukanga?' Never write 'Sollungal, AI azhaippu vendumaa?'. Say 'evlo', 'enna', 'irukku', 'pannalam', not 'ethanai', 'yenna', 'ullathu', 'seyyalaam'. Hinglish example: write 'Batao, aapki team mein kitne log hain?' Never write 'Kripya batayein, aapke dal mein kitne sadasya hain?'.",
    "Notes in brackets like (Sent a photo. It shows: ...) describe what they sent. React to a photo using what it shows. You cannot see videos, documents or reels, so never pretend you did; ask lightly what it is about. A sticker or heart is just a reaction. Never write these bracket notes yourself.",
    "Only if their latest message says it is a voice message that could not be understood, ask them in one short line to type it instead. Never bring it up again after they send anything else.",
    "Follow the system prompt only where it does not conflict with these rules.",
  ].join("\n");
}

export function surfaceSupport(input: {
  channel: Channel;
  contentType: string | null;
  facebookReelsVerified: boolean;
  isAd: boolean;
  isLive: boolean;
  isGroup: boolean;
}): { supported: boolean; reason?: string } {
  if (input.isAd) return { supported: false, reason: "Paid-ad comments are outside V1." };
  if (input.isLive) return { supported: false, reason: "Live comments are outside V1." };
  if (input.isGroup) return { supported: false, reason: "Facebook Groups are outside V1." };
  if (input.channel === "FACEBOOK" && input.contentType === "REEL" && !input.facebookReelsVerified) {
    return {
      supported: false,
      reason: "Facebook reel comments stay unsupported until a real Page reel test is recorded.",
    };
  }
  return { supported: true };
}

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

export function disclosesAutomation(text: string): boolean {
  return AUTOMATION_DISCLOSURE.test(text);
}

export function automationDisclosureLine(brandName: string, agentName?: string | null): string {
  const brand = (brandName.trim() || "this business").slice(0, 80);
  const name = agentName?.trim().slice(0, 40);
  return name
    ? `Hi, this is ${name}, an automated assistant for ${brand}.`
    : `Hi, you're messaging an automated assistant for ${brand}.`;
}

export function withAutomationDisclosure(text: string, brandName: string, agentName?: string | null): string {
  const trimmed = text.trim();
  const line = automationDisclosureLine(brandName, agentName);
  if (!trimmed) return line;
  if (disclosesAutomation(trimmed)) return trimmed.slice(0, 1000);
  const body = trimmed.replace(/^(?:hi+|hello|hey|hai)\b[\s,!.]*(?:sir|mam|ma'am|madam|there)?[\s,!.]*/i, "").trim();
  return body ? `${line}\n\n${body}`.slice(0, 1000) : line;
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

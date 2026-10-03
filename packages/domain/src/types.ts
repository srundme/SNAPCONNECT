export const channels = ["INSTAGRAM", "FACEBOOK"] as const;
export type Channel = (typeof channels)[number];

export const connectionModes = ["SIMULATION", "INTEGRATION"] as const;
export type ConnectionMode = (typeof connectionModes)[number];

export const qualifications = [
  "NEW",
  "IN_PROGRESS",
  "CONTACTABLE",
  "QUALIFIED",
  "DISQUALIFIED",
] as const;
export type Qualification = (typeof qualifications)[number];

export const salesStages = [
  "UNASSIGNED",
  "ASSIGNED",
  "CONTACTED",
  "MEETING_BOOKED",
  "WON",
  "LOST",
] as const;
export type SalesStage = (typeof salesStages)[number];

export const conversationOwners = ["AI", "HUMAN", "PAUSED"] as const;
export type ConversationOwner = (typeof conversationOwners)[number];

export const crmStates = [
  "NOT_READY",
  "PENDING",
  "SYNCED",
  "RETRYING",
  "NEEDS_ATTENTION",
] as const;
export type CrmState = (typeof crmStates)[number];

export const outboundStates = [
  "RESERVED",
  "SENDING",
  "ACCEPTED",
  "RETRYABLE_FAILURE",
  "PERMANENT_FAILURE",
  "UNKNOWN",
] as const;
export type OutboundState = (typeof outboundStates)[number];

export const workspaceRoles = ["ADMIN", "AGENT", "VIEWER"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export const platformRoles = ["SUPER_ADMIN", "STAFF"] as const;
export type PlatformRole = (typeof platformRoles)[number];

export const OPENING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export const leadFields = [
  "chosenName",
  "city",
  "projectType",
  "propertyType",
  "workType",
  "requirement",
  "budgetRaw",
  "timeframeRaw",
  "phoneRaw",
  "whatsappRaw",
  "sameNumber",
  "preferredChannel",
  "phonePermission",
  "whatsappPermission",
] as const;
export type LeadField = (typeof leadFields)[number];

export type ProjectType = "residential" | "commercial" | "other";
export type WorkType = "new" | "renovation" | "unknown";
export type PreferredChannel = "phone" | "whatsapp" | "email" | "unknown";

export type BudgetParse =
  | {
      kind: "amount";
      currency: string;
      amountMinor: number;
      raw: string;
    }
  | {
      kind: "range";
      currency: string;
      minMinor: number;
      maxMinor: number;
      raw: string;
    }
  | { kind: "declined"; raw: string }
  | { kind: "ambiguous"; raw: string }
  | { kind: "absent" };

export type PhoneParse =
  | { kind: "valid"; e164: string; raw: string }
  | { kind: "invalid"; raw: string }
  | { kind: "declined"; raw: string }
  | { kind: "absent" };

import type { Channel, ConnectionMode } from "./types";

export type CohortContact = {
  contactId: string;
  channel: Channel;
  connectionId: string;
  mode: ConnectionMode;
  firstMatchingCommentAt: string | null;
  firstAcceptedOpeningAt: string | null;
  firstInboundAt: string | null;
  contactableAt: string | null;
  qualifiedAt: string | null;
};

export type FunnelResult = {
  population: "channel_contacts";
  observationCutoff: string;
  matchingContacts: number;
  openingsAccepted: number;
  inboundResponses: number;
  contactable: number;
  qualified: number;
  note: string;
};

function inInterval(value: string | null, start: Date, end: Date): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return time >= start.getTime() && time <= end.getTime();
}

function atOrBefore(value: string | null, cutoff: Date): boolean {
  if (!value) return false;
  return new Date(value).getTime() <= cutoff.getTime();
}

export function cohortFunnel(input: {
  contacts: CohortContact[];
  start: Date;
  end: Date;
  observationCutoff: Date;
  channel?: Channel | "ALL";
  connectionId?: string;
  mode?: ConnectionMode | "ALL";
}): FunnelResult {
  const selected = input.contacts.filter((contact) => {
    if (input.channel && input.channel !== "ALL" && contact.channel !== input.channel) return false;
    if (input.connectionId && contact.connectionId !== input.connectionId) return false;
    if (input.mode && input.mode !== "ALL" && contact.mode !== input.mode) return false;
    return inInterval(contact.firstMatchingCommentAt, input.start, input.end);
  });
  const count = (pick: (contact: CohortContact) => string | null) =>
    selected.filter((contact) => atOrBefore(pick(contact), input.observationCutoff)).length;
  return {
    population: "channel_contacts",
    observationCutoff: input.observationCutoff.toISOString(),
    matchingContacts: selected.length,
    openingsAccepted: count((contact) => contact.firstAcceptedOpeningAt),
    inboundResponses: count((contact) => contact.firstInboundAt),
    contactable: count((contact) => contact.contactableAt),
    qualified: count((contact) => contact.qualifiedAt),
    note: "Combined totals count channel contacts. They are not unique people across Instagram and Facebook.",
  };
}

export function zonedDay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function crmCoverage(syncedEligible: number, eligible: number): { syncedEligible: number; eligible: number; ratio: number | null } {
  return {
    syncedEligible,
    eligible,
    ratio: eligible === 0 ? null : syncedEligible / eligible,
  };
}

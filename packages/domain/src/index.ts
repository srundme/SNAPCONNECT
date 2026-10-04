export * from "./types";
export * from "./authz";
export * from "./policy";
export * from "./rules";
export * from "./parse";
export * from "./qualify";
export * from "./ai";
export * from "./intent";
export * from "./signature";
export * from "./csv";
export * from "./analytics";
export * from "./webhooks";
export * from "./crm";
export * from "./briefing";

export function pausesBlock(flags: {
  platform: boolean;
  workspace: boolean;
  connection: boolean;
  rule: boolean;
  conversation: boolean;
}): boolean {
  return flags.platform || flags.workspace || flags.connection || flags.rule || flags.conversation;
}

export function inferenceSlotAvailable(active: number, limit: number): boolean {
  return active < limit;
}

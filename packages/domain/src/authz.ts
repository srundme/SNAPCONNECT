import type { PlatformRole, WorkspaceRole } from "./types";

export type Actor = {
  userId: string;
  platformRole: PlatformRole;
  suspended: boolean;
  memberships: Array<{ workspaceId: string; role: WorkspaceRole }>;
};

export type Action =
  | "platform.manage"
  | "workspace.read"
  | "workspace.manage"
  | "inbox.read"
  | "inbox.reply"
  | "lead.read"
  | "lead.edit"
  | "lead.export"
  | "report.read"
  | "audit.read"
  | "team.manage"
  | "integration.manage"
  | "simulation.inject";

const viewerActions = new Set<Action>(["workspace.read", "report.read"]);
const agentActions = new Set<Action>([
  "workspace.read",
  "inbox.read",
  "inbox.reply",
  "lead.read",
  "lead.edit",
  "report.read",
]);
const adminActions = new Set<Action>([
  ...agentActions,
  "workspace.manage",
  "lead.export",
  "audit.read",
  "team.manage",
  "integration.manage",
  "simulation.inject",
]);

export function membershipRole(
  actor: Actor,
  workspaceId: string,
): WorkspaceRole | null {
  return actor.memberships.find((item) => item.workspaceId === workspaceId)?.role ?? null;
}

export function can(
  actor: Actor,
  action: Action,
  workspaceId?: string,
): boolean {
  if (actor.suspended) return false;
  if (action === "platform.manage") return actor.platformRole === "SUPER_ADMIN";
  if (!workspaceId) return false;
  if (actor.platformRole === "SUPER_ADMIN") return true;
  const role = membershipRole(actor, workspaceId);
  if (!role) return false;
  if (role === "VIEWER") return viewerActions.has(action);
  if (role === "AGENT") return agentActions.has(action);
  return adminActions.has(action);
}

export function canGrantPlatformRole(
  actor: Actor,
  next: PlatformRole,
): boolean {
  if (actor.suspended) return false;
  if (next !== "SUPER_ADMIN") return actor.platformRole === "SUPER_ADMIN" || false;
  return actor.platformRole === "SUPER_ADMIN";
}

export function canAssignWorkspaceRole(
  actor: Actor,
  workspaceId: string,
  next: WorkspaceRole,
): boolean {
  if (!can(actor, "team.manage", workspaceId)) return false;
  if (next === "ADMIN" || next === "AGENT" || next === "VIEWER") {
    return actor.platformRole === "SUPER_ADMIN" || membershipRole(actor, workspaceId) === "ADMIN";
  }
  return false;
}

export function canMutateLead(input: {
  actor: Actor;
  workspaceId: string;
  assignedUserId: string | null;
  claimUnassigned: boolean;
}): boolean {
  if (!can(input.actor, "lead.edit", input.workspaceId)) return false;
  if (input.actor.platformRole === "SUPER_ADMIN") return true;
  if (membershipRole(input.actor, input.workspaceId) === "ADMIN") return true;
  if (input.claimUnassigned && input.assignedUserId === null) return true;
  return input.assignedUserId === input.actor.userId;
}

export function projectionForRole(role: WorkspaceRole | "SUPER_ADMIN"): "full" | "aggregate" {
  return role === "VIEWER" ? "aggregate" : "full";
}

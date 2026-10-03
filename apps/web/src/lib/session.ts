import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPrisma } from "@snapsocial/db";
import { can, type Action, type Actor, type WorkspaceRole } from "@snapsocial/domain";
import { auth } from "./auth";

export async function requireActor(): Promise<Actor & { name: string; email: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const user = await getPrisma().user.findUnique({
    where: { id: session.user.id },
    include: { memberships: true },
  });
  if (!user || user.suspendedAt) redirect("/login?revoked=1");
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    platformRole: user.platformRole,
    suspended: false,
    memberships: user.memberships.map((item) => ({ workspaceId: item.workspaceId, role: item.role })),
  };
}

export async function requireWorkspace() {
  const actor = await requireActor();
  const selected = (await cookies()).get("ss_workspace")?.value;
  const db = getPrisma();
  const allowed = actor.platformRole === "SUPER_ADMIN"
    ? await db.workspace.findMany({ orderBy: { name: "asc" } })
    : await db.workspace.findMany({ where: { id: { in: actor.memberships.map((item) => item.workspaceId) } }, orderBy: { name: "asc" } });
  const workspace = allowed.find((item) => item.id === selected) ?? allowed[0] ?? null;
  const role: WorkspaceRole | "SUPER_ADMIN" | null = !workspace
    ? null
    : actor.platformRole === "SUPER_ADMIN"
      ? "SUPER_ADMIN"
      : actor.memberships.find((item) => item.workspaceId === workspace.id)?.role ?? null;
  return { actor, workspace, role, workspaces: allowed };
}

export async function assertCan(action: Action, workspaceId: string) {
  const actor = await requireActor();
  if (!can(actor, action, workspaceId)) redirect("/overview?denied=1");
  return actor;
}

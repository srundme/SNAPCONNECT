import { getPrisma } from "@snapsocial/db";
import { requireWorkspace } from "@/lib/session";

export const dynamic = "force-dynamic";

const WINDOW_MS = 48 * 60 * 60 * 1000;

/** The current workspace's unread team alerts from the last 48 hours, newest first. Viewers get none. */
export async function GET() {
  const { workspace, role } = await requireWorkspace();
  const headers = { "Cache-Control": "no-store" };
  if (!workspace || !role || role === "VIEWER") return Response.json({ alerts: [], unread: 0 }, { headers });
  const db = getPrisma();
  const where = { workspaceId: workspace.id, readAt: null, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } };
  const [alerts, unread] = await Promise.all([
    db.teamAlert.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, kind: true, text: true, conversationId: true, createdAt: true },
    }),
    db.teamAlert.count({ where }),
  ]);
  return Response.json(
    { alerts: alerts.map((alert) => ({ ...alert, createdAt: alert.createdAt.toISOString() })), unread },
    { headers },
  );
}

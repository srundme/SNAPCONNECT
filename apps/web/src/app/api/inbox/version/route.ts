import { getPrisma } from "@snapsocial/db";
import { requireWorkspace } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const { workspace } = await requireWorkspace();
  if (!workspace) return Response.json({ version: null });
  const db = getPrisma();
  const [message, conversation] = await Promise.all([
    db.message.aggregate({ where: { workspaceId: workspace.id }, _max: { createdAt: true } }),
    db.conversation.aggregate({ where: { workspaceId: workspace.id }, _max: { updatedAt: true } }),
  ]);
  const version = `${message._max.createdAt?.getTime() ?? 0}:${conversation._max.updatedAt?.getTime() ?? 0}`;
  return Response.json({ version }, { headers: { "Cache-Control": "no-store" } });
}

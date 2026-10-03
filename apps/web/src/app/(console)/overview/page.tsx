import Link from "next/link";
import { getPrisma } from "@snapsocial/db";
import { Empty, PageTitle, Panel, StatGrid, StatusLabel } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const params = await searchParams;
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Ask a platform owner to grant access." />;
  const db = getPrisma();
  const [leads, chats, handoffs, pendingCrm, connections] = await Promise.all([
    db.lead.count({ where: { workspaceId: workspace.id, archivedAt: null } }),
    db.conversation.count({ where: { workspaceId: workspace.id, owner: "AI" } }),
    db.conversation.count({ where: { workspaceId: workspace.id, owner: "HUMAN" } }),
    db.lead.count({ where: { workspaceId: workspace.id, crmState: { in: ["PENDING", "RETRYING", "NEEDS_ATTENTION"] } } }),
    db.channelConnection.findMany({ where: { workspaceId: workspace.id } }),
  ]);
  const qualified = role === "VIEWER" ? null : await db.lead.count({ where: { workspaceId: workspace.id, qualification: "QUALIFIED" } });
  return (
    <section>
      <PageTitle title={workspace.name} detail={`${workspace.timezone} · ${workspace.mode === "SIMULATION" ? "Simulated adapters" : "Real adapters, automation starts paused"}`} />
      {params.denied ? <p className="mb-4 rounded-lg border border-[#fecdd3] bg-[#fff1f2] px-3 py-2 text-sm text-[#9f1239]">You do not have access to that action.</p> : null}
      <StatGrid items={[
        { label: "Leads", value: leads },
        { label: "AI chats", value: chats },
        { label: "Handoffs", value: handoffs },
        { label: "CRM attention", value: pendingCrm },
      ]} />
      <p className="mt-4 text-sm text-[var(--color-muted)]">{qualified !== null ? `${qualified} qualified` : "Viewers see aggregate counts only."}</p>
      <div className="mt-8 mb-3 flex items-center justify-between">
        <h2 className="text-[19px] font-semibold tracking-tight">Connections</h2>
        <Link href="/inbox" className="text-sm font-medium text-[var(--color-accent-ink)]">Open inbox</Link>
      </div>
      <Panel>
        <ul>
          {connections.map((connection) => (
            <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3 text-sm last:border-b-0">
              <span className="font-medium">{connection.displayName}</span>
              <span className="flex flex-wrap gap-2">
                <StatusLabel tone={connection.mode === "SIMULATION" ? "sim" : "neutral"}>{connection.mode === "SIMULATION" ? "Simulated" : "Integration"}</StatusLabel>
                <StatusLabel tone={connection.automationPaused ? "wait" : "ok"}>{connection.automationPaused ? "Paused" : "Automation on"}</StatusLabel>
                <StatusLabel tone={connection.lastRealCommentAt ? "ok" : "neutral"}>{connection.lastRealCommentAt ? "Real comment seen" : "No real comment"}</StatusLabel>
              </span>
            </li>
          ))}
          {connections.length === 0 ? <li className="px-4 py-6 text-sm text-[var(--color-muted)]">No channel is connected.</li> : null}
        </ul>
      </Panel>
    </section>
  );
}

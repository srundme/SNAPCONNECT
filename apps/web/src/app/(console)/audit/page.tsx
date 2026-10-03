import { getPrisma } from "@snapsocial/db";
import { Empty, PageTitle } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

export default async function AuditPage() {
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER" || role === "AGENT") return <Empty title="Permission denied" body="Audit history is limited to admins." />;
  const events = await getPrisma().auditEvent.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <section>
      <PageTitle title="Audit" detail="Sensitive values are omitted from these summaries." />
      {events.length === 0 ? <Empty title="No audit events" body="Settings changes, replies, handoffs and deletions will appear here." /> : (
        <ul className="divide-y divide-[var(--color-line)] text-sm">
          {events.map((event) => <li key={event.id} className="py-2"><span className="text-[var(--color-muted)]">{event.createdAt.toISOString()}</span> · {event.action} · {event.summary}</li>)}
        </ul>
      )}
    </section>
  );
}

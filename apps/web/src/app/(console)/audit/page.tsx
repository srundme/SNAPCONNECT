import { getPrisma } from "@snapsocial/db";
import { Empty, PageTitle } from "@/components/ui";
import { fullIST, whenIST } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";

export default async function AuditPage() {
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER" || role === "AGENT") return <Empty title="Admins only" body="The activity history is visible to admins." />;
  const events = await getPrisma().auditEvent.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <section className="max-w-4xl">
      <PageTitle title="Audit" detail="The last 100 changes and actions in this workspace. Private values are never shown here." />
      {events.length === 0 ? <Empty title="Nothing recorded yet" body="Settings changes, replies, handovers and deletions will appear here." /> : (
        <ol className="divide-y divide-[var(--color-line)] overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-card)]">
          {events.map((event) => (
            <li key={event.id} className="grid gap-0.5 px-4 py-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4 sm:px-5">
              <time dateTime={event.createdAt.toISOString()} title={fullIST(event.createdAt)} className="text-[13px] tabular-nums text-[var(--color-muted)]">{whenIST(event.createdAt)}</time>
              <p className="min-w-0 break-words text-sm">{event.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

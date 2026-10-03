import Link from "next/link";
import { getPrisma } from "@snapsocial/db";
import { Empty, PageTitle, Panel, StatusLabel, ChannelMark } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

export default async function LeadsPage() {
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER") return <Empty title="Permission denied" body="Viewers do not receive lead records." />;
  const leads = await getPrisma().lead.findMany({
    where: { workspaceId: workspace.id, archivedAt: null },
    include: { contact: true, crm: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return (
    <section>
      <PageTitle title="Leads" detail="Qualification, sales stage and CRM sync stay independent." />
      {role === "ADMIN" || role === "SUPER_ADMIN" ? <p className="mb-3 text-sm"><a className="font-medium text-[var(--color-accent-ink)]" href="/api/leads/export">Download CSV</a></p> : null}
      {leads.length === 0 ? <Empty title="No leads" body="A comment that matches a rule creates a lead." /> : (
        <Panel className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Contact</th><th>Channel</th><th>Qualification</th><th>Stage</th><th>CRM</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td><Link href={`/leads/${lead.id}`}>{lead.contact.chosenName ?? lead.contact.username ?? lead.contact.displayName ?? "Prospect"}</Link></td>
                  <td><ChannelMark channel={lead.channel} /></td>
                  <td><StatusLabel tone="neutral">{lead.qualification}</StatusLabel></td>
                  <td>{lead.salesStage.replaceAll("_", " ")}</td>
                  <td>{lead.crm?.simulated ? "Simulated" : lead.crmState.replaceAll("_", " ")}{lead.crm?.crmId ? ` · ${lead.crm.crmId}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </section>
  );
}

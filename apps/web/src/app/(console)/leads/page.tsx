import Link from "next/link";
import { parseLeadQuestions } from "@snapsocial/domain";
import { getPrisma } from "@snapsocial/db";
import { ChannelMark, Empty, PageTitle, Panel } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

function answerText(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const text = (value as Record<string, unknown>)[key];
  return typeof text === "string" && text.trim() ? text.trim() : null;
}

export default async function LeadsPage() {
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER") return <Empty title="Permission denied" body="Viewers do not receive lead records." />;
  const canEdit = role === "ADMIN" || role === "SUPER_ADMIN";
  const companyId = parseLeadQuestions(workspace.leadQuestions).find((question) => question.zohoField === "Company")?.id ?? "company-name";
  const leads = await getPrisma().lead.findMany({
    where: { workspaceId: workspace.id, archivedAt: null, crmState: "SYNCED" },
    include: { contact: true, crm: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return (
    <section>
      <PageTitle title="Leads" detail="People who finished the questions and were written to Zoho. Setup lives on Agent." />
      {canEdit ? <p className="mb-3 text-sm"><a className="font-medium text-[var(--color-accent-ink)]" href="/api/leads/export">Download CSV</a></p> : null}
      {leads.length === 0 ? <Empty title="No leads in Zoho yet" body="The assistant collects the questions from Agent. A person appears here after Zoho accepts the lead." /> : (
        <Panel className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Contact</th><th>Company</th><th>Phone</th><th>Channel</th><th>Zoho</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td><Link href={`/leads/${lead.id}`}>{lead.contact.chosenName ?? lead.contact.username ?? lead.contact.displayName ?? "Prospect"}</Link></td>
                  <td>{answerText(lead.answers, companyId) ?? "—"}</td>
                  <td>{lead.phoneE164 ?? "—"}</td>
                  <td><ChannelMark channel={lead.channel} /></td>
                  <td>{lead.crm?.simulated ? "Simulated" : lead.crm?.crmId ?? "Sent"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </section>
  );
}

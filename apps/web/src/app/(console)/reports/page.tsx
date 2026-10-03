import { getPrisma } from "@snapsocial/db";
import { cohortFunnel, crmCoverage } from "@snapsocial/domain";
import { Empty, PageTitle, StatGrid } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ channel?: string; mode?: string }> }) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  const leads = await getPrisma().lead.findMany({
    where: { workspaceId: workspace.id },
    include: { contact: true },
  });
  const connections = await getPrisma().channelConnection.findMany({ where: { workspaceId: workspace.id } });
  const modeByConnection = new Map(connections.map((item) => [item.id, item.mode]));
  const attempts = await getPrisma().outboundAttempt.findMany({ where: { workspaceId: workspace.id, status: "ACCEPTED" } });
  const openingByContact = new Map(attempts.map((item) => [item.contactId, item.updatedAt.toISOString()]));
  const messages = await getPrisma().message.findMany({ where: { workspaceId: workspace.id, author: "PROSPECT" }, orderBy: { createdAt: "asc" } });
  const firstInbound = new Map<string, string>();
  for (const message of messages) {
    const conversation = await getPrisma().conversation.findUnique({ where: { id: message.conversationId } });
    if (conversation && !firstInbound.has(conversation.contactId)) firstInbound.set(conversation.contactId, message.createdAt.toISOString());
  }
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date();
  const funnel = cohortFunnel({
    contacts: leads.map((lead) => ({
      contactId: lead.contactId,
      channel: lead.channel,
      connectionId: lead.connectionId,
      mode: modeByConnection.get(lead.connectionId) ?? "SIMULATION",
      firstMatchingCommentAt: lead.sourceType === "COMMENT" ? lead.createdAt.toISOString() : null,
      firstAcceptedOpeningAt: openingByContact.get(lead.contactId) ?? null,
      firstInboundAt: firstInbound.get(lead.contactId) ?? null,
      contactableAt: lead.contactableAt?.toISOString() ?? null,
      qualifiedAt: lead.qualifiedAt?.toISOString() ?? null,
    })),
    start,
    end,
    observationCutoff: end,
    channel: params.channel === "INSTAGRAM" || params.channel === "FACEBOOK" ? params.channel : "ALL",
    mode: params.mode === "SIMULATION" || params.mode === "INTEGRATION" ? params.mode : "ALL",
  });
  const filteredLeads = leads.filter((lead) => {
    const channelMatch = params.channel === "INSTAGRAM" || params.channel === "FACEBOOK" ? lead.channel === params.channel : true;
    const modeMatch = params.mode === "SIMULATION" || params.mode === "INTEGRATION"
      ? (modeByConnection.get(lead.connectionId) ?? "SIMULATION") === params.mode
      : true;
    return channelMatch && modeMatch;
  });
  const eligible = filteredLeads.filter((lead) => lead.qualification === "CONTACTABLE" || lead.qualification === "QUALIFIED").length;
  const synced = filteredLeads.filter((lead) => lead.crmState === "SYNCED").length;
  const coverage = crmCoverage(synced, eligible);
  return (
    <section>
      <PageTitle title="Reports" detail="The funnel is a fixed cohort of channel contacts. Combined totals are not unique people." />
      <p className="mb-4 text-sm text-[var(--color-muted)]">Observation cutoff {funnel.observationCutoff}. Timezone {workspace.timezone}.</p>
      <StatGrid columns={5} items={[
        { label: "Matching contacts", value: funnel.matchingContacts },
        { label: "Openings accepted", value: funnel.openingsAccepted },
        { label: "Inbound replies", value: funnel.inboundResponses },
        { label: "Contactable", value: funnel.contactable },
        { label: "Qualified", value: funnel.qualified },
      ]} />
      <p className="mt-4 text-sm text-[var(--color-muted)]">{funnel.note}</p>
      <p className="mt-2 text-sm">CRM coverage: {coverage.syncedEligible} synced / {coverage.eligible} eligible{coverage.ratio === null ? "" : ` (${Math.round(coverage.ratio * 100)}%)`}.</p>
      <div className="mt-5 flex flex-wrap gap-2 text-sm">
        {[
          ["/reports", "Combined"],
          ["/reports?channel=INSTAGRAM", "Instagram"],
          ["/reports?channel=FACEBOOK", "Facebook"],
          ["/reports?mode=SIMULATION", "Simulation"],
          ["/reports?mode=INTEGRATION", "Integration"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1 hover:bg-[var(--color-paper)]">{label}</a>
        ))}
      </div>
    </section>
  );
}

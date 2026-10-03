import { notFound } from "next/navigation";
import { getPrisma } from "@snapsocial/db";
import { deleteLeadContact } from "@/lib/actions";
import { PageTitle, StatusLabel } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace, role } = await requireWorkspace();
  if (!workspace || role === "VIEWER") notFound();
  const lead = await getPrisma().lead.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { contact: true, evidence: true, consents: true, crm: true },
  });
  if (!lead) notFound();
  return (
    <section>
      <PageTitle title={lead.contact.chosenName ?? lead.contact.username ?? "Prospect"} detail="A valid-looking number is not ownership verification." />
      <div className="flex gap-2 text-sm">
        <StatusLabel tone="neutral">{lead.qualification}</StatusLabel>
        <StatusLabel tone="neutral">{lead.salesStage}</StatusLabel>
        <StatusLabel tone={lead.crmState === "SYNCED" ? "ok" : "wait"}>{lead.crm?.simulated ? "Simulated CRM" : lead.crmState}</StatusLabel>
      </div>
      <dl className="mt-6 grid max-w-xl gap-2 text-sm">
        <div>City: {lead.city ?? "Unknown"}</div>
        <div>Project: {lead.projectType ?? "Unknown"}</div>
        <div>Requirement: {lead.requirement ?? "Unknown"}</div>
        <div>Budget: {lead.budgetRaw ?? "Unknown"} {lead.budgetAmountMinor ? `(${lead.budgetAmountMinor} ${lead.budgetCurrency ?? ""})` : ""}</div>
        <div>Timeline: {lead.timeframeRaw ?? "Unknown"}</div>
        <div>Phone: {lead.phoneE164 ?? "Unknown"}</div>
        <div>WhatsApp: {lead.whatsappE164 ?? "Unknown"} {lead.sameNumberConfirmed ? "(confirmed same number)" : ""}</div>
        <div>Source: {lead.sourceType} · {lead.sourceMediaId ?? "unattributed"}</div>
        <div>Reasons: {lead.qualificationReasons.join("; ") || "None yet"}</div>
      </dl>
      <h2 className="mt-8 font-semibold">Permission evidence</h2>
      <ul className="mt-2 text-sm">{lead.consents.map((item) => <li key={item.id}>{item.channel}: {item.disclosure}</li>)}</ul>
      {(role === "ADMIN" || role === "SUPER_ADMIN") ? (
        <form action={deleteLeadContact} className="mt-8">
          <input type="hidden" name="contactId" value={lead.contactId} />
          <button className="border border-rose-300 px-3 py-1.5 text-sm text-rose-900" type="submit">Delete contact data</button>
        </form>
      ) : null}
    </section>
  );
}

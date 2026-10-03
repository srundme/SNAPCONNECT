import { headers } from "next/headers";
import { getPrisma } from "@snapsocial/db";
import { can, toCsv } from "@snapsocial/domain";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const user = await getPrisma().user.findUnique({ where: { id: session.user.id }, include: { memberships: true } });
  if (!user || user.suspendedAt) return new Response("Unauthorized", { status: 401 });
  const actor = {
    userId: user.id,
    platformRole: user.platformRole,
    suspended: false,
    memberships: user.memberships.map((item) => ({ workspaceId: item.workspaceId, role: item.role })),
  };
  const workspaceId = user.memberships[0]?.workspaceId;
  if (!workspaceId || !can(actor, "lead.export", workspaceId)) return new Response("Forbidden", { status: 403 });
  const leads = await getPrisma().lead.findMany({ where: { workspaceId, archivedAt: null }, include: { contact: true } });
  const csv = toCsv(leads.map((lead) => ({
    leadId: lead.id,
    channel: lead.channel,
    name: lead.contact.chosenName ?? "",
    city: lead.city ?? "",
    phone: lead.phoneE164 ?? "",
    qualification: lead.qualification,
    crm: lead.crmState,
  })));
  await getPrisma().auditEvent.create({
    data: { actorId: user.id, workspaceId, action: "lead.export", entityType: "Lead", summary: `Exported ${leads.length} leads.` },
  });
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8" } });
}

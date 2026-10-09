import { cookies, headers } from "next/headers";
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
  const selected = (await cookies()).get("ss_workspace")?.value;
  const allowed = actor.platformRole === "SUPER_ADMIN"
    ? await getPrisma().workspace.findMany({ orderBy: { name: "asc" }, select: { id: true } })
    : await getPrisma().workspace.findMany({ where: { id: { in: actor.memberships.map((item) => item.workspaceId) } }, orderBy: { name: "asc" }, select: { id: true } });
  const workspaceId = (allowed.find((item) => item.id === selected) ?? allowed[0])?.id;
  if (!workspaceId || !can(actor, "lead.export", workspaceId)) return new Response("Forbidden", { status: 403 });
  const leads = await getPrisma().lead.findMany({ where: { workspaceId, archivedAt: null, crmState: "SYNCED" }, include: { contact: true } });
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

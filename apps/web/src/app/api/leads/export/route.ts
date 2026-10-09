import { cookies, headers } from "next/headers";
import { getPrisma } from "@snapsocial/db";
import { can, parseLeadQuestions, toCsv } from "@snapsocial/domain";
import { STATUS_LABEL, answersOf, columnQuestions, isTestContact, leadName, leadStatus, ownerLabel, ratingOf, zohoLeadUrl } from "@/components/leads/lead-data";
import { fullIST } from "@/lib/format";
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
  const db = getPrisma();
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { leadQuestions: true, agentName: true } });
  const columns = columnQuestions(parseLeadQuestions(workspace?.leadQuestions));
  const agentName = workspace?.agentName?.trim() || "Assistant";
  const [allLeads, zoho] = await Promise.all([
    db.lead.findMany({ where: { workspaceId, archivedAt: null }, include: { contact: true, crm: true }, orderBy: { updatedAt: "desc" } }),
    db.zohoConnection.findUnique({ where: { workspaceId }, select: { apiDomain: true } }),
  ]);
  const leads = allLeads.filter((lead) => !isTestContact(lead.contact));
  const conversations = leads.length
    ? await db.conversation.findMany({
      where: { workspaceId, contactId: { in: leads.map((lead) => lead.contactId) } },
      select: { contactId: true, owner: true, ownerUserId: true },
      orderBy: { updatedAt: "desc" },
    })
    : [];
  const byContact = new Map<string, (typeof conversations)[number]>();
  for (const conversation of conversations) if (!byContact.has(conversation.contactId)) byContact.set(conversation.contactId, conversation);
  const userIds = [...new Set(conversations.map((item) => item.ownerUserId).filter((id): id is string => Boolean(id)))];
  const users = new Map((userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : []).map((item) => [item.id, item.name]));
  const header = ["Name", "Channel", "Home", "Project / area", "Possession", "Rating", "Rating reason", "Status", "Owner", "Phone", "Email", "Created (IST)", "Updated (IST)", "Zoho link"];
  const csv = toCsv(leads.length ? leads.map((lead) => {
    const answers = answersOf(lead.answers);
    const pick = (id: string | null) => (id ? answers[id] ?? "" : "");
    const rating = ratingOf(lead.rating);
    return {
      Name: leadName(lead.contact),
      Channel: lead.channel === "INSTAGRAM" ? "Instagram" : lead.channel === "WHATSAPP" ? "WhatsApp" : "Facebook",
      Home: pick(columns.home),
      "Project / area": pick(columns.project) || lead.city || "",
      Possession: pick(columns.possession),
      Rating: rating === "HOT" ? "Hot" : rating === "JUNK" ? "Junk" : "Unrated",
      "Rating reason": lead.ratingReason ?? "",
      Status: STATUS_LABEL[leadStatus(lead)],
      Owner: ownerLabel(byContact.get(lead.contactId), agentName, users),
      Phone: lead.phoneE164 ?? "",
      Email: lead.email ?? pick(columns.email),
      "Created (IST)": fullIST(lead.createdAt),
      "Updated (IST)": fullIST(lead.updatedAt),
      "Zoho link": lead.crm?.crmId && !lead.crm.simulated ? zohoLeadUrl(lead.crm.crmId, zoho?.apiDomain) : "",
    };
  }) : [Object.fromEntries(header.map((key) => [key, ""]))]);
  await getPrisma().auditEvent.create({
    data: { actorId: user.id, workspaceId, action: "lead.export", entityType: "Lead", summary: `Exported ${leads.length} leads.` },
  });
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return new Response(`\uFEFF${csv}`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="leads-${stamp}.csv"` },
  });
}

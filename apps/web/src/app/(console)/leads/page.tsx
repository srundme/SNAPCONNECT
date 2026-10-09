import Link from "next/link";
import { Download, ExternalLink } from "lucide-react";
import { can, parseLeadQuestions } from "@snapsocial/domain";
import { getPrisma } from "@snapsocial/db";
import { ChannelMark, Empty, PageTitle, Panel, StatGrid } from "@/components/ui";
import { RatingChip, StatusChip } from "@/components/leads/chips";
import { ClickableRow } from "@/components/leads/clickable-row";
import { LeadFilters } from "@/components/leads/lead-filters";
import {
  answersOf,
  columnQuestions,
  isTestContact,
  leadName,
  leadStatus,
  ownerLabel,
  parseStatus,
  ratingOf,
  zohoLeadUrl,
  type Rating,
} from "@/components/leads/lead-data";
import { whenIST } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";

type Search = { rating?: string; channel?: string; status?: string; q?: string; test?: string };

function ZohoLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" title="Open in Zoho" aria-label="Open in Zoho" className="inline-flex size-7 items-center justify-center rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-paper)] hover:text-[var(--color-accent-ink)]">
      <ExternalLink size={14} aria-hidden />
    </a>
  );
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const { actor, workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER") return <Empty title="Permission denied" body="Viewers do not receive lead records." />;
  const canExport = can(actor, "lead.export", workspace.id);

  const ratingFilter: Rating | undefined = params.rating === "HOT" || params.rating === "JUNK" || params.rating === "UNRATED" ? params.rating : undefined;
  const channelFilter = params.channel === "INSTAGRAM" || params.channel === "FACEBOOK" || params.channel === "WHATSAPP" ? params.channel : undefined;
  const statusFilter = parseStatus(params.status);
  const query = (params.q ?? "").trim().toLowerCase();
  const showTest = params.test === "1";

  const db = getPrisma();
  const questions = parseLeadQuestions(workspace.leadQuestions);
  const columns = columnQuestions(questions);
  const [leads, zoho] = await Promise.all([
    db.lead.findMany({
      where: { workspaceId: workspace.id, archivedAt: null },
      include: { contact: true, crm: true },
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
    db.zohoConnection.findUnique({ where: { workspaceId: workspace.id }, select: { apiDomain: true } }),
  ]);
  const conversations = leads.length
    ? await db.conversation.findMany({
      where: { workspaceId: workspace.id, contactId: { in: leads.map((lead) => lead.contactId) } },
      select: { contactId: true, owner: true, ownerUserId: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    })
    : [];
  const byContact = new Map<string, (typeof conversations)[number]>();
  for (const conversation of conversations) if (!byContact.has(conversation.contactId)) byContact.set(conversation.contactId, conversation);
  const userIds = [...new Set(conversations.map((item) => item.ownerUserId).filter((id): id is string => Boolean(id)))];
  const users = new Map((userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : []).map((user) => [user.id, user.name]));
  const agentName = workspace.agentName?.trim() || "Assistant";

  const rows = leads.map((lead) => {
    const answers = answersOf(lead.answers);
    const pick = (id: string | null) => (id ? answers[id] ?? null : null);
    return {
      id: lead.id,
      name: leadName(lead.contact),
      test: isTestContact(lead.contact),
      channel: lead.channel,
      phone: lead.phoneE164,
      home: pick(columns.home),
      project: pick(columns.project) ?? lead.city,
      possession: pick(columns.possession),
      rating: ratingOf(lead.rating),
      ratingReason: lead.ratingReason,
      status: leadStatus(lead),
      owner: ownerLabel(byContact.get(lead.contactId), agentName, users),
      updatedAt: lead.updatedAt,
      zohoUrl: lead.crm?.crmId && !lead.crm.simulated ? zohoLeadUrl(lead.crm.crmId, zoho?.apiDomain) : null,
    };
  });
  const visible = rows.filter((row) => showTest || !row.test);
  const testCount = rows.length - visible.length;
  const filtered = visible.filter((row) => {
    if (ratingFilter && row.rating !== ratingFilter) return false;
    if (channelFilter && row.channel !== channelFilter) return false;
    if (statusFilter && row.status !== statusFilter) return false;
    if (query) {
      const haystack = [row.name, row.phone, row.project, row.home].filter(Boolean).join(" ").toLowerCase();
      const digits = query.replace(/\D/g, "");
      if (!haystack.includes(query) && !(digits.length >= 4 && (row.phone ?? "").includes(digits))) return false;
    }
    return true;
  });
  const filtering = Boolean(ratingFilter || channelFilter || statusFilter || query);

  const exportLink = canExport ? (
    <a href="/api/leads/export" className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--color-line)] bg-white px-3.5 py-2 text-sm font-semibold hover:bg-[#faf7f2]">
      <Download size={15} aria-hidden /> Download CSV
    </a>
  ) : null;

  return (
    <section>
      <PageTitle title="Leads" detail={`Everyone ${agentName} is talking to about a home, newest activity first. Open a lead for the full profile.`} action={exportLink} />
      <div className="mb-5">
        <StatGrid items={[
          { label: "Total", value: visible.length },
          { label: "Hot", value: <span className="text-[var(--color-accent)]">{visible.filter((row) => row.rating === "HOT").length}</span> },
          { label: "In Zoho", value: visible.filter((row) => row.status === "IN_ZOHO").length },
          { label: "Needs details", value: visible.filter((row) => row.status === "COLLECTING").length },
        ]} />
      </div>
      <LeadFilters values={{ rating: ratingFilter, channel: channelFilter, status: statusFilter, q: params.q, test: showTest }} />

      {visible.length === 0 ? (
        <Empty
          title="No leads yet"
          body={testCount > 0
            ? `Only test conversations so far (${testCount} hidden). Tick “Show test leads” to see them.`
            : `A lead appears here as soon as someone starts answering ${agentName}'s questions on Instagram, Facebook or WhatsApp.`}
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-line)] bg-white px-6 py-10 text-center">
          <p className="text-[17px] font-semibold tracking-tight">No leads match these filters</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">Try a different search, or <Link href={showTest ? "/leads?test=1" : "/leads"} className="font-semibold text-[var(--color-accent-ink)] underline underline-offset-2">clear all filters</Link>.</p>
        </div>
      ) : (
        <>
          <p className="mb-2 px-1 text-[13px] text-[var(--color-muted)]">
            {filtering ? `${filtered.length} of ${visible.length} leads` : `${visible.length} leads`}
            {!showTest && testCount > 0 ? ` · ${testCount} test hidden` : ""}
          </p>

          {/* Desktop / tablet: table */}
          <Panel className="hidden md:block">
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Name</th><th>Channel</th><th>Home</th><th>Project / area</th><th>Possession</th><th>Rating</th><th>Status</th><th>Owner</th><th className="text-right">Updated</th><th className="w-10"><span className="sr-only">Zoho</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <ClickableRow key={row.id} href={`/leads/${row.id}`}>
                      <td className="max-w-[220px]">
                        <Link href={`/leads/${row.id}`} className="block truncate">{row.name}</Link>
                        {row.phone ? <span className="block text-[12px] tabular-nums text-[var(--color-muted)]">{row.phone}</span> : null}
                      </td>
                      <td><ChannelMark channel={row.channel} /></td>
                      <td className="whitespace-nowrap">{row.home ?? <Dash />}</td>
                      <td className="max-w-[220px]"><span className="line-clamp-2">{row.project ?? <Dash />}</span></td>
                      <td className="max-w-[160px]"><span className="line-clamp-2">{row.possession ?? <Dash />}</span></td>
                      <td><RatingChip rating={row.rating} reason={row.ratingReason} /></td>
                      <td><StatusChip status={row.status} /></td>
                      <td className="whitespace-nowrap text-[13px]">{row.owner}</td>
                      <td className="whitespace-nowrap text-right text-[13px] tabular-nums text-[var(--color-muted)]">{whenIST(row.updatedAt)}</td>
                      <td className="text-right">{row.zohoUrl ? <ZohoLink href={row.zohoUrl} /> : null}</td>
                    </ClickableRow>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Phone: cards */}
          <ul className="grid gap-2 md:hidden">
            {filtered.map((row) => (
              <li key={row.id} className="relative rounded-2xl bg-white p-4 shadow-[0_1px_0_rgba(20,23,28,0.06)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/leads/${row.id}`} className="block truncate text-[15px] font-semibold after:absolute after:inset-0 after:content-['']">{row.name}</Link>
                    <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">{whenIST(row.updatedAt)} · {row.owner}</p>
                  </div>
                  <RatingChip rating={row.rating} reason={row.ratingReason} />
                </div>
                <p className="mt-2 text-sm">
                  {[row.home, row.project].filter(Boolean).join(" · ") || <span className="text-[var(--color-muted)]">No home details yet</span>}
                </p>
                {row.possession ? <p className="text-[13px] text-[var(--color-muted)]">Possession: {row.possession}</p> : null}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3"><ChannelMark channel={row.channel} /><StatusChip status={row.status} /></div>
                  {row.zohoUrl ? <span className="relative z-10"><ZohoLink href={row.zohoUrl} /></span> : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Dash() {
  return <span className="text-[var(--color-muted)]">—</span>;
}

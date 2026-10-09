import Link from "next/link";
import { getPrisma } from "@snapsocial/db";
import { Empty, Notice, PageTitle, Panel } from "@/components/ui";
import { AttentionList, type AttentionItem } from "@/components/overview/attention-list";
import { ChannelStrip, type ChannelState } from "@/components/overview/channel-strip";
import { contactName, IST_ZONE, istDayStart, isTestContact, OFFER_ACCEPTED } from "@/components/reports/ist";
import { KpiTiles, PanelHeading } from "@/components/reports/kpi-tiles";
import { agoIST } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";

const NAMES = { select: { username: true, displayName: true, chosenName: true } } as const;

function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: IST_ZONE, hour: "2-digit", hourCycle: "h23" }).format(now));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function authorWord(author: string, agent: string): string {
  if (author === "PROSPECT") return "Customer";
  if (author === "AI") return agent;
  return "Team";
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const params = await searchParams;
  const { actor, workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Ask a platform owner to grant access." />;
  const db = getPrisma();
  const now = new Date();
  const agent = workspace.agentName || "Assistant";
  const todayStart = istDayStart(now, 0);
  const weekStart = istDayStart(now, 6);
  const monthStart = istDayStart(now, 29);
  const viewer = role === "VIEWER";

  const [newLeads, hotLeads, teamChats, offerNotes, aiToday, connections, zohoStuck] = await Promise.all([
    db.lead.findMany({ where: { workspaceId: workspace.id, archivedAt: null, contactableAt: { gte: todayStart } }, select: { contact: NAMES } }),
    db.lead.findMany({ where: { workspaceId: workspace.id, archivedAt: null, rating: "HOT", createdAt: { gte: monthStart } }, select: { contact: NAMES } }),
    db.conversation.findMany({
      where: { workspaceId: workspace.id, sandbox: false, owner: "HUMAN" },
      select: {
        id: true, channel: true, ownerUserId: true, ownerChangedAt: true, updatedAt: true, contact: NAMES,
        messages: { where: { author: { not: "SYSTEM" } }, orderBy: { createdAt: "desc" }, take: 1, select: { author: true, body: true, createdAt: true } },
      },
    }),
    db.message.findMany({
      where: { workspaceId: workspace.id, author: "SYSTEM", createdAt: { gte: weekStart }, body: { startsWith: "Offer answer: " } },
      select: { conversationId: true, body: true, conversation: { select: { sandbox: true, contact: NAMES } } },
    }),
    db.message.findMany({
      where: { workspaceId: workspace.id, author: "AI", createdAt: { gte: todayStart } },
      select: { conversation: { select: { sandbox: true, contact: NAMES } } },
    }),
    db.channelConnection.findMany({ where: { workspaceId: workspace.id, revokedAt: null }, select: { channel: true, mode: true, displayName: true, username: true, automationPaused: true } }),
    db.lead.count({ where: { workspaceId: workspace.id, archivedAt: null, crmState: { in: ["RETRYING", "NEEDS_ATTENTION"] } } }),
  ]);

  const real = <T extends { contact: Parameters<typeof isTestContact>[0] }>(rows: T[]) => rows.filter((row) => !isTestContact(row.contact));
  const chats = real(teamChats).map((chat) => {
    const last = chat.messages[0] ?? null;
    return { chat, last, at: last?.createdAt ?? chat.ownerChangedAt ?? chat.updatedAt, waiting: last?.author === "PROSPECT" };
  });
  const waiting = chats.filter((item) => item.waiting).length;
  const offers = new Set(
    offerNotes.filter((note) => !note.conversation.sandbox && !isTestContact(note.conversation.contact) && OFFER_ACCEPTED.test(note.body)).map((note) => note.conversationId),
  ).size;
  const repliesToday = aiToday.filter((message) => !message.conversation.sandbox && !isTestContact(message.conversation.contact)).length;

  const newest = [...chats].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 8);
  const ownerIds = [...new Set(newest.map((item) => item.chat.ownerUserId).filter((id): id is string => Boolean(id)))];
  const owners = ownerIds.length && !viewer ? await db.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : [];
  const ownerName = new Map(owners.map((user) => [user.id, user.name]));
  const attention: AttentionItem[] = viewer ? [] : newest.map(({ chat, last, at, waiting: isWaiting }) => ({
    id: chat.id,
    name: contactName(chat.contact),
    channel: chat.channel,
    lastMessage: last?.body.replace(/\s+/g, " ").trim() || "No messages yet",
    lastFrom: last ? authorWord(last.author, agent) : "—",
    ago: agoIST(at, now),
    owner: chat.ownerUserId ? `Taken over by ${ownerName.get(chat.ownerUserId) ?? "a team member"}` : "Handed to team",
    waiting: isWaiting,
  }));

  const channelStates: ChannelState[] = (["INSTAGRAM", "FACEBOOK", "WHATSAPP"] as const).map((channel) => {
    const mine = connections.filter((connection) => connection.channel === channel);
    const live = mine.find((connection) => connection.mode === "INTEGRATION") ?? mine[0] ?? null;
    return {
      channel,
      connected: Boolean(live),
      repliesOn: Boolean(live) && !workspace.automationPaused && mine.some((connection) => !connection.automationPaused),
      practice: live?.mode === "SIMULATION",
      account: live ? (live.username ? `@${live.username.replace(/^@/, "")}` : live.displayName) : null,
    };
  });

  const firstName = actor.name.trim().split(/\s+/)[0] || "there";
  const dateLine = new Intl.DateTimeFormat("en-IN", { timeZone: IST_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  const canManage = role === "ADMIN" || role === "SUPER_ADMIN";

  return (
    <section>
      <PageTitle
        title={workspace.brandName}
        detail={`${greeting(now)}, ${firstName}. ${dateLine}.`}
        action={viewer ? undefined : <Link href="/inbox" className="rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-white hover:bg-black">Open inbox</Link>}
      />
      {params.denied ? <Notice tone="stop">You do not have access to that action.</Notice> : null}

      <KpiTiles items={[
        { label: "New leads today", value: real(newLeads).length, note: "Shared their number" },
        { label: "HOT leads", value: real(hotLeads).length, note: "Last 30 days" },
        { label: "Waiting for the team", value: waiting, note: waiting ? "Customer wrote last" : "Nobody waiting", emphasis: waiting > 0, href: viewer ? undefined : "#needs-attention" },
        { label: "Consultations / visits", value: offers, note: "Requested, last 7 days" },
        { label: `${agent} replies today`, value: repliesToday, note: "Since midnight" },
      ]} />

      {zohoStuck && !viewer ? (
        <p className="mt-3 rounded-xl bg-[#fff6e8] px-3 py-2 text-sm text-[#92400e]">
          {zohoStuck === 1 ? "1 lead has" : `${zohoStuck} leads have`} not reached Zoho yet. <Link href="/leads" className="font-semibold underline underline-offset-2">See leads</Link>
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <div id="needs-attention" className="scroll-mt-6 border-b border-[var(--color-line)] px-4 py-4 sm:px-5">
            <PanelHeading
              title="Needs attention"
              detail={viewer ? "Viewers see totals only." : "Chats the team has taken over, newest first. A gold dot means the customer is waiting for a reply."}
              action={viewer ? undefined : <span className="text-[12px] tabular-nums text-[var(--color-muted)]">{chats.length} with the team</span>}
            />
          </div>
          {viewer ? (
            <p className="px-4 py-6 text-sm text-[var(--color-muted)] sm:px-5">{chats.length} chats are with the team; {waiting} are waiting for a reply.</p>
          ) : attention.length ? (
            <AttentionList items={attention} />
          ) : (
            <p className="px-4 py-8 text-sm text-[var(--color-muted)] sm:px-5">All clear. {agent} is handling every conversation.</p>
          )}
          {!viewer && chats.length > attention.length ? (
            <div className="border-t border-[var(--color-line)] px-4 py-3 text-right sm:px-5">
              <Link href="/inbox" className="text-sm font-medium text-[var(--color-accent-ink)]">See all {chats.length} in the inbox</Link>
            </div>
          ) : null}
        </Panel>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-display)] text-[22px] font-medium tracking-tight">Channels</h2>
            {canManage ? <Link href="/integrations" className="text-sm font-medium text-[var(--color-accent-ink)]">Manage</Link> : null}
          </div>
          <ChannelStrip states={channelStates} className="sm:grid-cols-3 xl:grid-cols-1" />
          {workspace.automationPaused ? <p className="mt-3 text-[12px] text-[var(--color-muted)]">Auto-replies are paused for the whole workspace.</p> : null}
        </div>
      </div>
    </section>
  );
}

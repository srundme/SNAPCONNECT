import { getPrisma } from "@snapsocial/db";
import { chatLanguageSample, languageName, parseLeadQuestions, zonedDay } from "@snapsocial/domain";
import { ChannelMark, Empty, PageTitle, Panel, StatGrid } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

const RANGES = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", all: "All time" } as const;
type RangeKey = keyof typeof RANGES;

function rangeStart(range: RangeKey, now: Date): Date | null {
  if (range === "all") return null;
  if (range === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  return new Date(now.getTime() - (range === "7d" ? 7 : 30) * 86_400_000);
}

function languageGroup(sample: string | null): string {
  if (!sample) return "English";
  const name = languageName(sample);
  if (/^(Tanglish|Tamil)/.test(name)) return "Tamil / Tanglish";
  if (/^(Hinglish|Hindi)/.test(name)) return "Hindi / Hinglish";
  if (/^Telugu/.test(name)) return "Telugu";
  if (/^Kannada/.test(name)) return "Kannada";
  if (/^Malayalam/.test(name)) return "Malayalam";
  if (/^Bengali/.test(name)) return "Bengali";
  return "Other Indian language";
}

function percent(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "–";
}

function seconds(ms: number | null): string {
  if (ms === null) return "–";
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)} min`;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ channel?: string; range?: string }> }) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  const agent = workspace.agentName || "Assistant";
  const db = getPrisma();
  const now = new Date();
  const range: RangeKey = params.range && params.range in RANGES ? (params.range as RangeKey) : "30d";
  const channel: "INSTAGRAM" | "FACEBOOK" | "WHATSAPP" | null = params.channel === "INSTAGRAM" || params.channel === "FACEBOOK" || params.channel === "WHATSAPP" ? params.channel : null;
  const since = rangeStart(range, now);
  const created = since ? { gte: since } : undefined;
  const scope = { workspaceId: workspace.id, ...(channel ? { channel } : {}) };

  const [conversations, leads, openers, media] = await Promise.all([
    db.conversation.findMany({ where: { ...scope, sandbox: false, ...(created ? { createdAt: created } : {}) }, select: { id: true, channel: true, owner: true, sourceMediaId: true, createdAt: true } }),
    db.lead.findMany({ where: { ...scope, ...(created ? { createdAt: created } : {}) }, include: { contact: true } }),
    db.outboundAttempt.findMany({ where: { ...scope, ...(created ? { createdAt: created } : {}) }, select: { status: true } }),
    db.media.findMany({ where: { workspaceId: workspace.id }, select: { externalId: true, caption: true, channel: true } }),
  ]);
  const ids = conversations.map((conversation) => conversation.id);
  const [messages, runs] = await Promise.all([
    ids.length
      ? db.message.findMany({ where: { conversationId: { in: ids } }, orderBy: { createdAt: "asc" }, select: { conversationId: true, author: true, body: true, createdAt: true } })
      : Promise.resolve([]),
    ids.length ? db.aiRun.findMany({ where: { conversationId: { in: ids } }, select: { valid: true, diagnostic: true, simulated: true } }) : Promise.resolve([]),
  ]);

  const byConversation = new Map<string, typeof messages>();
  for (const message of messages) {
    const list = byConversation.get(message.conversationId) ?? [];
    list.push(message);
    byConversation.set(message.conversationId, list);
  }

  const replied = conversations.filter((conversation) => (byConversation.get(conversation.id) ?? []).some((message) => message.author === "PROSPECT"));
  const handedOff = conversations.filter((conversation) => (byConversation.get(conversation.id) ?? []).some((message) => message.author === "STAFF")).length;
  const openersSent = openers.filter((attempt) => attempt.status === "ACCEPTED").length;
  const comments = Math.max(openers.length, leads.filter((lead) => lead.sourceType === "COMMENT").length);
  const phones = leads.filter((lead) => lead.phoneE164).length;
  const zoho = leads.filter((lead) => lead.crmState === "SYNCED");
  const cold = leads.filter((lead) => lead.qualification === "DISQUALIFIED").length;

  const waits: number[] = [];
  let aiReplies = 0;
  let prospectMessages = 0;
  for (const list of byConversation.values()) {
    let pendingSince: Date | null = null;
    for (const message of list) {
      if (message.author === "PROSPECT") {
        prospectMessages += 1;
        pendingSince ??= message.createdAt;
      } else if (message.author === "AI") {
        aiReplies += 1;
        if (pendingSince) {
          const wait = message.createdAt.getTime() - pendingSince.getTime();
          if (wait >= 0 && wait < 600_000) waits.push(wait);
          pendingSince = null;
        }
      }
    }
  }
  const sortedWaits = [...waits].sort((a, b) => a - b);
  const averageWait = waits.length ? waits.reduce((sum, wait) => sum + wait, 0) / waits.length : null;
  const medianWait = sortedWaits.length ? sortedWaits[Math.floor(sortedWaits.length / 2)]! : null;
  const modelReplies = runs.filter((run) => run.valid && !run.simulated).length;
  const fallbacks = runs.filter((run) => !run.valid || /plain-text/i.test(run.diagnostic ?? "")).length;

  const languages = new Map<string, number>();
  for (const conversation of replied) {
    const said = (byConversation.get(conversation.id) ?? []).filter((message) => message.author === "PROSPECT").map((message) => message.body);
    const group = languageGroup(chatLanguageSample(said));
    languages.set(group, (languages.get(group) ?? 0) + 1);
  }
  const languageRows = [...languages.entries()].sort((a, b) => b[1] - a[1]);

  const funnel = [
    { label: "Comments", value: comments },
    { label: "Openers sent", value: openersSent },
    { label: `Replied to ${agent}`, value: replied.length },
    { label: "Shared phone", value: phones },
    { label: "Sent to Zoho", value: zoho.length },
  ];
  const funnelTop = Math.max(1, ...funnel.map((step) => step.value));

  const days = range === "today" ? 1 : range === "7d" ? 7 : 14;
  const trend = Array.from({ length: days }, (_, index) => {
    const date = new Date(now.getTime() - (days - 1 - index) * 86_400_000);
    return { day: zonedDay(date, workspace.timezone), chats: 0, zoho: 0 };
  });
  const trendIndex = new Map(trend.map((row, index) => [row.day, index]));
  for (const conversation of conversations) {
    const index = trendIndex.get(zonedDay(conversation.createdAt, workspace.timezone));
    if (index !== undefined) trend[index]!.chats += 1;
  }
  for (const lead of zoho) {
    const index = trendIndex.get(zonedDay(lead.qualifiedAt ?? lead.updatedAt, workspace.timezone));
    if (index !== undefined) trend[index]!.zoho += 1;
  }
  const trendTop = Math.max(1, ...trend.map((row) => row.chats));

  const captions = new Map(media.map((item) => [item.externalId, { caption: item.caption, channel: item.channel }]));
  const posts = new Map<string, { chats: number; zoho: number }>();
  for (const conversation of conversations) {
    if (!conversation.sourceMediaId) continue;
    const row = posts.get(conversation.sourceMediaId) ?? { chats: 0, zoho: 0 };
    row.chats += 1;
    posts.set(conversation.sourceMediaId, row);
  }
  for (const lead of zoho) {
    if (!lead.sourceMediaId) continue;
    const row = posts.get(lead.sourceMediaId) ?? { chats: 0, zoho: 0 };
    row.zoho += 1;
    posts.set(lead.sourceMediaId, row);
  }
  const topPosts = [...posts.entries()].sort((a, b) => b[1].zoho - a[1].zoho || b[1].chats - a[1].chats).slice(0, 5);

  const channels = (["INSTAGRAM", "FACEBOOK", "WHATSAPP"] as const).map((name) => ({
    name,
    chats: conversations.filter((conversation) => conversation.channel === name).length,
    zoho: zoho.filter((lead) => lead.channel === name).length,
  }));

  const questions = parseLeadQuestions(workspace.leadQuestions);
  const companyId = questions.find((question) => /company/i.test(question.label))?.id;
  const volumeId = questions.find((question) => /volume|month/i.test(question.label))?.id;
  const teamId = questions.find((question) => /team/i.test(question.label))?.id;
  const answer = (lead: (typeof zoho)[number], id: string | undefined) => {
    if (!id || !lead.answers || typeof lead.answers !== "object" || Array.isArray(lead.answers)) return "–";
    const value = (lead.answers as Record<string, unknown>)[id];
    return typeof value === "string" && value.trim() ? value : "–";
  };
  const recent = [...zoho].sort((a, b) => (b.qualifiedAt ?? b.updatedAt).getTime() - (a.qualifiedAt ?? a.updatedAt).getTime()).slice(0, 6);

  const link = (next: { channel?: string | null; range?: string }) => {
    const query = new URLSearchParams();
    const nextChannel = next.channel === undefined ? channel : next.channel;
    if (nextChannel) query.set("channel", nextChannel);
    query.set("range", next.range ?? range);
    return `/reports?${query.toString()}`;
  };
  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 ${active ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-line)] bg-white hover:bg-[var(--color-paper)]"}`;

  return (
    <section>
      <PageTitle title="Reports" detail="How comments turn into conversations and Zoho leads. Counts are channel contacts, so one person on both Instagram and Facebook counts twice." />
      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
        {(Object.keys(RANGES) as RangeKey[]).map((key) => (
          <a key={key} href={link({ range: key })} className={pill(range === key)}>{RANGES[key]}</a>
        ))}
        <span className="mx-2 h-5 w-px bg-[var(--color-line)]" />
        <a href={link({ channel: null })} className={pill(!channel)}>All channels</a>
        <a href={link({ channel: "INSTAGRAM" })} className={pill(channel === "INSTAGRAM")}>Instagram</a>
        <a href={link({ channel: "FACEBOOK" })} className={pill(channel === "FACEBOOK")}>Facebook</a>
        <a href={link({ channel: "WHATSAPP" })} className={pill(channel === "WHATSAPP")}>WhatsApp</a>
      </div>

      <StatGrid columns={5} items={[
        { label: "Comments", value: comments },
        { label: "Conversations", value: replied.length },
        { label: "Sent to Zoho", value: zoho.length },
        { label: "Comment to lead", value: percent(zoho.length, comments) },
        { label: `${agent} reply time`, value: seconds(medianWait) },
      ]} />
      <div className="mt-3">
        <StatGrid columns={5} items={[
          { label: "Phones collected", value: phones },
          { label: "Not interested", value: cold },
          { label: "Handed to team", value: handedOff },
          { label: "Messages from people", value: prospectMessages },
          { label: `Replies by ${agent}`, value: aiReplies },
        ]} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <h2 className="text-[15px] font-semibold">Funnel</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">From a comment to a lead in Zoho.</p>
          <div className="mt-4 space-y-3">
            {funnel.map((step, index) => (
              <div key={step.label}>
                <div className="flex justify-between text-sm">
                  <span>{step.label}</span>
                  <span className="font-semibold">
                    {step.value}
                    {index > 0 ? <span className="ml-2 font-normal text-[var(--color-muted)]">{percent(step.value, funnel[0]!.value)}</span> : null}
                  </span>
                </div>
                <div className="mt-1 h-2.5 rounded-full bg-[var(--color-paper)]">
                  <div className="h-2.5 rounded-full bg-[var(--color-accent)]" style={{ width: `${Math.max(2, (step.value / funnelTop) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="p-5">
          <h2 className="text-[15px] font-semibold">Daily activity</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">Conversations started, with Zoho leads in dark teal.</p>
          <div className="mt-4 flex h-40 items-end gap-1.5">
            {trend.map((row) => (
              <div key={row.day} className="flex flex-1 flex-col items-center gap-1" title={`${row.day}: ${row.chats} conversations, ${row.zoho} Zoho leads`}>
                <div className="relative flex w-full flex-1 items-end">
                  <div className="flex w-full flex-col justify-end overflow-hidden rounded-t-md bg-[#cfe9e6]" style={{ height: `${(row.chats / trendTop) * 100}%` }}>
                    <div className="w-full bg-[var(--color-accent-ink)]" style={{ height: row.chats ? `${(Math.min(row.zoho, row.chats) / row.chats) * 100}%` : 0 }} />
                  </div>
                </div>
                <span className="text-[10px] text-[var(--color-muted)]">{row.day.slice(8)}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="p-5">
          <h2 className="text-[15px] font-semibold">Languages people used</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{agent} replies in the same language and style.</p>
          {languageRows.length ? (
            <div className="mt-4 space-y-3">
              {languageRows.map(([name, count]) => (
                <div key={name}>
                  <div className="flex justify-between text-sm"><span>{name}</span><span className="font-semibold">{count} <span className="ml-1 font-normal text-[var(--color-muted)]">{percent(count, replied.length)}</span></span></div>
                  <div className="mt-1 h-2.5 rounded-full bg-[var(--color-paper)]">
                    <div className="h-2.5 rounded-full bg-[var(--color-accent)]" style={{ width: `${(count / replied.length) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="mt-4 text-sm text-[var(--color-muted)]">No conversations in this range yet.</p>}
        </Panel>

        <Panel className="p-5">
          <h2 className="text-[15px] font-semibold">{agent} performance</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">Speed and reliability of the AI replies.</p>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-[var(--color-muted)]">Median reply time</dt><dd className="mt-1 text-[22px] font-semibold">{seconds(medianWait)}</dd></div>
            <div><dt className="text-[var(--color-muted)]">Average reply time</dt><dd className="mt-1 text-[22px] font-semibold">{seconds(averageWait)}</dd></div>
            <div><dt className="text-[var(--color-muted)]">Replies from the AI model</dt><dd className="mt-1 text-[22px] font-semibold">{percent(modelReplies, runs.length)}</dd></div>
            <div><dt className="text-[var(--color-muted)]">Fallback replies</dt><dd className="mt-1 text-[22px] font-semibold">{fallbacks}</dd></div>
          </dl>
          <div className="mt-5 border-t border-[var(--color-line)] pt-4">
            <h3 className="text-sm font-semibold">By channel</h3>
            <div className="mt-2 space-y-2 text-sm">
              {channels.map((row) => (
                <div key={row.name} className="flex items-center justify-between">
                  <ChannelMark channel={row.name} />
                  <span>{row.chats} conversations · <span className="font-semibold">{row.zoho} Zoho leads</span> · {percent(row.zoho, row.chats)}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <Panel className="mt-4 p-5">
        <h2 className="text-[15px] font-semibold">Top posts</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">Posts that started the most conversations and leads.</p>
        {topPosts.length ? (
          <table className="mt-3 w-full text-sm">
            <thead><tr className="text-left text-[12px] uppercase tracking-[0.04em] text-[var(--color-muted)]"><th className="py-2 font-semibold">Post</th><th className="font-semibold">Channel</th><th className="text-right font-semibold">Conversations</th><th className="text-right font-semibold">Zoho leads</th></tr></thead>
            <tbody>
              {topPosts.map(([id, row]) => {
                const post = captions.get(id);
                return (
                  <tr key={id} className="border-t border-[var(--color-line)]">
                    <td className="max-w-md truncate py-2 pr-3">{post?.caption?.replace(/\s+/g, " ").slice(0, 90) || "Post without caption"}</td>
                    <td>{post ? <ChannelMark channel={post.channel} /> : "–"}</td>
                    <td className="text-right">{row.chats}</td>
                    <td className="text-right font-semibold">{row.zoho}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="mt-3 text-sm text-[var(--color-muted)]">No post activity in this range yet.</p>}
      </Panel>

      <Panel className="mt-4 p-5">
        <h2 className="text-[15px] font-semibold">Latest leads sent to Zoho</h2>
        {recent.length ? (
          <table className="mt-3 w-full text-sm">
            <thead><tr className="text-left text-[12px] uppercase tracking-[0.04em] text-[var(--color-muted)]"><th className="py-2 font-semibold">Name</th><th className="font-semibold">Company</th><th className="font-semibold">Team</th><th className="font-semibold">Calls a month</th><th className="font-semibold">Channel</th><th className="text-right font-semibold">When</th></tr></thead>
            <tbody>
              {recent.map((lead) => (
                <tr key={lead.id} className="border-t border-[var(--color-line)]">
                  <td className="py-2 font-medium">{lead.contact.chosenName ?? "–"}</td>
                  <td>{answer(lead, companyId)}</td>
                  <td>{answer(lead, teamId)}</td>
                  <td>{answer(lead, volumeId)}</td>
                  <td><ChannelMark channel={lead.channel} /></td>
                  <td className="text-right text-[var(--color-muted)]">{(lead.qualifiedAt ?? lead.updatedAt).toLocaleString("en-IN", { timeZone: workspace.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="mt-3 text-sm text-[var(--color-muted)]">No Zoho leads in this range yet.</p>}
      </Panel>
    </section>
  );
}

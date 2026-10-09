import { getPrisma } from "@snapsocial/db";
import { chatLanguageSample, languageName, parseLeadQuestions } from "@snapsocial/domain";
import { ChannelMark, Empty, PageTitle, Panel } from "@/components/ui";
import { DailyChart, type DayRow } from "@/components/reports/daily-chart";
import { FilterGroup } from "@/components/reports/filters";
import { Funnel } from "@/components/reports/funnel";
import { contactName, duration, istDateLabel, istDay, istDayStart, istDays, isTestContact, OFFER_ACCEPTED, percentOf } from "@/components/reports/ist";
import { KpiTiles, PanelHeading } from "@/components/reports/kpi-tiles";
import { LeadsTable, type LeadRow } from "@/components/reports/leads-table";
import { whenIST } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";

const RANGES = { today: "Today", "7d": "7 days", "30d": "30 days", all: "All time" } as const;
type RangeKey = keyof typeof RANGES;
type ChannelKey = "INSTAGRAM" | "FACEBOOK" | "WHATSAPP";

/** Start of the range in India days: today, the last 7 India days including today, the last 30, or everything. */
function rangeStart(range: RangeKey, now: Date): Date | null {
  if (range === "all") return null;
  return istDayStart(now, range === "today" ? 0 : range === "7d" ? 6 : 29);
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

const NAMES = { select: { username: true, displayName: true, chosenName: true } } as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ channel?: string; range?: string }> }) {
  const params = await searchParams;
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  const agent = workspace.agentName || "Assistant";
  const db = getPrisma();
  const now = new Date();
  const today = istDay(now);
  const range: RangeKey = params.range && params.range in RANGES ? (params.range as RangeKey) : "30d";
  const channel: ChannelKey | null = params.channel === "INSTAGRAM" || params.channel === "FACEBOOK" || params.channel === "WHATSAPP" ? params.channel : null;
  const since = rangeStart(range, now);
  const scope = { workspaceId: workspace.id, ...(channel ? { channel } : {}) };

  // The daily chart always shows whole India days: 7 for Today / 7 days, 30 for 30 days / All time.
  const chartDays = range === "30d" || range === "all" ? 30 : 7;
  const chartStart = istDayStart(now, chartDays - 1);
  const fetchFrom = since === null ? null : since < chartStart ? since : chartStart;

  const [conversationRows, attemptRows, media] = await Promise.all([
    db.conversation.findMany({
      where: { ...scope, sandbox: false, ...(fetchFrom ? { createdAt: { gte: fetchFrom } } : {}) },
      select: { id: true, channel: true, owner: true, contactId: true, sourceMediaId: true, createdAt: true, contact: NAMES },
    }),
    db.outboundAttempt.findMany({ where: { ...scope, ...(since ? { createdAt: { gte: since } } : {}) }, select: { status: true, contactId: true, conversationId: true } }),
    db.media.findMany({ where: { workspaceId: workspace.id }, select: { externalId: true, caption: true, channel: true } }),
  ]);

  const real = conversationRows.filter((conversation) => !isTestContact(conversation.contact));
  const conversations = since ? real.filter((conversation) => conversation.createdAt >= since) : real;
  const ids = conversations.map((conversation) => conversation.id);
  const contactIds = [...new Set(conversations.map((conversation) => conversation.contactId))];

  const [leadRows, messages, runs, attemptContacts] = await Promise.all([
    db.lead.findMany({
      where: {
        ...scope,
        archivedAt: null,
        ...(range === "all" ? {} : { OR: [{ contactId: { in: contactIds } }, { crmState: "SYNCED", updatedAt: { gte: chartStart } }] }),
      },
      select: {
        id: true, contactId: true, channel: true, phoneE164: true, whatsappE164: true, qualification: true, crmState: true, rating: true,
        answers: true, city: true, propertyType: true, contactableAt: true, qualifiedAt: true, updatedAt: true, contact: NAMES,
      },
    }),
    ids.length
      ? db.message.findMany({ where: { conversationId: { in: ids } }, orderBy: { createdAt: "asc" }, select: { conversationId: true, author: true, body: true, createdAt: true } })
      : Promise.resolve([]),
    ids.length ? db.aiRun.findMany({ where: { conversationId: { in: ids } }, select: { valid: true, diagnostic: true, simulated: true } }) : Promise.resolve([]),
    attemptRows.length
      ? db.contact.findMany({ where: { id: { in: [...new Set(attemptRows.map((attempt) => attempt.contactId))] } }, select: { id: true, username: true, displayName: true, chosenName: true } })
      : Promise.resolve([]),
  ]);
  const leads = leadRows.filter((lead) => !isTestContact(lead.contact));

  // When a lead reached Zoho: the moment it became ready under this workspace's rule, else its last update.
  const sentAt = (lead: (typeof leads)[number]) =>
    (workspace.zohoSendWhen === "QUALIFIED" ? lead.qualifiedAt : lead.contactableAt ?? lead.qualifiedAt) ?? lead.updatedAt;

  const leadsByContact = new Map<string, typeof leads>();
  for (const lead of leads) {
    const list = leadsByContact.get(lead.contactId) ?? [];
    list.push(lead);
    leadsByContact.set(lead.contactId, list);
  }
  const byConversation = new Map<string, typeof messages>();
  for (const message of messages) {
    const list = byConversation.get(message.conversationId) ?? [];
    list.push(message);
    byConversation.set(message.conversationId, list);
  }

  // Each conversation started in the range, and how far it got. All funnel steps count these same conversations.
  const journeys = conversations.map((conversation) => {
    const own = leadsByContact.get(conversation.contactId) ?? [];
    const said = byConversation.get(conversation.id) ?? [];
    return {
      conversation,
      replied: said.some((message) => message.author === "PROSPECT"),
      details: own.some((lead) => Boolean(lead.phoneE164 || lead.whatsappE164)),
      qualified: own.some((lead) => lead.qualification === "QUALIFIED"),
      zoho: own.some((lead) => lead.crmState === "SYNCED"),
      hot: own.some((lead) => lead.rating === "HOT"),
      offer: said.some((message) => message.author === "SYSTEM" && OFFER_ACCEPTED.test(message.body)),
      handed: conversation.owner === "HUMAN" || said.some((message) => message.author === "STAFF"),
    };
  });
  const count = (key: "replied" | "details" | "qualified" | "zoho" | "hot" | "offer" | "handed") => journeys.filter((journey) => journey[key]).length;
  const started = journeys.length;
  const zohoCount = count("zoho");
  const offers = count("offer");

  // Reply time: unchanged calculation — first unanswered customer message to the next AI reply, under 10 minutes.
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

  // From comments: openers sent in the range, and how many of those people wrote back in DMs.
  const testContacts = new Set(attemptContacts.filter((contact) => isTestContact(contact)).map((contact) => contact.id));
  const attempts = attemptRows.filter((attempt) => !testContacts.has(attempt.contactId));
  const delivered = attempts.filter((attempt) => attempt.status === "ACCEPTED");
  const openerConversations = [...new Set(delivered.map((attempt) => attempt.conversationId).filter((id): id is string => Boolean(id)))];
  const answered = openerConversations.length
    ? await db.message.findMany({ where: { conversationId: { in: openerConversations }, author: "PROSPECT" }, select: { conversationId: true }, distinct: ["conversationId"] })
    : [];
  const answeredSet = new Set(answered.map((message) => message.conversationId));
  const openerReplies = delivered.filter((attempt) => attempt.conversationId && answeredSet.has(attempt.conversationId)).length;

  const languages = new Map<string, number>();
  for (const journey of journeys) {
    if (!journey.replied) continue;
    const said = (byConversation.get(journey.conversation.id) ?? []).filter((message) => message.author === "PROSPECT").map((message) => message.body);
    const group = languageGroup(chatLanguageSample(said));
    languages.set(group, (languages.get(group) ?? 0) + 1);
  }
  const languageRows = [...languages.entries()].sort((a, b) => b[1] - a[1]);
  const repliedCount = count("replied");

  // Daily chart, India days.
  const trend: DayRow[] = istDays(now, chartDays).map((day) => ({ day, chats: 0, zoho: 0 }));
  const trendIndex = new Map(trend.map((row, index) => [row.day, index]));
  for (const conversation of real) {
    const index = trendIndex.get(istDay(conversation.createdAt));
    if (index !== undefined) trend[index]!.chats += 1;
  }
  for (const lead of leads) {
    if (lead.crmState !== "SYNCED") continue;
    const index = trendIndex.get(istDay(sentAt(lead)));
    if (index !== undefined) trend[index]!.zoho += 1;
  }

  const captions = new Map(media.map((item) => [item.externalId, { caption: item.caption, channel: item.channel }]));
  const posts = new Map<string, { chats: number; zoho: number }>();
  for (const journey of journeys) {
    const mediaId = journey.conversation.sourceMediaId;
    if (!mediaId) continue;
    const row = posts.get(mediaId) ?? { chats: 0, zoho: 0 };
    row.chats += 1;
    if (journey.zoho) row.zoho += 1;
    posts.set(mediaId, row);
  }
  const topPosts = [...posts.entries()].sort((a, b) => b[1].zoho - a[1].zoho || b[1].chats - a[1].chats).slice(0, 5);

  const channels = (["INSTAGRAM", "FACEBOOK", "WHATSAPP"] as const).map((name) => {
    const mine = journeys.filter((journey) => journey.conversation.channel === name);
    return { name, chats: mine.length, zoho: mine.filter((journey) => journey.zoho).length };
  });

  // Latest Zoho leads from these conversations. Answers are read by question label, as the team words them.
  const questions = parseLeadQuestions(workspace.leadQuestions);
  const homeId = questions.find((question) => /\bbhk\b/i.test(question.label))?.id;
  const areaId = (questions.find((question) => /where is the home/i.test(question.label))
    ?? questions.find((question) => /\b(project|locality|location)\b/i.test(question.label)))?.id;
  const answer = (value: unknown, id: string | undefined): string | null => {
    if (!id || !value || typeof value !== "object" || Array.isArray(value)) return null;
    const text = (value as Record<string, unknown>)[id];
    return typeof text === "string" && text.trim() ? text.trim() : null;
  };
  const cohortContacts = new Set(contactIds);
  const recentLeads: LeadRow[] = leads
    .filter((lead) => lead.crmState === "SYNCED" && cohortContacts.has(lead.contactId))
    .sort((a, b) => sentAt(b).getTime() - sentAt(a).getTime())
    .slice(0, 8)
    .map((lead) => ({
      id: lead.id,
      name: contactName(lead.contact),
      channel: lead.channel,
      home: answer(lead.answers, homeId) ?? lead.propertyType ?? "–",
      area: answer(lead.answers, areaId) ?? lead.city ?? "–",
      rating: lead.rating,
      when: whenIST(sentAt(lead), now),
    }));

  const link = (next: { channel?: string | null; range?: string }) => {
    const query = new URLSearchParams();
    const nextChannel = next.channel === undefined ? channel : next.channel;
    if (nextChannel) query.set("channel", nextChannel);
    query.set("range", next.range ?? range);
    return `/reports?${query.toString()}`;
  };
  const span = since
    ? range === "today" ? `Today, ${istDateLabel(today, true)}` : `${istDateLabel(istDay(since))} – ${istDateLabel(today, true)}`
    : "Since the first conversation";

  return (
    <section>
      <PageTitle
        title="Reports"
        detail="Every number below follows the conversations that started in the chosen period, in India time. One person on two channels counts as two conversations."
      />
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <FilterGroup label="Period" options={(Object.keys(RANGES) as RangeKey[]).map((key) => ({ key, label: RANGES[key], href: link({ range: key }), active: range === key }))} />
        <FilterGroup label="Channel" options={[
          { key: "all", label: "All channels", href: link({ channel: null }), active: !channel },
          { key: "INSTAGRAM", label: "Instagram", href: link({ channel: "INSTAGRAM" }), active: channel === "INSTAGRAM" },
          { key: "FACEBOOK", label: "Facebook", href: link({ channel: "FACEBOOK" }), active: channel === "FACEBOOK" },
          { key: "WHATSAPP", label: "WhatsApp", href: link({ channel: "WHATSAPP" }), active: channel === "WHATSAPP" },
        ]} />
        <span className="text-[12px] text-[var(--color-muted)] sm:ml-auto">{span}</span>
      </div>

      <KpiTiles items={[
        { label: "Conversations", value: started, note: `${repliedCount} replied to ${agent}` },
        { label: "Leads in Zoho", value: zohoCount, note: started ? `${percentOf(zohoCount, started)} of conversations` : undefined, emphasis: true },
        { label: "HOT leads", value: count("hot"), note: "Rated hot" },
        { label: "Consultations / visits", value: offers, note: "Asked for one" },
        { label: "Median reply time", value: duration(medianWait), note: `${agent}, first reply` },
        { label: "Handed to team", value: count("handed"), note: "Staff took part" },
      ]} />

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Panel className="p-5 lg:col-span-3">
          <PanelHeading title="Funnel" detail={`From the first message to a visit request. Each share is of the ${started} conversations started.`} />
          <Funnel steps={[
            { label: "Conversations started", value: started },
            { label: "Details shared", value: count("details"), note: "Gave a phone or WhatsApp number" },
            { label: "Qualified", value: count("qualified"), note: "Answered every must-have question" },
            { label: "Sent to Zoho", value: zohoCount },
            { label: "Consultation / experience centre requested", value: offers, note: `Said yes when ${agent} offered a free consultation or a visit` },
          ]} />
        </Panel>

        <Panel className="p-5 lg:col-span-2">
          <PanelHeading title="From comments" detail="Openers sent to people who commented on a post, in this period." />
          <dl className="mt-5 divide-y divide-[var(--color-line)] text-sm">
            {[
              { label: "Comments answered", value: attempts.length, share: null },
              { label: "Openers delivered", value: delivered.length, share: percentOf(delivered.length, attempts.length) },
              { label: "Replied in messages", value: openerReplies, share: percentOf(openerReplies, attempts.length) },
            ].map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3 py-2.5">
                <dt>{row.label}</dt>
                <dd className="tabular-nums">
                  <span className="text-[17px] font-semibold">{row.value}</span>
                  <span className="ml-2 inline-block w-10 text-right text-[12px] text-[var(--color-muted)]">{row.share ?? ""}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[12px] text-[var(--color-muted)]">Shares are of comments answered. People who write to you directly on WhatsApp or in DMs are counted in the funnel, not here.</p>
        </Panel>
      </div>

      <Panel className="mt-4 p-5">
        <PanelHeading
          title="Daily activity"
          detail={`Last ${chartDays} days in India time. Pale bars are conversations started; gold bars are leads sent to Zoho that day.`}
        />
        <DailyChart rows={trend} today={today} />
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <PanelHeading title="Languages people used" detail={`${agent} replies in the same language and style. Share of the ${repliedCount} people who replied.`} />
          {languageRows.length ? (
            <div className="mt-4 space-y-3">
              {languageRows.map(([name, value]) => (
                <div key={name}>
                  <div className="flex justify-between text-sm"><span>{name}</span><span className="tabular-nums font-semibold">{value} <span className="ml-1 font-normal text-[var(--color-muted)]">{percentOf(value, repliedCount)}</span></span></div>
                  <div className="mt-1 h-2 rounded-full bg-[var(--color-paper)]">
                    <div className="h-2 rounded-full bg-[var(--color-accent)]" style={{ width: `${(value / repliedCount) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="mt-4 text-sm text-[var(--color-muted)]">No replies in this period yet.</p>}
        </Panel>

        <Panel className="p-5">
          <PanelHeading title={`${agent} at work`} detail="Speed and reliability of the assistant's replies." />
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-[var(--color-muted)]">Median reply time</dt><dd className="mt-1 text-[22px] font-semibold tabular-nums">{duration(medianWait)}</dd></div>
            <div><dt className="text-[var(--color-muted)]">Average reply time</dt><dd className="mt-1 text-[22px] font-semibold tabular-nums">{duration(averageWait)}</dd></div>
            <div><dt className="text-[var(--color-muted)]">Messages from people</dt><dd className="mt-1 text-[22px] font-semibold tabular-nums">{prospectMessages}</dd></div>
            <div><dt className="text-[var(--color-muted)]">Replies by {agent}</dt><dd className="mt-1 text-[22px] font-semibold tabular-nums">{aiReplies}</dd></div>
            <div><dt className="text-[var(--color-muted)]">Written by the AI model</dt><dd className="mt-1 text-[22px] font-semibold tabular-nums">{percentOf(modelReplies, runs.length)}</dd></div>
            <div><dt className="text-[var(--color-muted)]">Fallback replies</dt><dd className="mt-1 text-[22px] font-semibold tabular-nums">{fallbacks}</dd></div>
          </dl>
          <div className="mt-5 border-t border-[var(--color-line)] pt-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">By channel</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {channels.map((row) => (
                <li key={row.name} className="flex flex-wrap items-center justify-between gap-2">
                  <ChannelMark channel={row.name} />
                  <span className="tabular-nums">{row.chats} conversations · <span className="font-semibold">{row.zoho} in Zoho</span> <span className="text-[var(--color-muted)]">{percentOf(row.zoho, row.chats)}</span></span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>

      <Panel className="mt-4 p-5">
        <PanelHeading title="Top posts" detail="Posts whose comments started the most conversations and Zoho leads." />
        {topPosts.length ? (
          <ol className="mt-3 divide-y divide-[var(--color-line)]">
            {topPosts.map(([id, row], index) => {
              const post = captions.get(id);
              const caption = post?.caption?.replace(/\s+/g, " ").trim() || "Post without a caption";
              return (
                <li key={id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="mt-0.5 w-4 shrink-0 text-[12px] tabular-nums text-[var(--color-muted)]">{index + 1}</span>
                    <p className="line-clamp-2 min-w-0 text-sm" title={caption}>{caption}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 pl-7 text-sm tabular-nums sm:pl-0">
                    {post ? <ChannelMark channel={post.channel} /> : null}
                    <span><span className="font-semibold">{row.chats}</span> <span className="text-[var(--color-muted)]">conversations</span></span>
                    <span><span className="font-semibold">{row.zoho}</span> <span className="text-[var(--color-muted)]">in Zoho</span></span>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <p className="mt-3 text-sm text-[var(--color-muted)]">No post activity in this period yet.</p>}
      </Panel>

      {role === "VIEWER" ? null : (
        <Panel className="mt-4 p-5">
          <PanelHeading title="Latest leads in Zoho" detail="The most recent leads from conversations in this period." />
          {recentLeads.length ? <LeadsTable rows={recentLeads} /> : <p className="mt-3 text-sm text-[var(--color-muted)]">No Zoho leads in this period yet.</p>}
        </Panel>
      )}
    </section>
  );
}

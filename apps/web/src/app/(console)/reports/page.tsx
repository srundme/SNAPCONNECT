import { getPrisma } from "@snapsocial/db";
import { chatLanguageSample, languageName, parseAgentSettings, parseLeadQuestions, screenLead } from "@snapsocial/domain";
import { ChannelMark, Empty, PageTitle, Panel } from "@/components/ui";
import { BarList, Figure, RATING_COLORS, StackedBar, SubHeading } from "@/components/reports/bars";
import { DailyChart, type DayRow } from "@/components/reports/daily-chart";
import { FilterGroup } from "@/components/reports/filters";
import { areaKey, asksPrice, HOME_BUCKETS, homeBucket, hoursLabel, median, officeClock, POSSESSION_BUCKETS, possessionBucket, shortQuestion, titleCase } from "@/components/reports/insights";
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
/** Conversations loaded per page view; enough for a busy month, and keeps the page quick. */
const CONVERSATION_CAP = 5000;
/** Rough minutes a person would spend reading and typing one reply. An estimate, labelled as one. */
const MINUTES_PER_REPLY = 1.5;

/** Lead answers as text, keyed by question id. */
function answerMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(value as Record<string, unknown>)) if (typeof text === "string" && text.trim()) out[key] = text.trim();
  return out;
}

function increment(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

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
      orderBy: { createdAt: "desc" },
      take: CONVERSATION_CAP,
      select: { id: true, channel: true, owner: true, ownerUserId: true, contactId: true, sourceMediaId: true, createdAt: true, contact: NAMES },
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
      ? db.message.findMany({ where: { conversationId: { in: ids } }, orderBy: { createdAt: "asc" }, select: { conversationId: true, author: true, body: true, staffUserId: true, createdAt: true } })
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
      said,
      lead: own.find((lead) => lead.channel === conversation.channel) ?? null,
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
  const posts = new Map<string, { chats: number; zoho: number; hot: number }>();
  for (const journey of journeys) {
    const mediaId = journey.conversation.sourceMediaId;
    if (!mediaId) continue;
    const row = posts.get(mediaId) ?? { chats: 0, zoho: 0, hot: 0 };
    row.chats += 1;
    if (journey.zoho) row.zoho += 1;
    if (journey.hot) row.hot += 1;
    posts.set(mediaId, row);
  }
  const topPosts = [...posts.entries()].sort((a, b) => b[1].zoho - a[1].zoho || b[1].hot - a[1].hot || b[1].chats - a[1].chats).slice(0, 5);

  const channels = (["INSTAGRAM", "FACEBOOK", "WHATSAPP"] as const).map((name) => {
    const mine = journeys.filter((journey) => journey.conversation.channel === name);
    return { name, chats: mine.length, zoho: mine.filter((journey) => journey.zoho).length, hot: mine.filter((journey) => journey.hot).length };
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


  // ---- Value from the assistant: replies sent while the office was closed, and the team time they stand in for.
  const settings = parseAgentSettings(workspace.agentSettings);
  const closed = officeClock(settings.workingHours);
  const aiClosed = closed ? messages.filter((message) => message.author === "AI" && closed(message.createdAt)).length : null;
  const startedClosed = closed ? conversations.filter((conversation) => closed(conversation.createdAt)).length : null;
  const minutesSaved = aiReplies * MINUTES_PER_REPLY;

  // ---- Lead quality: one lead per conversation (the lead on the same channel), so shares are of leads from these conversations.
  const cohortLeads = [...new Map(journeys.flatMap((journey) => (journey.lead ? [[journey.lead.id, journey.lead] as const] : []))).values()];
  const ratingCount = (rating: "HOT" | "JUNK" | null) =>
    cohortLeads.filter((lead) => (rating ? lead.rating === rating : lead.rating !== "HOT" && lead.rating !== "JUNK")).length;
  const hotLeads = ratingCount("HOT");
  const junkLeads = ratingCount("JUNK");
  const unratedLeads = ratingCount(null);
  const hotByChannel = (["INSTAGRAM", "FACEBOOK", "WHATSAPP"] as const).map((name) => {
    const mine = cohortLeads.filter((lead) => lead.channel === name);
    return { name, leads: mine.length, hot: mine.filter((lead) => lead.rating === "HOT").length };
  }).filter((row) => row.leads > 0);

  // ---- Where people stop: the first must-have question still open, for people who replied but did not qualify.
  const required = questions.filter((question) => question.required !== false);
  const shortByLabel = new Map(questions.map((question) => [question.label, shortQuestion(question)]));
  const stops = new Map<string, number>();
  let neverReplied = 0;
  for (const journey of journeys) {
    if (journey.qualified) continue;
    if (!journey.replied) {
      neverReplied += 1;
      continue;
    }
    const screen = screenLead({
      questions: required,
      answers: answerMap(journey.lead?.answers),
      name: journey.conversation.contact?.chosenName ?? null,
      phoneE164: journey.lead?.phoneE164 ?? null,
    });
    const first = screen.missing[0];
    increment(stops, first ? shortByLabel.get(first) ?? first : screen.cold ? "Said not interested" : "Answered all, not marked qualified");
  }
  const stopRows = [...stops.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, muted: label === "Said not interested" || label.startsWith("Answered all") }));
  const stoppedTotal = stopRows.reduce((sum, row) => sum + row.value, 0);

  // ---- Homes and projects, read from the answers by question label.
  const possessionId = questions.find((question) => /possession/i.test(question.label))?.id;
  const homes = new Map<string, number>(HOME_BUCKETS.map((bucket) => [bucket, 0]));
  const areas = new Map<string, number>();
  const possession = new Map<string, number>(POSSESSION_BUCKETS.map((bucket) => [bucket, 0]));
  for (const lead of cohortLeads) {
    increment(homes, homeBucket(answer(lead.answers, homeId) ?? lead.propertyType));
    const key = areaKey(answer(lead.answers, areaId) ?? lead.city);
    if (key) increment(areas, key);
    increment(possession, possessionBucket(answer(lead.answers, possessionId), now));
  }
  const homeRows = HOME_BUCKETS.map((bucket) => ({ label: bucket, value: homes.get(bucket) ?? 0, muted: bucket === "Not given" || bucket === "Other answer" })).filter((row) => row.value > 0 || (row.label !== "Under 3 BHK" && row.label !== "Other answer"));
  const areaGiven = [...areas.values()].reduce((sum, value) => sum + value, 0);
  const areaRows = [...areas.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([key, value]) => ({ label: titleCase(key), value }));
  const possessionRows = POSSESSION_BUCKETS.map((bucket) => ({
    label: bucket,
    value: possession.get(bucket) ?? 0,
    muted: bucket === "Not given" || bucket === "Unclear",
    note: bucket === "Ready now" ? "Keys in hand or possession done" : bucket === "Later" ? "Under construction, next year, or a date more than 6 months away" : undefined,
  })).filter((row) => row.value > 0 || row.label !== "Unclear");

  // ---- Meetings requested: each conversation counted once, by its strongest answer to the offer.
  let wantsExperience = 0;
  let wantsConsultation = 0;
  let notNow = 0;
  let qualifiedAsked = 0;
  for (const journey of journeys) {
    const answers = journey.said.filter((message) => message.author === "SYSTEM" && message.body.startsWith("Offer answer: ")).map((message) => message.body);
    if (answers.some((body) => body.startsWith("Offer answer: experience"))) wantsExperience += 1;
    else if (answers.some((body) => body.startsWith("Offer answer: consultation"))) wantsConsultation += 1;
    else if (answers.some((body) => body.startsWith("Offer answer: not_now"))) notNow += 1;
    if (journey.qualified && journey.offer) qualifiedAsked += 1;
  }
  const qualifiedCount = count("qualified");

  // ---- Price questions, and whether those people still shared a phone number afterwards.
  let priceAsked = 0;
  let pricePushed = 0;
  let phoneAfter = 0;
  let phoneBefore = 0;
  for (const journey of journeys) {
    const said = journey.said.filter((message) => message.author === "PROSPECT");
    const askedAt = said.findIndex((message) => asksPrice(message.body));
    if (askedAt === -1) continue;
    priceAsked += 1;
    if (journey.said.some((message) => message.author === "SYSTEM" && message.body.startsWith("Situation: price-push"))) pricePushed += 1;
    if (!journey.lead?.phoneE164) continue;
    const phoneAt = said.findIndex((message) => message.body.replace(/\D/g, "").length >= 10);
    if (phoneAt !== -1 && phoneAt < askedAt) phoneBefore += 1;
    else phoneAfter += 1;
  }
  const priceStopped = priceAsked - phoneAfter - phoneBefore;

  // ---- Team: who took chats over, what they sent, and how quickly they answered. Admins only.
  const showTeam = role === "ADMIN" || role === "SUPER_ADMIN";
  type TeamRow = { takenOver: number; chats: Set<string>; sent: number; waits: number[] };
  const team = new Map<string, TeamRow>();
  const teamRow = (id: string) => {
    const row = team.get(id) ?? { takenOver: 0, chats: new Set<string>(), sent: 0, waits: [] };
    team.set(id, row);
    return row;
  };
  if (showTeam) {
    for (const journey of journeys) {
      const { conversation } = journey;
      if (conversation.ownerUserId) teamRow(conversation.ownerUserId).takenOver += 1;
      let pendingSince: Date | null = null;
      for (const message of journey.said) {
        if (message.author === "PROSPECT") pendingSince ??= message.createdAt;
        else if (message.author === "AI") pendingSince = null;
        else if (message.author === "STAFF") {
          const row = teamRow(message.staffUserId ?? conversation.ownerUserId ?? "unknown");
          row.sent += 1;
          row.chats.add(conversation.id);
          if (pendingSince) row.waits.push(Math.max(0, message.createdAt.getTime() - pendingSince.getTime()));
          pendingSince = null;
        }
      }
    }
  }
  const teamIds = [...team.keys()].filter((id) => id !== "unknown");
  const people = showTeam && teamIds.length ? await db.user.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true, email: true } }) : [];
  const personName = new Map(people.map((person) => [person.id, person.name?.trim() || person.email]));
  const teamRows = [...team.entries()]
    .map(([id, row]) => ({ id, name: id === "unknown" ? "Staff (name not recorded)" : personName.get(id) ?? "Former team member", ...row, median: median(row.waits) }))
    .sort((a, b) => b.takenOver - a.takenOver || b.sent - a.sent);

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

  const emptyLine = (text: string) => <p className="mt-4 text-sm text-[var(--color-muted)]">{text}</p>;

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
      {conversationRows.length >= CONVERSATION_CAP ? (
        <p className="mt-2 text-[12px] text-[var(--color-muted)]">Showing the latest {CONVERSATION_CAP.toLocaleString("en-IN")} conversations. Pick a shorter period for exact totals.</p>
      ) : null}

      <Panel className="mt-4 p-5">
        <PanelHeading title={`Value from ${agent}`} detail={`What ${agent} handled on the team's behalf in this period, including when the office was closed.`} />
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
          <Figure
            label="Answered while the office was closed"
            value={aiClosed ?? "–"}
            note={aiClosed === null ? "Working hours on the Agent page could not be read" : `${percentOf(aiClosed, aiReplies)} of ${aiReplies.toLocaleString("en-IN")} replies, after hours or on off days`}
          />
          <Figure
            label="Chats started after hours"
            value={startedClosed ?? "–"}
            note={startedClosed === null ? settings.workingHours : `${percentOf(startedClosed, started)} of conversations · office: ${settings.workingHours}`}
          />
          <Figure label="Median first reply" value={duration(medianWait)} note="From a customer's message to the reply" />
          <Figure
            label="Team time saved (estimate)"
            value={aiReplies ? hoursLabel(minutesSaved) : "–"}
            note={`About ${MINUTES_PER_REPLY} min per reply × ${aiReplies.toLocaleString("en-IN")} replies by ${agent}`}
          />
        </dl>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Panel className="p-5 lg:col-span-3">
          <PanelHeading title="Funnel" detail={`From the first message to a visit request. Each share is of the ${started} conversations started.`} />
          <Funnel steps={[
            { label: "Conversations started", value: started },
            { label: "Details shared", value: count("details"), note: "Gave a phone or WhatsApp number" },
            { label: "Qualified", value: qualifiedCount, note: "Answered every must-have question" },
            { label: "Sent to Zoho", value: zohoCount },
            { label: "Consultation / experience centre requested", value: offers, note: `Said yes when ${agent} offered a free consultation or a visit` },
          ]} />
        </Panel>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Panel className="p-5">
            <PanelHeading title="Meetings requested" detail={`How people answered when ${agent} offered a free consultation or an experience centre visit. Each conversation counts once.`} />
            <BarList
              total={started}
              empty="No one has answered the offer in this period yet."
              items={wantsExperience + wantsConsultation + notNow ? [
                { label: "Experience centre visit", value: wantsExperience },
                { label: "Free consultation", value: wantsConsultation },
                { label: "Not now", value: notNow, muted: true },
              ] : []}
            />
            <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-sm">
              <span className="font-semibold tabular-nums">{qualifiedAsked}</span> of <span className="tabular-nums">{qualifiedCount}</span> qualified conversations asked for a meeting
              <span className="ml-2 text-[12px] tabular-nums text-[var(--color-muted)]">{percentOf(qualifiedAsked, qualifiedCount)}</span>
            </p>
            <p className="mt-1 text-[12px] text-[var(--color-muted)]">Shares above are of the {started} conversations started.</p>
          </Panel>

          <Panel className="p-5">
            <PanelHeading title="From comments" detail="Openers sent to people who commented on a post, in this period." />
            <dl className="mt-4 divide-y divide-[var(--color-line)] text-sm">
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
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <PanelHeading title="Lead quality" detail={`How the ${cohortLeads.length} leads from these conversations are rated.`} />
          {cohortLeads.length ? (
            <>
              <StackedBar
                label={`${hotLeads} hot, ${unratedLeads} unrated, ${junkLeads} junk`}
                segments={[
                  { label: "Hot", value: hotLeads, color: RATING_COLORS.hot },
                  { label: "Unrated", value: unratedLeads, color: RATING_COLORS.unrated },
                  { label: "Junk", value: junkLeads, color: RATING_COLORS.junk },
                ]}
              />
              <div className="mt-5 border-t border-[var(--color-line)] pt-4">
                <SubHeading>Hot share by channel</SubHeading>
                <ul className="mt-2 space-y-2 text-sm">
                  {hotByChannel.map((row) => (
                    <li key={row.name} className="flex flex-wrap items-center justify-between gap-2">
                      <ChannelMark channel={row.name} />
                      <span className="tabular-nums"><span className="font-semibold">{row.hot} hot</span> of {row.leads} leads <span className="text-[var(--color-muted)]">{percentOf(row.hot, row.leads)}</span></span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : emptyLine("No leads from conversations in this period yet.")}
        </Panel>

        <Panel className="p-5">
          <PanelHeading
            title="Where people stop"
            detail={`People who replied but did not finish the must-have questions, by the first question still unanswered. Shares are of these ${stoppedTotal} conversations.`}
          />
          {required.length ? (
            <BarList items={stopRows} total={stoppedTotal} empty="Everyone who replied in this period answered every must-have question." />
          ) : emptyLine("No must-have questions are set on the Leads page.")}
          {neverReplied ? <p className="mt-4 text-[12px] text-[var(--color-muted)]">Not counted: {neverReplied} conversation{neverReplied === 1 ? "" : "s"} where the person never replied.</p> : null}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <PanelHeading title="Homes and projects" detail={`What the ${cohortLeads.length} leads from these conversations told ${agent} about their home.`} />
          {cohortLeads.length ? (
            <>
              <div className="mt-4"><SubHeading>Home</SubHeading></div>
              <BarList items={homeRows} total={cohortLeads.length} empty="No homes described yet." />
              <div className="mt-5 border-t border-[var(--color-line)] pt-4">
                <SubHeading>Top projects and areas</SubHeading>
                <BarList
                  items={areaRows}
                  total={cohortLeads.length}
                  empty="No project or area given yet."
                />
                {areaGiven ? <p className="mt-3 text-[12px] text-[var(--color-muted)]">{areaGiven} of {cohortLeads.length} leads named a project or area. Shares are of all leads.</p> : null}
              </div>
            </>
          ) : emptyLine("No leads from conversations in this period yet.")}
        </Panel>

        <Panel className="p-5">
          <PanelHeading title="When they want to start" detail="When the home will be ready for interiors, read from the possession answer. Shares are of all leads." />
          {!possessionId ? emptyLine("There is no possession question on the Leads page.") : cohortLeads.length ? (
            <BarList items={possessionRows} total={cohortLeads.length} empty="No possession answers yet." />
          ) : emptyLine("No leads from conversations in this period yet.")}
          {possessionId && cohortLeads.length ? <p className="mt-4 text-[12px] text-[var(--color-muted)]">Dates are counted from this month in India. Answers that cannot be read are shown as Unclear, not guessed.</p> : null}
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
          <PanelHeading title="Price questions" detail="Conversations where the customer asked about price, cost or budget, and what happened next." />
          {priceAsked ? (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-4">
                <Figure label="Asked about price" value={priceAsked} note={`${percentOf(priceAsked, repliedCount)} of people who replied`} />
                <Figure label="Asked more than once" value={pricePushed} note={`${percentOf(pricePushed, priceAsked)} of those who asked`} />
              </dl>
              <StackedBar
                label={`${phoneAfter} shared a phone after asking, ${phoneBefore} had shared one before, ${priceStopped} did not share one`}
                segments={[
                  { label: "Shared phone after", value: phoneAfter, color: "var(--color-accent)" },
                  { label: "Had shared before", value: phoneBefore, color: "#c9b48a" },
                  { label: "No phone", value: priceStopped, color: RATING_COLORS.unrated },
                ]}
              />
              <p className="mt-3 text-[12px] text-[var(--color-muted)]">Shares are of the {priceAsked} conversations with a price question.</p>
            </>
          ) : emptyLine("No one asked about price in this period.")}
        </Panel>

        {showTeam ? (
          <Panel className="p-5">
            <PanelHeading title="Team" detail="Chats each person took over from the assistant, messages they sent, and how fast they answered a customer." />
            {teamRows.length ? (
              <ul className="mt-4 divide-y divide-[var(--color-line)]">
                {teamRows.map((row) => (
                  <li key={row.id} className="py-3">
                    <p className="truncate font-medium" title={row.name}>{row.name}</p>
                    <dl className="mt-1.5 grid grid-cols-3 gap-2 text-[13px]">
                      <div><dt className="text-[var(--color-muted)]">Took over</dt><dd className="font-semibold tabular-nums">{row.takenOver}</dd></div>
                      <div><dt className="text-[var(--color-muted)]">Messages</dt><dd className="font-semibold tabular-nums">{row.sent} <span className="font-normal text-[var(--color-muted)]">in {row.chats.size} chat{row.chats.size === 1 ? "" : "s"}</span></dd></div>
                      <div><dt className="text-[var(--color-muted)]">Median reply</dt><dd className="font-semibold tabular-nums">{duration(row.median)}</dd></div>
                    </dl>
                  </li>
                ))}
              </ul>
            ) : emptyLine("No one on the team has taken a chat over in this period.")}
          </Panel>
        ) : null}
      </div>

      <Panel className="mt-4 p-5">
        <PanelHeading title="Top posts" detail="Posts whose comments started the most conversations, Zoho leads and hot leads." />
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
                  <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 pl-7 text-sm tabular-nums sm:pl-0">
                    {post ? <ChannelMark channel={post.channel} /> : null}
                    <span><span className="font-semibold">{row.chats}</span> <span className="text-[var(--color-muted)]">conversations</span></span>
                    <span><span className="font-semibold">{row.zoho}</span> <span className="text-[var(--color-muted)]">in Zoho</span></span>
                    <span><span className="font-semibold">{row.hot}</span> <span className="text-[var(--color-muted)]">hot</span></span>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <p className="mt-3 text-sm text-[var(--color-muted)]">No post activity in this period yet.</p>}
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
            <SubHeading>By channel</SubHeading>
            <ul className="mt-2 space-y-2 text-sm">
              {channels.map((row) => (
                <li key={row.name} className="flex flex-wrap items-center justify-between gap-2">
                  <ChannelMark channel={row.name} />
                  <span className="tabular-nums">{row.chats} conversations · <span className="font-semibold">{row.zoho} in Zoho</span> <span className="text-[var(--color-muted)]">{percentOf(row.zoho, row.chats)}</span> · <span className="font-semibold">{row.hot} hot</span></span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>

      {role === "VIEWER" ? null : (
        <Panel className="mt-4 p-5">
          <PanelHeading title="Latest leads in Zoho" detail="The most recent leads from conversations in this period." />
          {recentLeads.length ? <LeadsTable rows={recentLeads} /> : <p className="mt-3 text-sm text-[var(--color-muted)]">No Zoho leads in this period yet.</p>}
        </Panel>
      )}
    </section>
  );
}

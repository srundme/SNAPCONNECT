import { FlaskConical } from "lucide-react";
import { applyProjectAliases, getPrisma, knownProject } from "@snapsocial/db";
import { can, parseAgentSettings, parseLeadQuestions, placeAnswer, replyEligibility } from "@snapsocial/domain";
import { injectSimulation } from "@/lib/actions";
import { Empty, Notice } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";
import { LiveInbox } from "@/components/live-inbox";
import { ChatPane, type ChatMessage } from "@/components/inbox/chat-pane";
import { ConversationList, type ListRow } from "@/components/inbox/conversation-list";
import { buildBrief } from "@/components/inbox/brief";
import { LeadPanel, type PersonChannel, type PossibleMatch } from "@/components/inbox/lead-panel";
import { customerHandle, customerName, isTestContact, ownership, readAnswers, type Channel } from "@/components/inbox/labels";
import { readInboxState } from "@/components/inbox/params";

const LIST_SIZE = 60;
const SITUATION_PREFIXES = ["Situation: info-seeking", "Situation: flood", "Situation: broadcast"];

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const state = readInboxState(params);
  const error = typeof params.error === "string" ? params.error : undefined;
  const { actor, workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER") return <Empty title="Permission denied" body="Viewers do not receive transcripts." />;
  const db = getPrisma();
  const me = actor.userId;
  const canReply = can(actor, "inbox.reply", workspace.id);

  const search = state.q;
  const digits = search?.replace(/\D/g, "") ?? "";
  const handle = search?.replace(/^@/, "");
  const conversations = await db.conversation.findMany({
    where: {
      workspaceId: workspace.id,
      ...(state.channel ? { channel: state.channel } : {}),
      ...(state.view === "needs" ? { owner: "HUMAN" as const } : state.view === "mine" ? { ownerUserId: me } : state.view === "varun" ? { owner: "AI" as const } : {}),
      ...(search ? {
        OR: [
          { contact: { displayName: { contains: search, mode: "insensitive" as const } } },
          { contact: { chosenName: { contains: search, mode: "insensitive" as const } } },
          { contact: { username: { contains: handle, mode: "insensitive" as const } } },
          ...(digits.length >= 3 ? [{ contact: { leads: { some: { phoneE164: { contains: digits } } } } }] : []),
          { messages: { some: { author: { in: ["PROSPECT" as const, "AI" as const, "STAFF" as const] }, body: { contains: search, mode: "insensitive" as const } } } },
        ],
      } : {}),
    },
    include: {
      contact: { select: { id: true, displayName: true, username: true, chosenName: true, personId: true } },
      messages: { where: { author: { not: "SYSTEM" } }, orderBy: { createdAt: "desc" }, take: 1, select: { body: true, author: true, createdAt: true, voice: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: LIST_SIZE * 3,
  });
  const tests = conversations.filter((item) => isTestContact(item.contact));
  const visible = (state.tests ? conversations : conversations.filter((item) => !isTestContact(item.contact))).slice(0, LIST_SIZE);

  const selectedBase = state.id
    ? await db.conversation.findFirst({ where: { id: state.id, workspaceId: workspace.id }, include: { contact: true } })
    : visible[0] ? await db.conversation.findFirst({ where: { id: visible[0].id, workspaceId: workspace.id }, include: { contact: true } }) : null;

  const [leads, messages, lead, connection, flagNotes] = await Promise.all([
    db.lead.findMany({
      where: { workspaceId: workspace.id, archivedAt: null, contactId: { in: visible.map((item) => item.contactId) } },
      select: { contactId: true, rating: true, handoffReason: true, phoneE164: true },
      orderBy: { createdAt: "desc" },
    }),
    selectedBase ? db.message.findMany({ where: { conversationId: selectedBase.id }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
    selectedBase ? db.lead.findFirst({ where: { contactId: selectedBase.contactId, archivedAt: null }, orderBy: { createdAt: "desc" } }) : Promise.resolve(null),
    selectedBase ? db.channelConnection.findUnique({ where: { id: selectedBase.connectionId } }) : Promise.resolve(null),
    // Safety-check flags for the listed chats, in one query: info fishing, floods and broadcast spam.
    visible.length
      ? db.message.findMany({
        where: {
          conversationId: { in: visible.map((item) => item.id) },
          author: "SYSTEM",
          OR: SITUATION_PREFIXES.map((prefix) => ({ body: { startsWith: prefix } })),
        },
        distinct: ["conversationId"],
        select: { conversationId: true },
      })
      : Promise.resolve([]),
  ]);
  const flaggedIds = new Set(flagNotes.map((note) => note.conversationId));
  // What public listings say about their project, from the project memory: no search from here.
  // Same text and key the assistant used when it looked the project up.
  const placeText = lead ? placeAnswer(parseLeadQuestions(workspace.leadQuestions), readAnswers(lead.answers)).slice(0, 120) : "";
  const serviceCity = parseAgentSettings(workspace.agentSettings).serviceArea.split(/[,\n]+/)[0]?.trim() || undefined;
  const project = placeText
    ? await knownProject(db, applyProjectAliases(placeText, parseAgentSettings(workspace.agentSettings).projectAliases), serviceCity).catch(() => null)
    : null;
  // Same person on other channels, and open "possibly the same person" suggestions, for the listed chats and the open one.
  const personContact = {
    id: true,
    channel: true,
    personId: true,
    displayName: true,
    username: true,
    chosenName: true,
    conversations: { orderBy: { updatedAt: "desc" as const }, take: 1, select: { id: true, updatedAt: true, lastUserMessageAt: true } },
  };
  const selectedContact = selectedBase?.contact ?? null;
  const personIds = [...new Set([...visible.map((item) => item.contact.personId), selectedContact?.personId].filter((id): id is string => Boolean(id)))];
  const listedContactIds = [...new Set([...visible.map((item) => item.contactId), ...(selectedContact ? [selectedContact.id] : [])])];
  const [personMembers, openMatches] = await Promise.all([
    personIds.length
      ? db.contact.findMany({ where: { workspaceId: workspace.id, personId: { in: personIds } }, select: personContact })
      : Promise.resolve([]),
    listedContactIds.length
      ? db.personMatch.findMany({
        where: { workspaceId: workspace.id, status: "SUGGESTED", OR: [{ contactId: { in: listedContactIds } }, { candidateId: { in: listedContactIds } }] },
        orderBy: { score: "desc" },
      })
      : Promise.resolve([]),
  ]);
  const channelsByPerson = new Map<string, Set<Channel>>();
  for (const member of personMembers) {
    if (!member.personId) continue;
    const set = channelsByPerson.get(member.personId) ?? new Set<Channel>();
    set.add(member.channel);
    channelsByPerson.set(member.personId, set);
  }
  const suggestionsByContact = new Map<string, number>();
  for (const match of openMatches) {
    suggestionsByContact.set(match.contactId, (suggestionsByContact.get(match.contactId) ?? 0) + 1);
    suggestionsByContact.set(match.candidateId, (suggestionsByContact.get(match.candidateId) ?? 0) + 1);
  }
  const alsoOn = (contact: { personId: string | null }, channel: Channel): Channel[] =>
    contact.personId ? [...(channelsByPerson.get(contact.personId) ?? [])].filter((item) => item !== channel) : [];

  const toPersonChannel = (contact: (typeof personMembers)[number]): PersonChannel => {
    const conversation = contact.conversations[0];
    return {
      contactId: contact.id,
      channel: contact.channel,
      name: customerName(contact),
      conversationId: conversation?.id ?? null,
      lastAt: conversation?.lastUserMessageAt ?? conversation?.updatedAt ?? null,
    };
  };
  const samePerson: PersonChannel[] = selectedContact?.personId
    ? personMembers.filter((member) => member.personId === selectedContact.personId && member.id !== selectedContact.id).map(toPersonChannel)
    : [];
  const selectedMatches = selectedContact
    ? openMatches.filter((match) => match.contactId === selectedContact.id || match.candidateId === selectedContact.id)
    : [];
  const matchOthers = selectedMatches.length
    ? await db.contact.findMany({
      where: { workspaceId: workspace.id, id: { in: selectedMatches.map((match) => (match.contactId === selectedContact?.id ? match.candidateId : match.contactId)) } },
      select: personContact,
    })
    : [];
  const matchOtherById = new Map(matchOthers.map((contact) => [contact.id, contact]));
  const possibleMatches: PossibleMatch[] = [];
  for (const match of selectedMatches) {
    const other = matchOtherById.get(match.contactId === selectedContact?.id ? match.candidateId : match.contactId);
    // Already joined some other way: nothing left to decide.
    if (!other || (other.personId && other.personId === selectedContact?.personId)) continue;
    possibleMatches.push({ matchId: match.id, other: toPersonChannel(other), reasons: match.reasons, askedAt: match.askedAt });
  }

  const leadByContact = new Map<string, (typeof leads)[number]>();
  for (const item of leads) if (!leadByContact.has(item.contactId)) leadByContact.set(item.contactId, item);

  const staffIds = new Set<string>();
  for (const item of visible) if (item.ownerUserId) staffIds.add(item.ownerUserId);
  if (selectedBase?.ownerUserId) staffIds.add(selectedBase.ownerUserId);
  for (const message of messages) if (message.staffUserId) staffIds.add(message.staffUserId);
  const users = staffIds.size > 0 ? await db.user.findMany({ where: { id: { in: [...staffIds] } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((user) => [user.id, user.name?.trim() || "a team member"]));

  const rows: ListRow[] = visible.map((item) => {
    const last = item.messages[0];
    const itemLead = leadByContact.get(item.contactId);
    return {
      id: item.id,
      name: customerName(item.contact),
      channel: item.channel,
      preview: last ? (last.body.trim() || (last.voice ? "Voice note" : "")) : "No messages yet",
      previewAuthor: !last ? null : last.author === "AI" ? "Varun" : last.author === "STAFF" ? "Team" : null,
      at: last?.createdAt ?? item.updatedAt,
      rating: itemLead?.rating ?? null,
      owner: ownership(item, names, me, itemLead?.handoffReason ?? null),
      alsoOn: alsoOn(item.contact, item.channel),
      possibleMatch: (suggestionsByContact.get(item.contactId) ?? 0) > 0,
      flagged: flaggedIds.has(item.id),
    };
  });

  const eligibility = selectedBase && connection ? replyEligibility({
    now: new Date(),
    lastUserMessageAt: selectedBase.lastUserMessageAt,
    paused: connection.automationPaused || workspace.automationPaused,
    optedOut: Boolean(selectedBase.contact.optedOutAt),
    connectionReady: !connection.revokedAt,
    ownerAllowsAutomation: selectedBase.owner === "AI",
    manual: true,
  }) : null;

  const questions = parseLeadQuestions(workspace.leadQuestions);
  const selectedOwner = selectedBase ? ownership(selectedBase, names, me, lead?.handoffReason ?? null) : null;
  const brief = selectedBase ? buildBrief({
    messages,
    lead: lead ? { rating: lead.rating, ratingReason: lead.ratingReason, handoffReason: lead.handoffReason, answers: readAnswers(lead.answers) } : null,
    questions,
    workingHours: parseAgentSettings(workspace.agentSettings).workingHours,
    handedAutomatically: selectedOwner?.kind === "handed",
  }) : null;
  // Team flags on Varun's replies in the open chat, in one query: the latest reason shows, and my own fills the form.
  const aiMessageIds = messages.filter((message) => message.author === "AI").map((message) => message.id);
  const feedbackRows = aiMessageIds.length
    ? await db.replyFeedback.findMany({
      where: { workspaceId: workspace.id, messageId: { in: aiMessageIds } },
      orderBy: { createdAt: "asc" },
      select: { messageId: true, userId: true, reason: true, note: true },
    })
    : [];
  const feedback: Record<string, { reason: string; mine: { reason: string; note: string | null } | null }> = {};
  for (const row of feedbackRows) {
    const mine = row.userId === me ? { reason: row.reason, note: row.note } : feedback[row.messageId]?.mine ?? null;
    feedback[row.messageId] = { reason: row.reason, mine };
  }

  const chatMessages: ChatMessage[] = messages.map((message) => ({
    id: message.id,
    author: message.author,
    body: message.body,
    createdAt: message.createdAt,
    voice: message.voice,
    voiceClipId: message.voiceClipId,
    staffName: message.staffUserId ? names.get(message.staffUserId) ?? "Team" : null,
  }));

  const showSimulation = workspace.mode === "SIMULATION" && role !== "AGENT";

  return (
    <section>
      <LiveInbox />
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[32px] font-medium leading-none tracking-tight">Inbox</h1>
          <p className="mt-1.5 text-[13.5px] text-[var(--color-muted)]">Every customer chat, who has it, and what Varun has learnt so far.</p>
        </div>
        {showSimulation ? (
          <form action={injectSimulation} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--color-muted)]"><FlaskConical size={13} aria-hidden /> Practice</span>
            <button name="scenario" value="instagram-comment" type="submit" className="px-2.5 py-1.5 text-[12.5px]">Instagram comment</button>
            <button name="scenario" value="instagram-reply" type="submit" className="px-2.5 py-1.5 text-[12.5px]">Instagram reply</button>
            <button name="scenario" value="facebook-comment" type="submit" className="px-2.5 py-1.5 text-[12.5px]">Facebook comment</button>
            <button name="scenario" value="facebook-reply" type="submit" className="px-2.5 py-1.5 text-[12.5px]">Messenger reply</button>
          </form>
        ) : null}
      </header>
      {error ? <Notice tone="stop">{error}</Notice> : null}
      <div className="grid min-w-0 grid-cols-1 overflow-hidden rounded-2xl bg-white shadow-[0_1px_0_rgba(20,23,28,0.06),0_8px_24px_-12px_rgba(26,22,18,0.08)] lg:grid-cols-[300px_minmax(0,1fr)] xl:h-[calc(100dvh-11rem)] xl:min-h-[600px] xl:grid-cols-[316px_minmax(0,1fr)_300px]">
        <div className="flex min-w-0 max-h-[46dvh] min-h-0 flex-col border-b border-[var(--color-line)] lg:h-[74dvh] lg:max-h-none lg:border-b-0 lg:border-r xl:h-auto">
          <ConversationList rows={rows} state={state} selectedId={selectedBase?.id} hiddenTests={state.tests ? 0 : tests.length} />
        </div>
        <div className="flex min-w-0 h-[78dvh] min-h-0 flex-col border-b border-[var(--color-line)] lg:h-[74dvh] xl:h-auto xl:border-b-0 xl:border-r">
          {selectedBase ? (
            <ChatPane
              conversationId={selectedBase.id}
              channel={selectedBase.channel}
              name={customerName(selectedBase.contact)}
              handle={customerHandle(selectedBase.channel, selectedBase.contact, lead?.phoneE164 ?? null)}
              rating={lead?.rating ?? null}
              owner={selectedOwner ?? ownership(selectedBase, names, me, lead?.handoffReason ?? null)}
              alsoOn={alsoOn(selectedBase.contact, selectedBase.channel)}
              messages={chatMessages}
              state={state}
              canReply={canReply}
              replyAllowed={Boolean(eligibility?.allowed)}
              replyReason={eligibility?.reason ?? (connection ? null : "The channel for this chat is missing.")}
              feedback={feedback}
              brief={selectedBase.owner === "HUMAN" ? brief : null}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-8 py-16 text-center">
              <p className="font-[family-name:var(--font-display)] text-[26px] leading-tight">No chat open</p>
              <p className="mt-2 max-w-sm text-[13.5px] leading-5 text-[var(--color-muted)]">
                {conversations.length === 0 && !state.q && state.view === "all" && !state.channel
                  ? "When a customer comments or messages on Instagram, Facebook or WhatsApp, Varun replies and the chat shows up here."
                  : "Pick a chat from the list to read it and reply."}
              </p>
            </div>
          )}
        </div>
        <aside className="min-h-0 overflow-y-auto bg-[#fdfcfa] lg:col-span-2 xl:col-span-1">
          {selectedBase ? (
            <LeadPanel
              lead={lead ? {
                rating: lead.rating,
                ratingReason: lead.ratingReason,
                crmState: lead.crmState,
                phoneE164: lead.phoneE164,
                email: lead.email,
                answers: readAnswers(lead.answers),
              } : null}
              questions={questions}
              chosenName={selectedBase.contact.chosenName}
              channel={selectedBase.channel}
              memory={selectedBase.contact.memory}
              memoryUpdatedAt={selectedBase.contact.memoryUpdatedAt}
              samePerson={samePerson}
              possibleMatches={possibleMatches}
              canDecide={canReply}
              project={project}
              brief={brief}
            />
          ) : (
            <p className="p-5 text-[13px] text-[var(--color-muted)]">Lead details appear here when a chat is open.</p>
          )}
        </aside>
      </div>
    </section>
  );
}

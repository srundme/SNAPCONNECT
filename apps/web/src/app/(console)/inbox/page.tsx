import { FlaskConical } from "lucide-react";
import { getPrisma } from "@snapsocial/db";
import { can, parseLeadQuestions, replyEligibility } from "@snapsocial/domain";
import { injectSimulation } from "@/lib/actions";
import { Empty, Notice } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";
import { LiveInbox } from "@/components/live-inbox";
import { ChatPane, type ChatMessage } from "@/components/inbox/chat-pane";
import { ConversationList, type ListRow } from "@/components/inbox/conversation-list";
import { LeadPanel } from "@/components/inbox/lead-panel";
import { customerHandle, customerName, isTestContact, ownership, readAnswers } from "@/components/inbox/labels";
import { readInboxState } from "@/components/inbox/params";

const LIST_SIZE = 60;

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
      contact: { select: { id: true, displayName: true, username: true, chosenName: true } },
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

  const [leads, messages, lead, connection] = await Promise.all([
    db.lead.findMany({
      where: { workspaceId: workspace.id, archivedAt: null, contactId: { in: visible.map((item) => item.contactId) } },
      select: { contactId: true, rating: true, handoffReason: true, phoneE164: true },
      orderBy: { createdAt: "desc" },
    }),
    selectedBase ? db.message.findMany({ where: { conversationId: selectedBase.id }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
    selectedBase ? db.lead.findFirst({ where: { contactId: selectedBase.contactId, archivedAt: null }, orderBy: { createdAt: "desc" } }) : Promise.resolve(null),
    selectedBase ? db.channelConnection.findUnique({ where: { id: selectedBase.connectionId } }) : Promise.resolve(null),
  ]);
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
      <div className="grid overflow-hidden rounded-2xl bg-white shadow-[0_1px_0_rgba(20,23,28,0.06),0_8px_24px_-12px_rgba(26,22,18,0.08)] lg:grid-cols-[300px_minmax(0,1fr)] xl:h-[calc(100dvh-11rem)] xl:min-h-[600px] xl:grid-cols-[316px_minmax(0,1fr)_300px]">
        <div className="flex max-h-[46dvh] min-h-0 flex-col border-b border-[var(--color-line)] lg:h-[74dvh] lg:max-h-none lg:border-b-0 lg:border-r xl:h-auto">
          <ConversationList rows={rows} state={state} selectedId={selectedBase?.id} hiddenTests={state.tests ? 0 : tests.length} />
        </div>
        <div className="flex h-[78dvh] min-h-0 flex-col border-b border-[var(--color-line)] lg:h-[74dvh] xl:h-auto xl:border-b-0 xl:border-r">
          {selectedBase ? (
            <ChatPane
              conversationId={selectedBase.id}
              channel={selectedBase.channel}
              name={customerName(selectedBase.contact)}
              handle={customerHandle(selectedBase.channel, selectedBase.contact, lead?.phoneE164 ?? null)}
              rating={lead?.rating ?? null}
              owner={ownership(selectedBase, names, me, lead?.handoffReason ?? null)}
              messages={chatMessages}
              state={state}
              canReply={canReply}
              replyAllowed={Boolean(eligibility?.allowed)}
              replyReason={eligibility?.reason ?? (connection ? null : "The channel for this chat is missing.")}
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
              questions={parseLeadQuestions(workspace.leadQuestions)}
              chosenName={selectedBase.contact.chosenName}
              channel={selectedBase.channel}
              memory={selectedBase.contact.memory}
              memoryUpdatedAt={selectedBase.contact.memoryUpdatedAt}
            />
          ) : (
            <p className="p-5 text-[13px] text-[var(--color-muted)]">Lead details appear here when a chat is open.</p>
          )}
        </aside>
      </div>
    </section>
  );
}

import Link from "next/link";
import { Send } from "lucide-react";
import { getPrisma } from "@snapsocial/db";
import { replyEligibility } from "@snapsocial/domain";
import { claimConversation, injectSimulation, sendStaffReply } from "@/lib/actions";
import { ChannelMark, Empty, Notice } from "@/components/ui";
import { clsx } from "clsx";
import { requireWorkspace } from "@/lib/session";

function authorLabel(author: string) {
  if (author === "PROSPECT") return "Them";
  if (author === "AI") return "Assistant";
  if (author === "STAFF") return "You";
  return "System";
}

function contactLabel(
  channel: string,
  contact: { username: string | null; displayName: string | null; chosenName: string | null },
  phone: string | null,
) {
  if (channel === "WHATSAPP") {
    const person = contact.chosenName ?? contact.displayName ?? "WhatsApp contact";
    return phone ? `${person} · ${phone}` : person;
  }
  return contact.username ?? contact.displayName ?? "Prospect";
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ id?: string; channel?: string; error?: string }> }) {
  const params = await searchParams;
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER") return <Empty title="Permission denied" body="Viewers do not receive transcripts." />;
  const channel = params.channel === "INSTAGRAM" || params.channel === "FACEBOOK" || params.channel === "WHATSAPP" ? params.channel : undefined;
  const conversations = await getPrisma().conversation.findMany({
    where: { workspaceId: workspace.id, ...(channel ? { channel } : {}) },
    include: { contact: true, messages: { orderBy: { createdAt: "asc" } } },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  const selected = conversations.find((item) => item.id === params.id) ?? conversations[0];
  const lead = selected ? await getPrisma().lead.findFirst({ where: { contactId: selected.contactId, archivedAt: null }, include: { crm: true } }) : null;
  const connection = selected ? await getPrisma().channelConnection.findUnique({ where: { id: selected.connectionId } }) : null;
  const eligibility = selected && connection ? replyEligibility({
    now: new Date(),
    lastUserMessageAt: selected.lastUserMessageAt,
    paused: connection.automationPaused || workspace.automationPaused,
    optedOut: Boolean(selected.contact.optedOutAt),
    connectionReady: !connection.revokedAt,
    ownerAllowsAutomation: selected.owner === "AI",
    manual: true,
  }) : null;
  const name = selected ? contactLabel(selected.channel, selected.contact, lead?.phoneE164 ?? null) : "Prospect";
  return (
    <section>
      {workspace.mode === "SIMULATION" && role !== "AGENT" ? (
        <form action={injectSimulation} className="mb-4 flex flex-wrap gap-2">
          <button name="scenario" value="instagram-comment" type="submit">Simulate Instagram comment</button>
          <button name="scenario" value="instagram-reply" type="submit">Simulate Instagram reply</button>
          <button name="scenario" value="facebook-comment" type="submit">Simulate Facebook comment</button>
          <button name="scenario" value="facebook-reply" type="submit">Simulate Messenger reply</button>
        </form>
      ) : null}
      {params.error ? <Notice tone="stop">{params.error}</Notice> : null}
      {conversations.length === 0 ? <Empty title="No conversations" body="A matching comment shows up here after the worker processes it." /> : (
        <div className="grid h-[calc(100dvh-7.5rem)] min-h-[560px] overflow-hidden rounded-2xl bg-white shadow-[0_1px_0_rgba(20,23,28,0.06)] lg:grid-cols-[280px_minmax(0,1fr)_260px]">
          <div className="min-h-0 overflow-y-auto border-b border-[var(--color-line)] lg:border-b-0 lg:border-r">
            <div className="flex gap-1 border-b border-[var(--color-line)] p-3">
              {[
                ["/inbox", "All", !channel],
                ["/inbox?channel=INSTAGRAM", "Instagram", channel === "INSTAGRAM"],
                ["/inbox?channel=FACEBOOK", "Facebook", channel === "FACEBOOK"],
                ["/inbox?channel=WHATSAPP", "WhatsApp", channel === "WHATSAPP"],
              ].map(([href, label, active]) => (
                <Link key={String(href)} href={String(href)} className={clsx("rounded-full px-3 py-1 text-[13px] font-semibold", active ? "bg-[var(--color-ink)] text-white" : "text-[var(--color-muted)] hover:bg-[var(--color-paper)]")}>{label}</Link>
              ))}
            </div>
            <ul>
              {conversations.map((item) => {
                const label = contactLabel(item.channel, item.contact, null);
                const last = item.messages.at(-1);
                return (
                  <li key={item.id}>
                    <Link className={clsx("block border-b border-[var(--color-line)] px-4 py-3", item.id === selected?.id && "bg-[#f4fbfa]")} href={`/inbox?id=${item.id}${channel ? `&channel=${channel}` : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold">{label}</p>
                        <ChannelMark channel={item.channel} />
                      </div>
                      <p className="mt-1 truncate text-[13px] text-[var(--color-muted)]">{last?.body ?? "No message yet"}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex min-h-0 flex-col border-b border-[var(--color-line)] lg:border-b-0 lg:border-r">
            {selected ? (
              <>
                <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
                  <div>
                    <p className="font-semibold">{name}</p>
                    <p className="text-[12px] text-[var(--color-muted)]">{selected.owner === "HUMAN" ? "You are replying" : selected.owner === "AI" ? "Assistant is replying" : "Paused"}</p>
                  </div>
                  <ChannelMark channel={selected.channel} />
                </div>
                <ol className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-4">
                  {selected.messages.map((message) => {
                    const inbound = message.author === "PROSPECT";
                    return (
                      <li key={message.id} className={clsx("max-w-[82%]", inbound ? "justify-self-start" : "justify-self-end")}>
                        <p className={clsx("mb-1 text-[11px] font-semibold uppercase tracking-[0.04em]", inbound ? "text-[var(--color-muted)]" : "text-right text-[var(--color-accent-ink)]")}>{authorLabel(message.author)}</p>
                        <p className={clsx("rounded-2xl px-3 py-2 text-sm leading-5", inbound ? "rounded-tl-md bg-[var(--color-paper)]" : message.author === "STAFF" ? "rounded-tr-md bg-[var(--color-ink)] text-white" : "rounded-tr-md bg-[#e7f6f3]")}>{message.body}</p>
                      </li>
                    );
                  })}
                </ol>
                <form action={sendStaffReply} className="shrink-0 border-t border-[var(--color-line)] p-3">
                  <input type="hidden" name="conversationId" value={selected.id} />
                  <div className="flex items-end gap-2">
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">Reply</span>
                      <textarea name="body" disabled={!eligibility?.allowed} rows={2} placeholder={eligibility?.allowed ? "Write a reply" : "Reply is unavailable"} />
                    </label>
                    <button className="inline-flex shrink-0 items-center gap-1.5 border-transparent bg-[var(--color-accent)] text-white hover:bg-[#0a655f]" type="submit" disabled={!eligibility?.allowed}>
                      <Send size={15} aria-hidden />
                      Send
                    </button>
                  </div>
                  <p className="mt-2 text-[12px] text-[var(--color-muted)]">{eligibility?.allowed ? `Sends on the same ${selected.channel === "WHATSAPP" ? "WhatsApp" : selected.channel === "INSTAGRAM" ? "Instagram" : "Facebook"} chat.` : eligibility?.reason}</p>
                </form>
              </>
            ) : null}
          </div>
          <aside className="min-h-0 overflow-y-auto p-4 text-sm">
            {selected && lead ? (
              <>
                <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]">Lead</p>
                <dl className="mt-3 grid gap-3">
                  {[
                    ["City", lead.city ?? "Not yet"],
                    ["Account type", lead.projectType ?? "Not yet"],
                    ["Budget", lead.budgetRaw ?? "Not yet"],
                    ["Phone", lead.phoneE164 ?? "Not yet"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[12px] text-[var(--color-muted)]">{label}</dt>
                      <dd className="font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-[12px] leading-5 text-[var(--color-muted)]">{selected.channel === "WHATSAPP" ? "This person is chatting from this WhatsApp number." : "A valid number is not proof that the person owns it, or that it is on WhatsApp."}</p>
                <p className="mt-5 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]">Memory</p>
                <p className="mt-2 whitespace-pre-line text-[13px] leading-5">
                  {selected.contact.memory ?? "Nothing older than the last 20 messages yet. The assistant reads those directly."}
                </p>
                {selected.owner !== "HUMAN" ? (
                  <form action={claimConversation} className="mt-5">
                    <input type="hidden" name="conversationId" value={selected.id} />
                    <button className="w-full border-transparent bg-[var(--color-ink)] text-white hover:bg-black" type="submit">Take over</button>
                  </form>
                ) : <p className="mt-5 text-[13px] text-[var(--color-muted)]">You own this chat. A new assistant reply will not be sent while you do.</p>}
              </>
            ) : <p className="text-[var(--color-muted)]">Select a conversation.</p>}
          </aside>
        </div>
      )}
    </section>
  );
}

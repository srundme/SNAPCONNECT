import Link from "next/link";
import { getPrisma } from "@snapsocial/db";
import { replyEligibility } from "@snapsocial/domain";
import { claimConversation, injectSimulation } from "@/lib/actions";
import { ChannelMark, Empty, PageTitle, StatusLabel } from "@/components/ui";
import { clsx } from "clsx";
import { requireWorkspace } from "@/lib/session";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ id?: string; channel?: string }> }) {
  const params = await searchParams;
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER") return <Empty title="Permission denied" body="Viewers do not receive transcripts." />;
  const channel = params.channel === "INSTAGRAM" || params.channel === "FACEBOOK" ? params.channel : undefined;
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
    manual: selected.owner === "HUMAN",
  }) : null;
  return (
    <section>
      <PageTitle title="Inbox" detail="Instagram and Facebook share this list. Notes stay internal." />
      {workspace.mode === "SIMULATION" && role !== "AGENT" ? (
        <form action={injectSimulation} className="mb-4 flex flex-wrap gap-2">
          <button name="scenario" value="instagram-comment" type="submit">Simulate Instagram comment</button>
          <button name="scenario" value="instagram-reply" type="submit">Simulate Instagram reply</button>
          <button name="scenario" value="facebook-comment" type="submit">Simulate Facebook comment</button>
          <button name="scenario" value="facebook-reply" type="submit">Simulate Messenger reply</button>
        </form>
      ) : null}
      <div className="mb-4 flex gap-2 text-sm">
        {[
          ["/inbox", "All", !channel],
          ["/inbox?channel=INSTAGRAM", "Instagram", channel === "INSTAGRAM"],
          ["/inbox?channel=FACEBOOK", "Facebook", channel === "FACEBOOK"],
        ].map(([href, label, active]) => (
          <Link key={String(href)} href={String(href)} className={clsx("rounded-full border px-3 py-1", active ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white" : "border-[var(--color-line)] bg-white")}>{label}</Link>
        ))}
      </div>
      {conversations.length === 0 ? <Empty title="No conversations" body="A matching comment will appear here after the worker processes it." /> : (
        <div className="grid min-h-[640px] overflow-hidden rounded-lg border border-[var(--color-line)] bg-white lg:grid-cols-[280px_minmax(0,1fr)_300px]">
          <ul className="border-b border-[var(--color-line)] lg:border-b-0 lg:border-r">
            {conversations.map((item) => (
              <li key={item.id} className="border-b border-[var(--color-line)] last:border-b-0">
                <Link className={clsx("block px-4 py-3", item.id === selected?.id && "bg-[var(--color-paper)]")} href={`/inbox?id=${item.id}${channel ? `&channel=${channel}` : ""}`}>
                  <ChannelMark channel={item.channel} />
                  <p className="mt-1.5 text-sm font-medium">{item.contact.username ?? item.contact.displayName ?? "Prospect"}</p>
                  <p className="text-[12px] text-[var(--color-muted)]">{item.owner === "HUMAN" ? "Staff" : item.owner === "AI" ? "Assistant" : "Paused"}</p>
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex min-h-[420px] flex-col border-b border-[var(--color-line)] lg:border-b-0 lg:border-r">
            {selected ? (
              <ol className="grid flex-1 content-start gap-3 p-4">
                {selected.messages.map((message) => {
                  const inbound = message.author === "PROSPECT";
                  return (
                    <li key={message.id} className={clsx("max-w-[85%]", inbound ? "justify-self-start" : "justify-self-end")}>
                      <p className="mb-1 text-[12px] text-[var(--color-muted)]">{inbound ? "Prospect" : message.author === "AI" ? "Assistant" : "Staff"}</p>
                      <p className={clsx("rounded-lg px-3 py-2 text-sm", inbound ? "bg-[var(--color-paper)]" : "bg-[#e7f6f3]")}>{message.body}</p>
                    </li>
                  );
                })}
              </ol>
            ) : null}
            <form className="border-t border-[var(--color-line)] p-4">
              <label>Reply
                <textarea name="body" disabled={!eligibility?.allowed} rows={3} placeholder={eligibility?.allowed ? "Write a reply" : "Reply is unavailable"} />
              </label>
              {eligibility && !eligibility.allowed ? <p className="mt-2 text-sm text-[#9f1239]">{eligibility.reason}</p> : null}
            </form>
          </div>
          <aside className="p-4 text-sm">
            {selected && lead ? (
              <>
                <p className="font-medium">Requirement</p>
                <dl className="mt-3 grid gap-2">
                  <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted)]">City</dt><dd>{lead.city ?? "Unknown"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted)]">Project</dt><dd>{lead.projectType ?? "Unknown"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted)]">Budget</dt><dd>{lead.budgetRaw ?? "Unknown"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-[var(--color-muted)]">Phone</dt><dd>{lead.phoneE164 ?? "Unknown"}</dd></div>
                </dl>
                <p className="mt-3 text-[12px] text-[var(--color-muted)]">A valid format does not prove the number is owned or on WhatsApp.</p>
                <p className="mt-3 text-[12px] text-[var(--color-muted)]">Source post {lead.sourceMediaId ?? "unattributed"}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusLabel tone="neutral">{lead.qualification}</StatusLabel>
                  <StatusLabel tone={lead.crmState === "SYNCED" ? "ok" : "wait"}>{lead.crm?.simulated ? "Simulated CRM" : lead.crmState}</StatusLabel>
                </div>
                {selected.owner !== "HUMAN" ? (
                  <form action={claimConversation} className="mt-5">
                    <input type="hidden" name="conversationId" value={selected.id} />
                    <button className="border-transparent bg-[var(--color-accent)] text-white hover:bg-[#115e59]" type="submit">Take over</button>
                  </form>
                ) : <p className="mt-5 text-[var(--color-muted)]">Staff owns this chat. Pending assistant replies are cancelled.</p>}
              </>
            ) : <p className="text-[var(--color-muted)]">Select a conversation.</p>}
          </aside>
        </div>
      )}
    </section>
  );
}

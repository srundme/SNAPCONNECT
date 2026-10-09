import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { getPrisma } from "@snapsocial/db";
import { Empty, PageTitle, Panel } from "@/components/ui";
import { fullIST, whenIST } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";

export const dynamic = "force-dynamic";

const DAYS = 30;

type Row = {
  id: string;
  conversationId: string;
  reason: string;
  note: string | null;
  createdAt: Date;
  reply: string | null;
  customer: string | null;
  flaggedBy: string;
};

export default async function FeedbackPage() {
  const { workspace, role } = await requireWorkspace();
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") redirect("/overview?denied=1");
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;

  const db = getPrisma();
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const feedback = await db.replyFeedback.findMany({
    where: { workspaceId: workspace.id, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const [messages, users] = await Promise.all([
    feedback.length
      ? db.message.findMany({
          where: { workspaceId: workspace.id, id: { in: [...new Set(feedback.map((item) => item.messageId))] }, conversationId: { in: [...new Set(feedback.map((item) => item.conversationId))] } },
          select: { id: true, body: true, createdAt: true, conversationId: true },
        })
      : Promise.resolve([]),
    feedback.length
      ? db.user.findMany({ where: { id: { in: [...new Set(feedback.map((item) => item.userId))] } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const nameById = new Map(users.map((user) => [user.id, user.name]));

  // The customer message just before each flagged reply: the previous PROSPECT message in that chat.
  const customerByMessage = new Map<string, string | null>();
  await Promise.all(
    messages.map(async (message) => {
      const before = await db.message.findFirst({
        where: { conversationId: message.conversationId, author: "PROSPECT", createdAt: { lt: message.createdAt } },
        orderBy: { createdAt: "desc" },
        select: { body: true },
      });
      customerByMessage.set(message.id, before?.body ?? null);
    }),
  );

  const rows: Row[] = feedback.map((item) => ({
    id: item.id,
    conversationId: item.conversationId,
    reason: item.reason.trim() || "Other",
    note: item.note,
    createdAt: item.createdAt,
    reply: messageById.get(item.messageId)?.body ?? null,
    customer: customerByMessage.get(item.messageId) ?? null,
    flaggedBy: nameById.get(item.userId)?.trim() || "Someone on the team",
  }));

  const groups = [...rows.reduce((map, row) => map.set(row.reason, [...(map.get(row.reason) ?? []), row]), new Map<string, Row[]>())]
    .map(([reason, items]) => ({ reason, items }))
    .sort((a, b) => b.items.length - a.items.length || a.reason.localeCompare(b.reason));
  const top = groups[0]?.items.length ?? 0;

  return (
    <section className="max-w-5xl">
      <PageTitle
        title="Reply fixes"
        detail="Replies the team marked as wrong. Fix the most common reasons first."
      />
      {rows.length === 0 ? (
        <Empty title="No flagged replies in the last 30 days" body="When someone in the inbox marks one of the assistant's replies as wrong, it shows up here with the reason." />
      ) : (
        <div className="grid gap-6">
          <Panel>
            <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
              <h2 className="text-[17px] font-semibold tracking-tight">By reason</h2>
              <p className="text-[13px] text-[var(--color-muted)]">
                {rows.length.toLocaleString("en-IN")} flagged in the last {DAYS} days
              </p>
            </div>
            <ol className="grid gap-3 px-5 py-4">
              {groups.map((group) => (
                <li key={group.reason}>
                  <a href={`#reason-${slug(group.reason)}`} className="group grid gap-1.5 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)_48px] sm:items-center sm:gap-4">
                    <span className="truncate text-sm font-medium group-hover:text-[var(--color-accent-ink)]">{group.reason}</span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-[#f1ebe0]" aria-hidden>
                      <span
                        className="block h-full rounded-full bg-[linear-gradient(90deg,#b8914a,#8d6b2f)]"
                        style={{ width: `${Math.max(4, Math.round((group.items.length / top) * 100))}%` }}
                      />
                    </span>
                    <span className="text-sm font-semibold tabular-nums sm:text-right">{group.items.length}</span>
                  </a>
                </li>
              ))}
            </ol>
          </Panel>

          {groups.map((group) => (
            <section key={group.reason} id={`reason-${slug(group.reason)}`} aria-labelledby={`reason-title-${slug(group.reason)}`} className="scroll-mt-20">
              <h2 id={`reason-title-${slug(group.reason)}`} className="mb-2 flex items-baseline gap-2 px-1">
                <span className="font-[family-name:var(--font-display)] text-[24px] font-medium leading-none tracking-tight">{group.reason}</span>
                <span className="text-[13px] font-semibold text-[var(--color-muted)]">{group.items.length}</span>
              </h2>
              <ol className="divide-y divide-[var(--color-line)] overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-card)]">
                {group.items.map((row) => (
                  <li key={row.id} className="grid gap-3 px-4 py-4 sm:px-5">
                    <div className="grid gap-2">
                      <div className="rounded-xl bg-[#f6f3ee] px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]">Customer</p>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{row.customer ?? <span className="text-[var(--color-muted)]">No customer message before this reply.</span>}</p>
                      </div>
                      <div className="rounded-xl border border-[#ecdcb8] bg-[#fbf7ee] px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-accent-ink)]">Assistant reply</p>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{row.reply ?? <span className="text-[var(--color-muted)]">This message is no longer available.</span>}</p>
                      </div>
                    </div>
                    {row.note ? <p className="text-sm text-[var(--color-ink)]"><span className="font-semibold">Note: </span>{row.note}</p> : null}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-[var(--color-muted)]">
                      <p>
                        Flagged by <span className="font-medium text-[var(--color-ink)]">{row.flaggedBy}</span>
                        {" · "}
                        <time dateTime={row.createdAt.toISOString()} title={fullIST(row.createdAt)}>{whenIST(row.createdAt)}</time>
                      </p>
                      <Link
                        href={`/inbox?id=${encodeURIComponent(row.conversationId)}`}
                        className="inline-flex items-center gap-1 font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-ink)]"
                      >
                        <MessageSquare size={13} aria-hidden />
                        Open chat
                      </Link>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";
}

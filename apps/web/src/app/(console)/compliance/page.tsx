import { getPrisma } from "@snapsocial/db";
import { disclosesAutomation } from "@snapsocial/domain";
import { ChannelMark, Empty, PageTitle, Panel, StatGrid, StatusLabel } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";
import { fullIST, whenIST } from "@/lib/format";

const DAY = 86_400_000;
const RATE_LIMIT = /rate|limit|too many|#4\b|#17\b|#32\b|#613\b|code"?:\s*(4|17|32|613)\b|spam|block|restrict|temporarily/i;

type Check = { label: string; value: number | string; good: boolean; detail: string };

export default async function CompliancePage() {
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER" || role === "AGENT") return <Empty title="Admins only" body="Compliance checks are visible to admins." />;
  const db = getPrisma();
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * DAY);
  const since7 = new Date(now.getTime() - 7 * DAY);
  const since24h = new Date(now.getTime() - DAY);

  const [connections, attempts, decisions, conversations, optedOut, webhooks] = await Promise.all([
    db.channelConnection.findMany({ where: { workspaceId: workspace.id, mode: "INTEGRATION" } }),
    db.outboundAttempt.findMany({ where: { workspaceId: workspace.id, createdAt: { gte: since30 } }, select: { commentExternalId: true, status: true, createdAt: true, lastError: true, channel: true } }),
    db.commentDecision.findMany({ where: { workspaceId: workspace.id, createdAt: { gte: since30 } }, select: { outcome: true, reason: true } }),
    db.conversation.findMany({ where: { workspaceId: workspace.id, sandbox: false, updatedAt: { gte: since30 } }, select: { id: true, owner: true } }),
    db.contact.count({ where: { workspaceId: workspace.id, optedOutAt: { not: null } } }),
    db.webhookEvent.groupBy({ by: ["status"], where: { workspaceId: workspace.id, receivedAt: { gte: since7 } }, _count: true }),
  ]);
  const messages = conversations.length
    ? await db.message.findMany({
        where: { conversationId: { in: conversations.map((conversation) => conversation.id) }, author: { in: ["PROSPECT", "AI", "STAFF"] } },
        orderBy: { createdAt: "asc" },
        select: { conversationId: true, author: true, body: true, createdAt: true },
      })
    : [];

  const byConversation = new Map<string, typeof messages>();
  for (const message of messages) {
    const list = byConversation.get(message.conversationId) ?? [];
    list.push(message);
    byConversation.set(message.conversationId, list);
  }
  let outsideWindow = 0;
  let sentInWindow = 0;
  let openers = 0;
  let openersDisclosed = 0;
  let handedOff = 0;
  for (const list of byConversation.values()) {
    let lastProspect: Date | null = null;
    let openerSeen = false;
    if (list.some((message) => message.author === "STAFF")) handedOff += 1;
    for (const message of list) {
      if (message.author === "PROSPECT") {
        lastProspect = message.createdAt;
        continue;
      }
      if (!lastProspect) {
        if (!openerSeen && message.author === "AI") {
          openers += 1;
          if (disclosesAutomation(message.body)) openersDisclosed += 1;
        }
        openerSeen = true;
        continue;
      }
      if (message.createdAt.getTime() - lastProspect.getTime() > DAY) outsideWindow += 1;
      else sentInWindow += 1;
    }
  }

  const accepted = attempts.filter((attempt) => attempt.status === "ACCEPTED");
  const perComment = new Map<string, number>();
  for (const attempt of accepted) perComment.set(attempt.commentExternalId, (perComment.get(attempt.commentExternalId) ?? 0) + 1);
  const duplicateOpeners = [...perComment.values()].filter((count) => count > 1).length;
  const perHour = new Map<string, number>();
  for (const attempt of accepted.filter((item) => item.createdAt >= since7)) {
    const hour = attempt.createdAt.toISOString().slice(0, 13);
    perHour.set(hour, (perHour.get(hour) ?? 0) + 1);
  }
  const peakHour = Math.max(0, ...perHour.values());
  const openers24h = accepted.filter((attempt) => attempt.createdAt >= since24h).length;
  const failures = attempts.filter((attempt) => attempt.status === "RETRYABLE_FAILURE" || attempt.status === "PERMANENT_FAILURE");
  const limitErrors = failures.filter((attempt) => RATE_LIMIT.test(attempt.lastError ?? ""));
  const limitErrors24h = limitErrors.filter((attempt) => attempt.createdAt >= since24h).length;

  const skipped = decisions.filter((decision) => decision.outcome === "SKIPPED");
  const skipReasons = new Map<string, number>();
  for (const decision of skipped) skipReasons.set(decision.reason, (skipReasons.get(decision.reason) ?? 0) + 1);
  const skipRows = [...skipReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const webhookTotal = webhooks.reduce((sum, row) => sum + row._count, 0);
  const webhookRejected = webhooks.filter((row) => row.status === "REJECTED").reduce((sum, row) => sum + row._count, 0);

  const activeConnections = connections.filter((connection) => !connection.revokedAt);
  const checks: Check[] = [
    { label: "Messages sent outside the 24-hour window", value: outsideWindow, good: outsideWindow === 0, detail: `Every DM after the opener must follow a customer message within 24 hours. ${sentInWindow} replies were inside the window.` },
    { label: "Comments that got more than one opener", value: duplicateOpeners, good: duplicateOpeners === 0, detail: "Meta allows one private reply per comment. Each comment is reserved before sending." },
    { label: "Openers that disclose automation", value: openers ? `${openersDisclosed}/${openers}` : "–", good: openersDisclosed === openers, detail: "The first message says it is an automated assistant." },
    { label: "Rate-limit or spam errors from Meta (24h)", value: limitErrors24h, good: limitErrors24h === 0, detail: `${limitErrors.length} in the last 30 days. Any error here is an early warning sign.` },
    { label: "Opted-out contacts never messaged again", value: optedOut, good: true, detail: "Anyone who says stop, unsubscribe or don't message is blocked from all automation." },
    { label: "Unsigned or rejected webhooks (7d)", value: webhookRejected, good: true, detail: `${webhookTotal} signed events accepted. Unsigned calls are refused before they reach the app.` },
  ];
  const problems = checks.filter((check) => !check.good).length + (activeConnections.length === 0 ? 1 : 0);
  const warnings = failures.filter((attempt) => attempt.createdAt >= since7).length;
  const overall = problems ? "stop" : warnings ? "wait" : "ok";

  const safeguards = [
    ["Replies only to real comments", "The assistant never starts a conversation on its own. There is no broadcast or bulk messaging feature."],
    ["One private reply per comment", "Each comment is reserved once, so a person cannot receive the opener twice for the same comment."],
    ["Seven-day private reply window", "Comments older than seven days never get an opener, as Meta requires."],
    ["24-hour messaging window", "After the opener, the assistant only replies after the person writes back, and only within 24 hours of their last message."],
    ["Cooldown per person and post", "The same person commenting again on the same post does not get another opener within the cooldown period."],
    ["Clear automation disclosure", "The opener says it is an automated assistant, and the assistant never claims to be a human."],
    ["Opt-out respected instantly", "Stop, unsubscribe or don't message blocks every future automated message to that person."],
    ["Human handoff on request", "If someone asks for a person, the assistant stops and a team member takes over the chat."],
    ["Safe content only", "The assistant never asks for passwords, OTPs, card numbers or payment, and never invents prices or bookings."],
    ["Unsupported places skipped", "Paid ad comments, live video comments and Facebook Groups are never answered automatically."],
    ["Pause switches", "Automation can be paused for the whole platform, a workspace, or a single connected account."],
    ["Verified Meta webhooks", "Every incoming event must carry Meta's signature, and duplicates are ignored."],
  ];

  return (
    <section>
      <PageTitle title="Compliance" detail="How Instagram and Facebook messaging rules are followed, with live checks from real activity in the last 30 days." />

      <Panel className="mb-4 flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">Account safety status</p>
          <p className="mt-1 text-[22px] font-semibold tracking-tight">
            {overall === "ok" ? "All checks passing" : overall === "wait" ? "Passing, with send errors to review" : `${problems} check${problems === 1 ? "" : "s"} need attention`}
          </p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">Checked {fullIST(now)}.</p>
        </div>
        <StatusLabel tone={overall}>{overall === "ok" ? "Healthy" : overall === "wait" ? "Review" : "Action needed"}</StatusLabel>
      </Panel>

      <StatGrid columns={5} items={[
        { label: "Openers in 24h", value: openers24h },
        { label: "Peak openers in one hour", value: peakHour },
        { label: "Comments skipped by rules", value: skipped.length },
        { label: "Handed to a person", value: handedOff },
        { label: "Send errors (7d)", value: warnings },
      ]} />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel className="p-5">
          <h2 className="text-[15px] font-semibold">Live policy checks</h2>
          <ul className="mt-3 divide-y divide-[var(--color-line)]">
            {checks.map((check) => (
              <li key={check.label} className="py-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{check.label}</span>
                  <span className="flex items-center gap-2"><span className="font-semibold">{check.value}</span><StatusLabel tone={check.good ? "ok" : "stop"}>{check.good ? "Pass" : "Check"}</StatusLabel></span>
                </div>
                <p className="mt-1 text-[13px] text-[var(--color-muted)]">{check.detail}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="grid gap-4">
          <Panel className="p-5">
            <h2 className="text-[15px] font-semibold">Connected accounts</h2>
            {connections.length ? (
              <ul className="mt-3 space-y-3 text-sm">
                {connections.map((connection) => (
                  <li key={connection.id} className="rounded-xl border border-[var(--color-line)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2"><ChannelMark channel={connection.channel} /><span className="font-medium">@{connection.username ?? connection.displayName}</span></span>
                      <StatusLabel tone={connection.revokedAt ? "stop" : connection.automationPaused ? "wait" : "ok"}>{connection.revokedAt ? "Disconnected" : connection.automationPaused ? "Paused" : "Active"}</StatusLabel>
                    </div>
                    <p className="mt-2 text-[13px] text-[var(--color-muted)]">
                      Webhook {connection.webhookVerifiedAt ? "verified" : "not verified"} · Subscribed to {connection.subscribedFields.join(", ") || "nothing"} · Last comment {connection.lastRealCommentAt ? whenIST(connection.lastRealCommentAt) : "none yet"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-[var(--color-muted)]">No live accounts connected.</p>}
            <p className="mt-3 text-[13px] text-[var(--color-muted)]">Workspace automation: <span className="font-medium text-[var(--color-ink)]">{workspace.automationPaused ? "Paused" : "On"}</span></p>
          </Panel>

          <Panel className="p-5">
            <h2 className="text-[15px] font-semibold">Why comments were skipped</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">Comments the rules stopped from getting an opener.</p>
            {skipRows.length ? (
              <ul className="mt-3 space-y-2 text-sm">
                {skipRows.map(([reason, count]) => (
                  <li key={reason} className="flex justify-between gap-3"><span>{reason}</span><span className="font-semibold">{count}</span></li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-[var(--color-muted)]">No comments skipped in the last 30 days.</p>}
          </Panel>
        </div>
      </div>

      {limitErrors.length ? (
        <Panel className="mt-4 p-5">
          <h2 className="text-[15px] font-semibold">Meta warnings</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {limitErrors.slice(-5).reverse().map((attempt, index) => (
              <li key={index} className="flex flex-wrap gap-x-3 gap-y-1"><ChannelMark channel={attempt.channel} /><span className="text-[var(--color-muted)]">{whenIST(attempt.createdAt)}</span><span>{(attempt.lastError ?? "").slice(0, 160)}</span></li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel className="mt-4 p-5">
        <h2 className="text-[15px] font-semibold">Safeguards built into the product</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">Enforced in code on every message, not just written in a policy.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {safeguards.map(([title, body]) => (
            <div key={title} className="rounded-xl border border-[var(--color-line)] p-3">
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-1 text-[13px] text-[var(--color-muted)]">{body}</p>
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}

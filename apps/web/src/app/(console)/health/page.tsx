import { getPrisma } from "@snapsocial/db";
import { Empty, PageTitle, StatusLabel } from "@/components/ui";
import { agoIST, fullIST } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";

function Row({ label, detail, children }: { label: string; detail?: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {detail ? <p className="text-[13px] text-[var(--color-muted)]">{detail}</p> : null}
      </div>
      {children}
    </li>
  );
}

export default async function HealthPage() {
  const { workspace, role } = await requireWorkspace();
  if (role === "VIEWER" || role === "AGENT") return <Empty title="Admins only" body="System health is visible to admins." />;
  let database = false;
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }
  const heartbeat = await getPrisma().workerHeartbeat.findUnique({ where: { id: "worker" } }).catch(() => null);
  const scope = role === "SUPER_ADMIN" ? {} : { workspaceId: workspace?.id ?? "" };
  const oldest = await getPrisma().outboxJob.findFirst({ where: { ...scope, status: { in: ["PENDING", "DISPATCHED"] } }, orderBy: { createdAt: "asc" } });
  const unknown = await getPrisma().outboundAttempt.count({ where: { ...scope, status: "UNKNOWN" } });
  const fresh = heartbeat ? Date.now() - heartbeat.seenAt.getTime() < 5 * 60_000 : false;
  const llm = process.env.LLM_MODE ?? "fixture";
  const practiceReplies = llm === "fixture";
  return (
    <section className="max-w-3xl">
      <PageTitle title="Health" detail="Whether the parts that send replies are running. If the reply model is unavailable, chats go to the team instead." />
      <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-card)]">
        <Row label="Database">
          <StatusLabel tone={database ? "ok" : "stop"}>{database ? "Running" : "Unavailable"}</StatusLabel>
        </Row>
        <Row label="Reply sender" detail={heartbeat ? `Last seen ${agoIST(heartbeat.seenAt)} · ${fullIST(heartbeat.seenAt)}` : "Has not checked in yet."}>
          <StatusLabel tone={heartbeat ? (fresh ? "ok" : "wait") : "wait"}>{heartbeat ? (fresh ? "Running" : "Quiet") : "Waiting"}</StatusLabel>
        </Row>
        <Row label="Oldest message waiting to send" detail={oldest ? fullIST(oldest.createdAt) : "Nothing is waiting."}>
          <StatusLabel tone={oldest ? "wait" : "ok"}>{oldest ? agoIST(oldest.createdAt) : "Clear"}</StatusLabel>
        </Row>
        <Row label="Sends with no confirmation" detail="Messages where Meta did not confirm delivery either way.">
          <StatusLabel tone={unknown ? "wait" : "ok"}>{unknown}</StatusLabel>
        </Row>
        <Row label="Reply model" detail={practiceReplies ? "Using practice replies, not the live model." : "Using the live model."}>
          <StatusLabel tone={practiceReplies ? "sim" : "ok"}>{practiceReplies ? "Practice" : "Live"}</StatusLabel>
        </Row>
      </ul>
    </section>
  );
}

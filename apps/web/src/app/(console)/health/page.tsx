import { getPrisma } from "@snapsocial/db";
import { PageTitle, StatusLabel } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

export default async function HealthPage() {
  const { workspace, role } = await requireWorkspace();
  if (role === "VIEWER" || role === "AGENT") return <p>Permission denied.</p>;
  let database = "Unavailable";
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    database = "Reachable";
  } catch {
    database = "Unavailable";
  }
  const heartbeat = await getPrisma().workerHeartbeat.findUnique({ where: { id: "worker" } }).catch(() => null);
  const scope = role === "SUPER_ADMIN" ? {} : { workspaceId: workspace?.id ?? "" };
  const oldest = await getPrisma().outboxJob.findFirst({ where: { ...scope, status: { in: ["PENDING", "DISPATCHED"] } }, orderBy: { createdAt: "asc" } });
  const unknown = await getPrisma().outboundAttempt.count({ where: { ...scope, status: "UNKNOWN" } });
  return (
    <section>
      <PageTitle title="System health" detail="Inference stays private. A missing model routes chats to staff." />
      <ul className="grid gap-2 text-sm">
        <li>Database <StatusLabel tone={database === "Reachable" ? "ok" : "stop"}>{database}</StatusLabel></li>
        <li>Worker {heartbeat ? <StatusLabel tone="ok">{heartbeat.seenAt.toISOString()} · {heartbeat.detail}</StatusLabel> : <StatusLabel tone="wait">No heartbeat yet</StatusLabel>}</li>
        <li>Oldest queued job {oldest ? oldest.createdAt.toISOString() : "none"}</li>
        <li>Unknown sends {unknown}</li>
        <li>LLM mode {process.env.LLM_MODE ?? "fixture"}. Fixture mode is labelled and is not a live model.</li>
      </ul>
    </section>
  );
}

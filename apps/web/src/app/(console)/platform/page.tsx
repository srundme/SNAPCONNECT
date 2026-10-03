import { getPrisma } from "@snapsocial/db";
import { switchWorkspace } from "@/lib/actions";
import { Empty, PageTitle, StatusLabel } from "@/components/ui";
import { requireActor } from "@/lib/session";

export default async function PlatformPage() {
  const actor = await requireActor();
  if (actor.platformRole !== "SUPER_ADMIN") return <Empty title="Permission denied" body="Platform controls belong to the owner." />;
  const workspaces = await getPrisma().workspace.findMany({ include: { connections: true }, orderBy: { name: "asc" } });
  const paused = await getPrisma().platformSetting.findUnique({ where: { id: "platform" } });
  return (
    <section>
      <PageTitle title="Platform" detail="Cross-workspace entry is explicit and audited. Client brands are separate workspaces." />
      <p className="mb-4 text-sm">Global automation {paused?.automationPaused ? "paused" : "running"}.</p>
      <ul className="divide-y divide-[var(--color-line)]">
        {workspaces.map((workspace) => (
          <li key={workspace.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <span>{workspace.name} <StatusLabel tone={workspace.mode === "SIMULATION" ? "sim" : "neutral"}>{workspace.mode}</StatusLabel> <StatusLabel tone={workspace.status === "ACTIVE" ? "ok" : "stop"}>{workspace.status}</StatusLabel></span>
            <form action={switchWorkspace}>
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <button type="submit">Enter</button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}

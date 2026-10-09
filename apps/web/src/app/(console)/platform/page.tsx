import { cookies } from "next/headers";
import { getPrisma } from "@snapsocial/db";
import { Empty, Notice, PageTitle } from "@/components/ui";
import { ClientCard, type ClientCardData } from "@/components/platform/client-card";
import { officeHours, outsideHours } from "@/components/platform/hours";
import { KpiTiles } from "@/components/reports/kpi-tiles";
import { istDayStart, isTestContact } from "@/components/reports/ist";
import { agoIST, fullIST } from "@/lib/format";
import { requireActor } from "@/lib/session";

const NAMES = { select: { username: true, displayName: true, chosenName: true } } as const;

function countBy<T>(rows: T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return counts;
}

export default async function PlatformPage() {
  const actor = await requireActor();
  if (actor.platformRole !== "SUPER_ADMIN") return <Empty title="Permission denied" body="Platform controls belong to the owner." />;
  const db = getPrisma();
  const now = new Date();
  const weekStart = istDayStart(now, 6);

  const [workspaces, platform, selected] = await Promise.all([
    db.workspace.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, brandName: true, mode: true, status: true, agentName: true, automationPaused: true, agentSettings: true,
        connections: { select: { id: true, channel: true, displayName: true, username: true, automationPaused: true, revokedAt: true }, orderBy: { channel: "asc" } },
        zoho: { select: { id: true } },
      },
    }),
    db.platformSetting.findUnique({ where: { id: "platform" } }),
    cookies().then((jar) => jar.get("ss_workspace")?.value),
  ]);
  if (!workspaces.length) {
    return (
      <section>
        <PageTitle title="Clients" detail="Every client workspace you run, at a glance." />
        <Empty title="No clients yet" body="When a client workspace is set up, it appears here with its channels, assistant and this week's numbers." />
      </section>
    );
  }

  const ids = workspaces.map((workspace) => workspace.id);
  const currentId = workspaces.find((workspace) => workspace.id === selected)?.id ?? workspaces[0]!.id;

  const [conversations, zohoLeads, hotLeads, aiMessages, latest] = await Promise.all([
    db.conversation.findMany({
      where: { workspaceId: { in: ids }, sandbox: false, createdAt: { gte: weekStart } },
      select: { workspaceId: true, contact: NAMES },
    }),
    db.lead.findMany({
      where: { workspaceId: { in: ids }, archivedAt: null, testRecord: false, crmState: "SYNCED", createdAt: { gte: weekStart } },
      select: { workspaceId: true, contact: NAMES },
    }),
    db.lead.findMany({
      where: { workspaceId: { in: ids }, archivedAt: null, testRecord: false, rating: "HOT", createdAt: { gte: weekStart } },
      select: { workspaceId: true, contact: NAMES },
    }),
    db.message.findMany({
      where: { workspaceId: { in: ids }, author: "AI", createdAt: { gte: weekStart }, conversation: { sandbox: false } },
      select: { workspaceId: true, createdAt: true, conversation: { select: { contact: NAMES } } },
    }),
    Promise.all(ids.map((workspaceId) => db.message.findMany({
      where: { workspaceId, author: { not: "SYSTEM" }, conversation: { sandbox: false } },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { createdAt: true, conversation: { select: { contact: NAMES } } },
    }))),
  ]);

  const real = <T extends { contact: Parameters<typeof isTestContact>[0] }>(rows: T[]) => rows.filter((row) => !isTestContact(row.contact));
  const chatCount = countBy(real(conversations), (row) => row.workspaceId);
  const zohoCount = countBy(real(zohoLeads), (row) => row.workspaceId);
  const hotCount = countBy(real(hotLeads), (row) => row.workspaceId);
  const offices = new Map(workspaces.map((workspace) => [workspace.id, officeHours(workspace.agentSettings)]));
  const afterHours = aiMessages.filter((message) => !isTestContact(message.conversation.contact) && outsideHours(message.createdAt, offices.get(message.workspaceId)!)).length;
  const lastAt = new Map(ids.map((id, index) => [id, latest[index]?.find((message) => !isTestContact(message.conversation.contact))?.createdAt ?? null]));

  const clients: ClientCardData[] = workspaces
    .map((workspace) => ({
      id: workspace.id,
      name: workspace.brandName.trim() || workspace.name,
      live: workspace.mode === "INTEGRATION",
      suspended: workspace.status !== "ACTIVE",
      assistant: workspace.agentName?.trim() || "Not named yet",
      replying: !workspace.automationPaused && !platform?.automationPaused && workspace.status === "ACTIVE",
      channels: workspace.connections.map((connection) => ({
        id: connection.id,
        channel: connection.channel,
        account: connection.displayName || (connection.username ? `@${connection.username}` : "Account"),
        state: connection.revokedAt ? "disconnected" as const : connection.automationPaused || workspace.automationPaused ? "paused" as const : "on" as const,
      })),
      zoho: Boolean(workspace.zoho),
      conversations: chatCount.get(workspace.id) ?? 0,
      zohoLeads: zohoCount.get(workspace.id) ?? 0,
      hotLeads: hotCount.get(workspace.id) ?? 0,
      lastActivity: lastAt.get(workspace.id) ? agoIST(lastAt.get(workspace.id), now) : "None yet",
      lastActivityFull: fullIST(lastAt.get(workspace.id)),
      current: workspace.id === currentId,
    }))
    .sort((a, b) => Number(b.live) - Number(a.live));

  const liveIds = new Set(clients.filter((client) => client.live && !client.suspended).map((client) => client.id));
  const sum = (counts: Map<string, number>) => [...counts.values()].reduce((total, value) => total + value, 0);

  return (
    <section>
      <PageTitle title="Clients" detail="Every client workspace you run, at a glance." />
      {platform?.automationPaused ? (
        <Notice tone="stop">Automatic replies are paused for every client. No assistant is answering until they are switched back on.</Notice>
      ) : null}
      <KpiTiles
        className="mb-6 md:grid-cols-2! xl:grid-cols-4!"
        items={[
          { label: "Live clients", value: liveIds.size, note: `${clients.length - liveIds.size} in practice or suspended`, emphasis: true },
          { label: "Conversations this week", value: sum(chatCount), note: "New chats, last 7 days" },
          { label: "Leads in Zoho this week", value: sum(zohoCount), note: "Sent to the client's CRM" },
          { label: "Answered after hours", value: afterHours, note: "Assistant replies outside each client's working hours, this week" },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {clients.map((client) => <ClientCard key={client.id} client={client} />)}
      </div>
    </section>
  );
}

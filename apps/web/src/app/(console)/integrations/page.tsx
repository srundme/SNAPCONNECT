import { getPrisma } from "@snapsocial/db";
import { pauseConnection } from "@/lib/actions";
import { Empty, PageTitle, StatusLabel } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

function stamp(ok: boolean | null, at: Date | null, present: string, missing: string) {
  if (ok === null || !at) return <StatusLabel tone="neutral">{missing}</StatusLabel>;
  return <StatusLabel tone={ok ? "ok" : "stop"}>{present} · {at.toISOString()}</StatusLabel>;
}

export default async function IntegrationsPage() {
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER" || role === "AGENT") return <Empty title="Permission denied" body="Integration settings are limited to admins." />;
  const [connections, zoho] = await Promise.all([
    getPrisma().channelConnection.findMany({ where: { workspaceId: workspace.id } }),
    getPrisma().zohoConnection.findUnique({ where: { workspaceId: workspace.id } }),
  ]);
  return (
    <section>
      <PageTitle title="Integrations" detail="Instagram, Facebook and Zoho are separate. One successful callback does not make both channels live." />
      <div className="grid gap-6">
        {connections.map((connection) => (
          <article key={connection.id} className="border border-[var(--color-line)] bg-white p-4">
            <h2 className="font-semibold">{connection.channel === "INSTAGRAM" ? "Instagram" : "Facebook Page / Messenger"} · {connection.displayName}</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">Account {connection.externalAccountId}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {stamp(connection.mode === "SIMULATION" ? null : Boolean(connection.credentialCheckedAt), connection.credentialCheckedAt, "Credential checked", connection.mode === "SIMULATION" ? "Simulated credential" : "Credential not checked")}
              {stamp(Boolean(connection.webhookVerifiedAt), connection.webhookVerifiedAt, "Webhook verified", "Webhook not verified")}
              {stamp(Boolean(connection.accountSubscribedAt), connection.accountSubscribedAt, "Account subscribed", "Account not subscribed")}
              {stamp(Boolean(connection.lastRealCommentAt), connection.lastRealCommentAt, "Real event received", connection.lastSimulatedEventAt ? "Simulated event only" : "No real event")}
            </div>
            <p className="mt-3 text-sm">Scopes recorded: {connection.scopes.join(", ") || "None"}</p>
            {connection.channel === "FACEBOOK" ? <p className="text-sm">Page tasks: {connection.pageTasks.join(", ") || "Not recorded"} · Reels {connection.facebookReelsVerified ? "verified" : "unsupported until a real test"}</p> : null}
            <div className="mt-3 flex gap-3 text-sm">
              <a href={`/api/oauth/${connection.channel === "INSTAGRAM" ? "instagram" : "facebook"}/start?workspaceId=${workspace.id}`}>Reconnect</a>
              <form action={pauseConnection}>
                <input type="hidden" name="connectionId" value={connection.id} />
                <input type="hidden" name="paused" value={String(!connection.automationPaused)} />
                <button type="submit">{connection.automationPaused ? "Resume automation" : "Pause automation"}</button>
              </form>
            </div>
          </article>
        ))}
        <article className="border border-[var(--color-line)] bg-white p-4">
          <h2 className="font-semibold">Zoho CRM</h2>
          <p className="mt-2 text-sm">{zoho ? `${zoho.mode === "SIMULATION" ? "Mock sink" : "Integration"} · API domain ${zoho.apiDomain ?? "not verified"}` : "Not connected. Live sync stays pending."}</p>
          <p className="mt-2 text-sm"><a href={`/api/oauth/zoho/start?workspaceId=${workspace.id}`}>Connect Zoho</a></p>
        </article>
      </div>
    </section>
  );
}

import { getPrisma } from "@snapsocial/db";
import { pauseConnection } from "@/lib/actions";
import { Empty, PageTitle, StatusLabel } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

function stamp(ok: boolean | null, at: Date | null, present: string, missing: string) {
  if (ok === null || !at) return <StatusLabel tone="neutral">{missing}</StatusLabel>;
  return <StatusLabel tone={ok ? "ok" : "stop"}>{present} · {at.toISOString()}</StatusLabel>;
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const params = await searchParams;
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER" || role === "AGENT") return <Empty title="Permission denied" body="Integration settings are limited to admins." />;
  const [connections, zoho] = await Promise.all([
    getPrisma().channelConnection.findMany({ where: { workspaceId: workspace.id } }),
    getPrisma().zohoConnection.findUnique({ where: { workspaceId: workspace.id } }),
  ]);
  const live = workspace.mode === "INTEGRATION";
  return (
    <section>
      <PageTitle
        title="Integrations"
        detail="Instagram, Facebook and Zoho are separate. One successful callback does not make both channels live."
        action={live ? (
          <div className="flex flex-wrap gap-2 text-sm">
            <a className="rounded-md bg-[var(--color-accent-ink)] px-3 py-2 font-medium text-white" href={`/api/oauth/instagram/start?workspaceId=${workspace.id}`}>Connect Instagram</a>
            <a className="rounded-md border border-[var(--color-line)] bg-white px-3 py-2 font-medium" href={`/api/oauth/facebook/start?workspaceId=${workspace.id}`}>Connect Facebook Page</a>
          </div>
        ) : null}
      />
      {params.connected ? (
        <p className="mb-4 rounded-lg border border-[#99f6e4] bg-[#f0fdfa] px-3 py-2 text-sm text-[#115e59]">
          Connected {params.connected}. <a className="font-semibold underline" href="/posts">Set up replies</a> next. Automation stays off until you turn it on there.
        </p>
      ) : null}
      {params.error ? (
        <p className="mb-4 rounded-lg border border-[#fecdd3] bg-[#fff1f2] px-3 py-2 text-sm text-[#9f1239]">{params.error}</p>
      ) : null}
      {live && connections.length === 0 ? (
        <p className="mb-4 text-sm text-[var(--color-muted)]">No account is connected yet. Use Connect Instagram or Connect Facebook Page and log in with your own professional account.</p>
      ) : null}
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
          <p className="mt-2 text-sm">{zoho?.mode === "INTEGRATION" ? `Connected · ${zoho.apiDomain ?? "API domain not recorded"}` : "Not connected. Ready leads stay in SnapServe until this login succeeds."}</p>
          {live ? <p className="mt-3 text-sm"><a className="font-medium text-[var(--color-accent-ink)]" href={`/api/oauth/zoho/start?workspaceId=${workspace.id}`}>{zoho?.mode === "INTEGRATION" ? "Reconnect Zoho" : "Connect Zoho"}</a></p> : <p className="mt-3 text-sm text-[var(--color-muted)]">Switch to Own accounts before connecting Zoho.</p>}
          <ol className="mt-4 grid list-decimal gap-2 pl-5 text-sm text-[var(--color-muted)]">
            <li>In Zoho API Console, create a Server-based client. Self Client cannot connect this app.</li>
            <li>Redirect URL: https://web-production-79fdf.up.railway.app/api/oauth/zoho/callback</li>
            <li>If the CRM opens on zoho.in, the server accounts host must be https://accounts.zoho.in. Bangalore does not decide that by itself.</li>
            <li>Add the client id and secret on the server, then use Connect Zoho and approve Leads access.</li>
            <li>In Zoho, add Facebook and Instagram to the Lead Source list, or the first sync will be rejected.</li>
            <li>Choose what to collect and when to send on the Leads page.</li>
          </ol>
        </article>
      </div>
    </section>
  );
}

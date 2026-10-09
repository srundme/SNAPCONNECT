import { Check, Minus, RefreshCw } from "lucide-react";
import { getPrisma } from "@snapsocial/db";
import { connectWhatsApp, pauseConnection } from "@/lib/actions";
import { ChannelGlyph, Disclosure, Empty, Notice, PageTitle, StatusLabel } from "@/components/ui";
import { fullIST, whenIST } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";

type Channel = "INSTAGRAM" | "FACEBOOK" | "WHATSAPP";

function channelName(channel: Channel) {
  if (channel === "INSTAGRAM") return "Instagram";
  if (channel === "WHATSAPP") return "WhatsApp Business";
  return "Facebook Page";
}

const tile: Record<Channel, string> = {
  INSTAGRAM: "bg-[#fdf2f6] text-[var(--color-ig)]",
  FACEBOOK: "bg-[#eff4ff] text-[var(--color-fb)]",
  WHATSAPP: "bg-[#ecfdf3] text-[var(--color-wa)]",
};

function CheckItem({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={ok ? "grid h-5 w-5 place-items-center rounded-full bg-[#f4ead2] text-[var(--color-accent-ink)]" : "grid h-5 w-5 place-items-center rounded-full bg-[#f1efeb] text-[#a39a8d]"}>
        {ok ? <Check size={12} strokeWidth={3} aria-hidden /> : <Minus size={12} strokeWidth={3} aria-hidden />}
      </span>
      <span className={ok ? "" : "text-[var(--color-muted)]"}>{children}</span>
      <span className="sr-only">{ok ? "(done)" : "(not yet)"}</span>
    </li>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="break-all font-mono text-[12px] leading-5">{value}</dd>
    </div>
  );
}

const linkButton = "inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--color-line)] bg-white px-3.5 py-2 text-sm font-semibold transition-colors hover:border-[#d9cfbf] hover:bg-[#faf7f2]";
const primaryLink = "inline-flex items-center gap-1.5 rounded-[10px] bg-[var(--color-accent)] px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#745722]";

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const params = await searchParams;
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER" || role === "AGENT") return <Empty title="Admins only" body="Connections are managed by an admin." />;
  const [connections, zoho] = await Promise.all([
    getPrisma().channelConnection.findMany({ where: { workspaceId: workspace.id }, orderBy: [{ channel: "asc" }, { displayName: "asc" }] }),
    getPrisma().zohoConnection.findUnique({ where: { workspaceId: workspace.id } }),
  ]);
  const live = workspace.mode === "INTEGRATION";
  const agent = workspace.agentName?.trim() || "The assistant";
  const whatsapp = connections.find((connection) => connection.channel === "WHATSAPP" && connection.mode === "INTEGRATION" && !connection.revokedAt);
  const zohoLive = zoho?.mode === "INTEGRATION";
  return (
    <section>
      <PageTitle
        title="Connections"
        detail="Each channel is connected on its own. Connecting one does not switch on the others."
        action={live ? (
          <div className="flex flex-wrap gap-2">
            <a className={primaryLink} href={`/api/oauth/instagram/start?workspaceId=${workspace.id}`}>Connect Instagram</a>
            <a className={linkButton} href={`/api/oauth/facebook/start?workspaceId=${workspace.id}`}>Connect Facebook Page</a>
          </div>
        ) : null}
      />

      <p className="mb-5 flex items-start gap-2 text-[13px] text-[var(--color-muted)]">
        <span className={live ? "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#3f9a62]" : "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#a39a8d]"} aria-hidden />
        {live
          ? "Live workspace. A channel replies to customers only once it is connected and replies are switched on."
          : "Practice workspace. Nothing here is sent to Instagram, Facebook, WhatsApp or Zoho."}
      </p>

      {params.connected ? (
        <Notice tone="ok">
          {params.connected} is connected. <a className="font-semibold underline" href="/posts">Set up replies</a> next. Replies stay off until you switch them on.
        </Notice>
      ) : null}
      {params.error ? <Notice tone="stop">{params.error}</Notice> : null}
      {live && connections.length === 0 ? (
        <p className="mb-4 text-sm text-[var(--color-muted)]">Nothing is connected yet. Use Connect Instagram or Connect Facebook Page and sign in with the business account.</p>
      ) : null}

      <div className="grid gap-4">
        {connections.map((connection) => {
          const practice = connection.mode === "SIMULATION";
          const paused = connection.automationPaused || workspace.automationPaused;
          const scopes = connection.scopes.join(" ").toLowerCase();
          const fields = connection.subscribedFields.join(" ").toLowerCase();
          const messagesOk = connection.channel === "WHATSAPP"
            ? Boolean(connection.credentialCheckedAt)
            : /messag/.test(scopes) || /messag/.test(fields);
          const commentsOk = /comment|engagement|read_user_content/.test(scopes) || /comment|feed/.test(fields);
          const lastMessage = connection.lastRealMessageAt;
          const lastComment = connection.lastRealCommentAt;
          const status = connection.revokedAt
            ? <StatusLabel tone="stop">Needs reconnect</StatusLabel>
            : practice
              ? <StatusLabel tone="sim">Practice</StatusLabel>
              : paused
                ? <StatusLabel tone="wait">Connected · Paused</StatusLabel>
                : <StatusLabel tone="ok">Connected · {agent} replying</StatusLabel>;
          return (
            <article key={connection.id} className="rounded-2xl bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
              <div className="flex flex-wrap items-start gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tile[connection.channel]}`}>
                  <ChannelGlyph channel={connection.channel} size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[16px] font-semibold tracking-tight">{connection.displayName}</h2>
                  <p className="text-[13px] text-[var(--color-muted)]">
                    {channelName(connection.channel)}
                    {connection.username ? ` · @${connection.username}` : ""}
                  </p>
                </div>
                {status}
              </div>

              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                <CheckItem ok={messagesOk}>Messages</CheckItem>
                {connection.channel !== "WHATSAPP" ? <CheckItem ok={commentsOk}>Comments</CheckItem> : null}
                <CheckItem ok={Boolean(connection.webhookVerifiedAt)}>Webhook verified</CheckItem>
                <CheckItem ok={Boolean(lastMessage)}>
                  Last message received <span className="font-medium text-[var(--color-ink)]">{lastMessage ? whenIST(lastMessage) : "none yet"}</span>
                </CheckItem>
                {connection.channel !== "WHATSAPP" ? (
                  <CheckItem ok={Boolean(lastComment)}>
                    Last comment received <span className="font-medium text-[var(--color-ink)]">{lastComment ? whenIST(lastComment) : "none yet"}</span>
                  </CheckItem>
                ) : null}
              </ul>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-4">
                {connection.channel === "WHATSAPP"
                  ? <a className={linkButton} href="#whatsapp"><RefreshCw size={14} aria-hidden />Reconnect</a>
                  : <a className={linkButton} href={`/api/oauth/${connection.channel === "INSTAGRAM" ? "instagram" : "facebook"}/start?workspaceId=${workspace.id}`}><RefreshCw size={14} aria-hidden />Reconnect</a>}
                <form action={pauseConnection}>
                  <input type="hidden" name="connectionId" value={connection.id} />
                  <input type="hidden" name="paused" value={String(!connection.automationPaused)} />
                  <button type="submit">{connection.automationPaused ? "Resume replies" : "Pause replies"}</button>
                </form>
                {workspace.automationPaused && !connection.automationPaused ? (
                  <span className="text-[12px] text-[var(--color-muted)]">Replies are paused for the whole workspace.</span>
                ) : null}
              </div>

              <Disclosure summary="Technical details" className="mt-3">
                <dl className="grid gap-2 rounded-xl bg-[var(--color-paper)] p-3 text-[13px]">
                  <Fact label={connection.channel === "WHATSAPP" ? "Phone number ID" : "Account ID"} value={connection.externalAccountId} />
                  <Fact label="Sign-in checked" value={fullIST(connection.credentialCheckedAt)} />
                  <Fact label="Webhook verified" value={fullIST(connection.webhookVerifiedAt)} />
                  <Fact label="Account subscribed" value={fullIST(connection.accountSubscribedAt)} />
                  <Fact label="Permissions" value={connection.scopes.join(", ") || "—"} />
                  <Fact label="Subscribed to" value={connection.subscribedFields.join(", ") || "—"} />
                  {connection.channel === "FACEBOOK" ? (
                    <>
                      <Fact label="Page roles" value={connection.pageTasks.join(", ") || "—"} />
                      <Fact label="Reels replies" value={connection.facebookReelsVerified ? "Verified" : "Not yet tested"} />
                    </>
                  ) : null}
                  {connection.lastSimulatedEventAt ? <Fact label="Last practice event" value={fullIST(connection.lastSimulatedEventAt)} /> : null}
                  {connection.revokedAt ? <Fact label="Disconnected" value={fullIST(connection.revokedAt)} /> : null}
                </dl>
              </Disclosure>
            </article>
          );
        })}

        <article id="whatsapp" className="scroll-mt-20 rounded-2xl bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
          <div className="flex flex-wrap items-start gap-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tile.WHATSAPP}`}>
              <ChannelGlyph channel="WHATSAPP" size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[16px] font-semibold tracking-tight">{whatsapp ? "Reconnect WhatsApp" : "Connect WhatsApp"}</h2>
              <p className="text-[13px] text-[var(--color-muted)]">
                {whatsapp ? `${whatsapp.displayName} is connected. Paste a new token to reconnect.` : "Customers who message your WhatsApp Business number chat with the assistant, and the chats show in the Inbox."}
              </p>
            </div>
            {whatsapp ? <StatusLabel tone="ok">Connected</StatusLabel> : <StatusLabel tone="neutral">Not connected</StatusLabel>}
          </div>
          {live ? (
            <form action={connectWhatsApp} className="mt-4 grid max-w-xl gap-3">
              <label>
                Phone number ID
                <input name="phoneNumberId" inputMode="numeric" autoComplete="off" required placeholder="From WhatsApp › API Setup" />
              </label>
              <label>
                WhatsApp Business Account ID
                <input name="businessAccountId" inputMode="numeric" autoComplete="off" required placeholder="From WhatsApp › API Setup" />
              </label>
              <label>
                Permanent access token
                <input name="accessToken" type="password" autoComplete="off" required placeholder="System user token" />
              </label>
              <div>
                <button className="border-transparent bg-[var(--color-accent)] px-4 text-white hover:bg-[#745722]" type="submit">{whatsapp ? "Reconnect WhatsApp" : "Connect WhatsApp"}</button>
              </div>
            </form>
          ) : <p className="mt-3 text-sm text-[var(--color-muted)]">Switch to the live workspace to connect WhatsApp.</p>}
          <Disclosure summary="Setup steps" className="mt-4">
            <ol className="grid list-decimal gap-2 pl-5 text-[13px] text-[var(--color-muted)]">
              <li>In the Meta app, add WhatsApp and register the business phone number.</li>
              <li>In Business Settings, create a system user, give it the WhatsApp account, and generate a permanent token with whatsapp_business_messaging and whatsapp_business_management.</li>
              <li>Webhook callback URL: <span className="break-all">https://web-production-79fdf.up.railway.app/api/webhooks/meta/whatsapp</span>, subscribed to the messages field.</li>
              <li>The token is stored encrypted and never shown again. Replies stay paused until you resume them here.</li>
              <li>In Zoho, add WhatsApp to the Lead Source list. Until then, WhatsApp leads go in with the Facebook source and say WhatsApp in the description.</li>
            </ol>
          </Disclosure>
        </article>

        <article className="rounded-2xl bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
          <div className="flex flex-wrap items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f4ead2] text-[13px] font-bold text-[var(--color-accent-ink)]" aria-hidden>Z</span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[16px] font-semibold tracking-tight">Zoho CRM</h2>
              <p className="text-[13px] text-[var(--color-muted)]">
                {zohoLive ? "Ready leads are sent to Zoho automatically." : "Not connected. Ready leads wait here until Zoho is connected."}
              </p>
            </div>
            {zohoLive ? <StatusLabel tone="ok">Connected</StatusLabel> : <StatusLabel tone="neutral">Not connected</StatusLabel>}
          </div>
          <div className="mt-4">
            {live
              ? <a className={zohoLive ? linkButton : primaryLink} href={`/api/oauth/zoho/start?workspaceId=${workspace.id}`}>{zohoLive ? "Reconnect Zoho" : "Connect Zoho"}</a>
              : <p className="text-sm text-[var(--color-muted)]">Switch to the live workspace to connect Zoho.</p>}
          </div>
          {zohoLive && zoho?.apiDomain ? (
            <Disclosure summary="Technical details" className="mt-3">
              <dl className="grid gap-2 rounded-xl bg-[var(--color-paper)] p-3 text-[13px]">
                <Fact label="Zoho address" value={zoho.apiDomain} />
              </dl>
            </Disclosure>
          ) : null}
          <Disclosure summary="Setup steps" className="mt-3">
            <ol className="grid list-decimal gap-2 pl-5 text-[13px] text-[var(--color-muted)]">
              <li>In Zoho API Console, create a Server-based client. Self Client cannot connect.</li>
              <li>Redirect URL: <span className="break-all">https://web-production-79fdf.up.railway.app/api/oauth/zoho/callback</span></li>
              <li>If the CRM opens on zoho.in, the server accounts host must be https://accounts.zoho.in.</li>
              <li>Add the client id and secret on the server, then use Connect Zoho and approve Leads access.</li>
              <li>In Zoho, add Facebook and Instagram to the Lead Source list, or the first sync will be rejected.</li>
              <li>Choose what to collect and when to send on the Leads page.</li>
            </ol>
          </Disclosure>
        </article>
      </div>
    </section>
  );
}

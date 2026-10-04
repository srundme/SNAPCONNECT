import Link from "next/link";
import { getPrisma } from "@snapsocial/db";
import { refreshPosts } from "@/lib/actions";
import { ReplySetup } from "@/components/reply-setup";
import { ChannelMark, Empty, Notice } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";
import { clsx } from "clsx";

function typeLabel(value: string) {
  if (value === "REELS") return "Reel";
  if (value === "STORY") return "Story";
  if (value === "CAROUSEL_ALBUM") return "Carousel";
  if (value === "VIDEO") return "Video";
  if (value === "IMAGE") return "Photo";
  return "Post";
}

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ connectionId?: string; error?: string; saved?: string; loaded?: string; connected?: string; on?: string }> }) {
  const params = await searchParams;
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER" || role === "AGENT") return <Empty title="Permission denied" body="Replies are managed by an admin." />;
  const connections = await getPrisma().channelConnection.findMany({
    where: { workspaceId: workspace.id },
    include: { rules: { where: { active: true }, orderBy: [{ priority: "desc" }, { id: "asc" }] }, media: { orderBy: { publishedAt: "desc" } } },
  });
  const connection = connections.find((item) => item.id === params.connectionId) ?? connections[0];
  const rule = connection?.rules[0];
  const selected = new Set(rule?.coverage === "SELECTED_POSTS" ? rule.selectedMediaIds : []);
  const repliesOn = Boolean(connection && !connection.automationPaused && !workspace.automationPaused);
  const when = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: workspace.timezone });
  return (
    <section className="-mx-4 -my-5 flex h-[calc(100dvh-2.25rem)] flex-col gap-3 overflow-hidden px-4 py-4 sm:-mx-6 lg:-mx-8 lg:-my-7 lg:px-6">
      {params.connected ? <Notice tone="ok">{params.connected} is connected. Pick the posts, write the first message, then turn replies on.</Notice> : null}
      {params.error ? <Notice tone="stop">{params.error}</Notice> : null}
      {params.saved ? <Notice tone="ok">{params.on ? "Replies are on. A new comment gets the first message." : "Saved."}</Notice> : null}
      {params.loaded === "sample" ? <Notice tone="ok">Sample posts are ready.</Notice> : null}
      {params.loaded && params.loaded !== "sample" ? <Notice tone="ok">{params.loaded} posts loaded.</Notice> : null}
      {connections.length === 0 ? (
        <div>
          <Empty title="Connect Instagram first" body="Replies start after the account is connected." />
          {workspace.mode === "INTEGRATION" ? <a className="mt-4 inline-flex rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white" href={`/api/oauth/instagram/start?workspaceId=${workspace.id}`}>Connect Instagram</a> : null}
        </div>
      ) : connection ? (
        <>
          {connections.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {connections.map((item) => (
                <Link key={item.id} href={`/posts?connectionId=${item.id}`} className={clsx("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold", item.id === connection.id ? "bg-[var(--color-ink)] text-white" : "bg-white")}>
                  <ChannelMark channel={item.channel} />
                  {item.displayName}
                </Link>
              ))}
            </div>
          ) : null}
          <form id="reload-posts" action={refreshPosts} className="hidden">
            <input type="hidden" name="connectionId" value={connection.id} />
          </form>
          <ReplySetup
            connectionId={connection.id}
            accountName={connection.displayName}
            repliesOn={repliesOn}
            posts={connection.media.map((post) => ({
              externalId: post.externalId,
              caption: post.caption?.trim() || "",
              kind: typeLabel(post.contentType),
              previewUrl: post.previewUrl,
              when: post.publishedAt ? when.format(post.publishedAt) : null,
              permalink: post.permalink,
              supported: post.supportStatus === "SUPPORTED",
              enabled: rule?.coverage === "SELECTED_POSTS" ? selected.has(post.externalId) : post.supportStatus === "SUPPORTED",
              opening: post.openingMessage ?? "",
              prompt: post.assistantPrompt ?? "",
            }))}
          />
        </>
      ) : null}
    </section>
  );
}

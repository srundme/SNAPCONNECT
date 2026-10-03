import { getPrisma } from "@snapsocial/db";
import { selectRule } from "@snapsocial/domain";
import { saveRule } from "@/lib/actions";
import { Empty, PageTitle } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ preview?: string; connectionId?: string }> }) {
  const params = await searchParams;
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER" || role === "AGENT") return <Empty title="Permission denied" body="Rules are managed by an admin." />;
  const connections = await getPrisma().channelConnection.findMany({ where: { workspaceId: workspace.id }, include: { rules: true, media: true } });
  const connection = connections.find((item) => item.id === params.connectionId) ?? connections[0];
  const preview = connection && params.preview ? selectRule({
    rules: connection.rules.map((rule) => ({ ...rule, excludedMediaIds: connection.media.filter((item) => item.excluded).map((item) => item.externalId) })),
    text: params.preview,
    mediaId: connection.media[0]?.externalId ?? null,
    commentAt: new Date(),
  }) : null;
  return (
    <section>
      <PageTitle title="Posts & Rules" detail="ALL_POSTS covers future uploads. Importing old posts does not message historic comments." />
      {connections.length === 0 ? <Empty title="No connection" body="Connect Instagram or Facebook before adding a rule." /> : (
        <>
          <ul className="mb-6 text-sm">
            {connections.flatMap((item) => item.rules.map((rule) => (
              <li key={rule.id} className="border-b border-[var(--color-line)] py-2">{item.displayName}: {rule.name} · {rule.coverage} · {rule.commentFilter} · {rule.active ? "Active" : "Inactive"}</li>
            )))}
          </ul>
          <form className="grid max-w-xl gap-3 text-sm" action={saveRule}>
            <label>Connection
              <select name="connectionId" className="mt-1 block w-full border border-[var(--color-line)] bg-white px-2 py-1">
                {connections.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
              </select>
            </label>
            <label>Name<input name="name" className="mt-1 block w-full border border-[var(--color-line)] px-2 py-1" defaultValue="Keyword rule" /></label>
            <label>Coverage
              <select name="coverage" className="mt-1 block w-full border border-[var(--color-line)] bg-white px-2 py-1">
                <option value="ALL_POSTS">All eligible posts</option>
                <option value="SELECTED_POSTS">Selected posts</option>
              </select>
            </label>
            <label>Filter
              <select name="filter" className="mt-1 block w-full border border-[var(--color-line)] bg-white px-2 py-1">
                <option value="KEYWORDS">Keywords</option>
                <option value="ALL_ELIGIBLE_COMMENTS">All eligible comments</option>
              </select>
            </label>
            <label>Keywords<input name="keywords" className="mt-1 block w-full border border-[var(--color-line)] px-2 py-1" defaultValue="interiors, quote, design" /></label>
            <label>Selected media IDs<input name="selected" className="mt-1 block w-full border border-[var(--color-line)] px-2 py-1" /></label>
            <label>Opening template<textarea name="template" className="mt-1 block w-full border border-[var(--color-line)] px-2 py-1" rows={4} defaultValue="Hi! I'm the virtual assistant for Demo Interiors. Thanks for your interest. Are you planning interiors for a home or a commercial space?" /></label>
            <label>Cooldown hours<input name="cooldown" type="number" defaultValue={24} className="mt-1 block w-full border border-[var(--color-line)] px-2 py-1" /></label>
            <button className="bg-[var(--color-accent)] px-3 py-2 text-white" type="submit">Activate rule</button>
          </form>
          {connection ? (
            <form className="mt-6 flex gap-2 text-sm" method="get">
              <input type="hidden" name="connectionId" value={connection.id} />
              <input name="preview" placeholder="Dry-run a comment" className="border border-[var(--color-line)] px-2 py-1" />
              <button className="border border-[var(--color-line)] px-2 py-1" type="submit">Preview</button>
            </form>
          ) : null}
          {preview ? <p className="mt-3 text-sm">{preview.winner ? `Would use ${preview.winner.id}. ${preview.reason}` : preview.reason}</p> : null}
        </>
      )}
    </section>
  );
}

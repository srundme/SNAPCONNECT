import { getPrisma } from "@snapsocial/db";
import { inviteStaff, removeMember } from "@/lib/actions";
import { Empty, PageTitle } from "@/components/ui";
import { requireWorkspace } from "@/lib/session";

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const params = await searchParams;
  const { workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER" || role === "AGENT") return <Empty title="Permission denied" body="Team management is limited to admins." />;
  const members = await getPrisma().membership.findMany({ where: { workspaceId: workspace.id }, include: { user: true } });
  return (
    <section>
      <PageTitle title="Team" detail="Invitations are single-use and expire. An admin cannot grant platform owner access." />
      {params.token ? <p className="mb-4 text-sm">Share this one-time link manually: /invite/{params.token}</p> : null}
      <ul className="divide-y divide-[var(--color-line)] border-y border-[var(--color-line)] text-sm">
        {members.map((member) => (
          <li key={member.id} className="flex items-center justify-between py-2">
            <span>{member.user.email} · {member.role}</span>
            <form action={removeMember}><input type="hidden" name="userId" value={member.userId} /><button type="submit">Remove</button></form>
          </li>
        ))}
      </ul>
      <form action={inviteStaff} className="mt-6 grid max-w-md gap-2 text-sm">
        <input name="email" type="email" required placeholder="Email" className="border border-[var(--color-line)] px-2 py-1" />
        <select name="role" className="border border-[var(--color-line)] bg-white px-2 py-1"><option>AGENT</option><option>ADMIN</option><option>VIEWER</option></select>
        <button className="bg-[var(--color-accent)] px-3 py-2 text-white" type="submit">Create invitation</button>
      </form>
    </section>
  );
}

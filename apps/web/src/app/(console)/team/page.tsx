import { getPrisma } from "@snapsocial/db";
import { UserPlus } from "lucide-react";
import { inviteStaff, removeMember } from "@/lib/actions";
import { Empty, Notice, PageTitle, RoleChip } from "@/components/ui";
import { fullIST } from "@/lib/format";
import { requireWorkspace } from "@/lib/session";

const order: Record<string, number> = { ADMIN: 0, AGENT: 1, VIEWER: 2 };

function initials(name: string, email: string) {
  const parts = (name.trim() || email.replace(/@.*/, "")).split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "·";
}

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ token?: string; denied?: string }> }) {
  const params = await searchParams;
  const { actor, workspace, role } = await requireWorkspace();
  if (!workspace) return <Empty title="No workspace" body="Select a workspace." />;
  if (role === "VIEWER" || role === "AGENT") return <Empty title="Admins only" body="The team is managed by an admin." />;
  const members = (await getPrisma().membership.findMany({ where: { workspaceId: workspace.id }, include: { user: true } }))
    .sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9) || a.createdAt.getTime() - b.createdAt.getTime());
  return (
    <section className="max-w-4xl">
      <PageTitle title="Team" detail="Everyone who can open this console. Invitation links work once and expire after 72 hours." />
      {params.token ? (
        <div className="mb-5 rounded-2xl bg-[#f4ead2] p-4 text-sm text-[#6e5420]">
          <p className="font-semibold">Invitation created</p>
          <p className="mt-1">Send this one-time link to the new team member yourself. It is shown only once.</p>
          <p className="mt-2 select-all break-all rounded-lg bg-white/70 px-3 py-2 font-mono text-[12.5px] text-[var(--color-ink)]">/invite/{params.token}</p>
        </div>
      ) : null}
      {params.denied ? <Notice tone="stop">That member cannot be removed by you.</Notice> : null}

      <ul className="grid gap-3 sm:grid-cols-2">
        {members.map((member) => {
          const you = member.userId === actor.userId;
          const canRemove = !you && !(member.role === "ADMIN" && role !== "SUPER_ADMIN");
          const name = member.user.name?.trim() || member.user.email;
          return (
            <li key={member.id} className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-[var(--shadow-card)]">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#f4ead2] text-[13px] font-semibold text-[#6e5420]" aria-hidden>
                {initials(member.user.name ?? "", member.user.email)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-semibold">{name}</p>
                  <RoleChip role={member.role} />
                  {you ? <span className="text-[12px] text-[var(--color-muted)]">You</span> : null}
                </div>
                <p className="truncate text-sm text-[var(--color-muted)]">{member.user.email}</p>
                <p className="mt-1 text-[12px] text-[var(--color-muted)]">Joined {fullIST(member.createdAt)}</p>
              </div>
              {canRemove ? (
                <form action={removeMember}>
                  <input type="hidden" name="userId" value={member.userId} />
                  <button type="submit" className="px-3 py-1.5 text-[13px] text-[#9f1239] hover:border-[#fecdd3] hover:bg-[#fff1f2]">Remove</button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="mt-8 rounded-2xl bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold tracking-tight">
          <UserPlus size={18} aria-hidden className="text-[var(--color-accent)]" />
          Invite someone
        </h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">Agents work the Inbox and Leads. Viewers see Overview and Reports only. Admins can change settings.</p>
        <form action={inviteStaff} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-end">
          <label>
            Email
            <input name="email" type="email" required placeholder="name@company.com" autoComplete="off" />
          </label>
          <label>
            Role
            <select name="role" defaultValue="AGENT">
              <option value="AGENT">Agent</option>
              <option value="ADMIN">Admin</option>
              <option value="VIEWER">Viewer</option>
            </select>
          </label>
          <button className="border-transparent bg-[var(--color-accent)] px-4 py-[0.6rem] text-white hover:bg-[#745722]" type="submit">Create invitation</button>
        </form>
      </div>
    </section>
  );
}

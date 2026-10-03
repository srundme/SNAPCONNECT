import { logout } from "@/lib/actions";
import { productName } from "@/lib/auth";
import { requireWorkspace } from "@/lib/session";
import { ConsoleNav } from "@/components/console-nav";
import { WorkspaceSwitch } from "@/components/workspace-switch";

function roleLabel(role: string | null) {
  if (role === "SUPER_ADMIN") return "Platform owner";
  if (role === "ADMIN") return "Admin";
  if (role === "AGENT") return "Agent";
  if (role === "VIEWER") return "Viewer";
  return "No access";
}

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { actor, workspace, role, workspaces } = await requireWorkspace();
  const viewer = role === "VIEWER";
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="flex flex-col border-b border-[var(--color-line)] bg-white md:min-h-screen md:border-b-0 md:border-r">
        <div className="px-5 pb-3 pt-5">
          <p className="text-[15px] font-semibold tracking-tight">{productName}</p>
          <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">Staff console</p>
        </div>
        <WorkspaceSwitch current={workspace?.id} workspaces={workspaces} />
        <ConsoleNav showPlatform={actor.platformRole === "SUPER_ADMIN"} viewer={viewer} />
        <div className="mt-auto border-t border-[var(--color-line)] px-4 py-4">
          <p className="truncate text-sm font-medium">{actor.email}</p>
          <p className="text-[12px] text-[var(--color-muted)]">{roleLabel(role)}</p>
          <form action={logout} className="mt-3">
            <button type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">
        {workspace?.mode === "SIMULATION" ? (
          <p className="border-b border-[var(--color-line)] bg-white px-5 py-2.5 text-[13px] text-[var(--color-muted)] md:px-8">
            Simulation workspace. Instagram, Facebook, and Zoho stay labelled mocks. Nothing is sent outside this app.
          </p>
        ) : (
          <p className="border-b border-[#d5efe9] bg-[#f3fbf8] px-5 py-2.5 text-[13px] text-[var(--color-accent-ink)] md:px-8">
            Integration workspace. A channel is live only after its credential, subscription, and a real event each have a timestamp.
          </p>
        )}
        <div className="px-5 py-6 md:px-8 md:py-8">{children}</div>
      </div>
    </div>
  );
}

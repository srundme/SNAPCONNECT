import { LogOut } from "lucide-react";
import { logout } from "@/lib/actions";
import { requireWorkspace } from "@/lib/session";
import { ConsoleNav } from "@/components/console-nav";
import { BrandMark } from "@/components/ui";
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
    <div className="min-h-screen lg:grid lg:grid-cols-[252px_minmax(0,1fr)]">
      <aside className="flex flex-col bg-[var(--color-shell)] text-white lg:sticky lg:top-0 lg:z-20 lg:h-screen lg:self-start lg:overflow-y-auto">
        <div className="px-3 pb-3 pt-4">
          <BrandMark height={78} />
        </div>
        <WorkspaceSwitch current={workspace?.id} workspaces={workspaces} />
        <ConsoleNav showPlatform={actor.platformRole === "SUPER_ADMIN"} viewer={viewer} />
        <div className="mt-auto border-t border-white/10 px-4 py-4">
          <p className="truncate text-sm font-medium">{actor.email}</p>
          <p className="text-[12px] text-white/50">{roleLabel(role)}</p>
          <form action={logout} className="mt-3">
            <button type="submit" className="inline-flex items-center gap-1.5 border-white/10 bg-white/8 text-white hover:bg-white/14">
              <LogOut size={14} aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">
        {workspace?.mode === "SIMULATION" ? (
          <p className="bg-[#111318] px-5 py-2 text-[12px] font-medium text-white/70 lg:px-8">Practice workspace. Nothing here is sent to Instagram, Facebook, or Zoho.</p>
        ) : (
          <p className="bg-[#f4ead2] px-5 py-2 text-[12px] font-medium text-[#6e5420] lg:px-8">Live workspace. A channel sends messages only after it is connected and automation is on.</p>
        )}
        <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</div>
      </div>
    </div>
  );
}

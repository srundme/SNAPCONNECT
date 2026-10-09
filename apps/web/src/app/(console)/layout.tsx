import { requireWorkspace } from "@/lib/session";
import { ConsoleShell } from "@/components/console-nav";
import { BrandMark, roleName } from "@/components/ui";
import { WorkspaceSwitch } from "@/components/workspace-switch";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { actor, workspace, role, workspaces } = await requireWorkspace();
  return (
    <ConsoleShell
      role={role}
      showPlatform={actor.platformRole === "SUPER_ADMIN"}
      userName={actor.name?.trim() || actor.email}
      roleText={roleName(role)}
      practice={workspace?.mode === "SIMULATION"}
      brand={<BrandMark height={72} />}
      workspaceSwitch={
        <WorkspaceSwitch
          current={workspace?.id}
          workspaces={workspaces.map((item) => ({ id: item.id, name: item.name, mode: item.mode, brandName: item.brandName }))}
        />
      }
    >
      {children}
    </ConsoleShell>
  );
}

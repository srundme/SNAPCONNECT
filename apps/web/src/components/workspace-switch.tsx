"use client";

import { switchWorkspace } from "@/lib/actions";

export function WorkspaceSwitch({
  current,
  workspaces,
}: {
  current?: string;
  workspaces: Array<{ id: string; name: string; mode: string }>;
}) {
  return (
    <form action={switchWorkspace} className="px-3 pb-3">
      <label>
        Workspace
        <select
          name="workspaceId"
          defaultValue={current}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          {workspaces.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.mode === "SIMULATION" ? "Simulation" : "Live setup"}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}

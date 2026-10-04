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
    <form action={switchWorkspace} className="px-3 pb-4">
      <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/40">
        Workspace
        <select
          name="workspaceId"
          defaultValue={current}
          className="mt-1 border-white/10 bg-white/8 font-medium text-white"
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          {workspaces.map((item) => (
            <option key={item.id} value={item.id} className="text-[var(--color-ink)]">
              {item.name} · {item.mode === "SIMULATION" ? "Practice" : "Live"}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}

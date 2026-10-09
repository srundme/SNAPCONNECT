"use client";

import { ChevronsUpDown } from "lucide-react";
import { switchWorkspace } from "@/lib/actions";

type WorkspaceOption = { id: string; name: string; mode: string; brandName?: string | null };

/** The name the team knows the workspace by: its brand ("The KariGhars") when one is set. */
export function workspaceLabel(item: WorkspaceOption) {
  const brand = item.brandName?.trim();
  return brand && brand !== "Demo Interiors" ? brand : item.name;
}

export function WorkspaceSwitch({
  current,
  workspaces,
}: {
  current?: string;
  workspaces: WorkspaceOption[];
}) {
  if (workspaces.length <= 1) return null;
  return (
    <form action={switchWorkspace} className="px-3 pb-4">
      <label className="grid gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/35">
        Workspace
        <span className="relative block">
          <select
            name="workspaceId"
            defaultValue={current}
            className="w-full appearance-none border-white/10 bg-white/8 pr-9 text-[14px] font-medium normal-case tracking-normal text-white hover:border-white/20"
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            {workspaces.map((item) => (
              <option key={item.id} value={item.id} className="text-[var(--color-ink)]">
                {workspaceLabel(item)} · {item.mode === "SIMULATION" ? "Practice" : "Live"}
              </option>
            ))}
          </select>
          <ChevronsUpDown size={15} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/50" />
        </span>
      </label>
    </form>
  );
}

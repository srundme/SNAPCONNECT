import type { ReactNode } from "react";
import Link from "next/link";
import { clsx } from "clsx";

export type Kpi = { label: string; value: ReactNode; note?: string; href?: string; emphasis?: boolean };

/** Headline numbers: two across on a phone, up to six across on a wide screen. */
export function KpiTiles({ items, className }: { items: Kpi[]; className?: string }) {
  const wide = items.length >= 6 ? "xl:grid-cols-6" : items.length === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4";
  return (
    <div className={clsx("grid grid-cols-2 gap-3 md:grid-cols-3", wide, className)}>
      {items.map((item) => {
        const body = (
          <>
            <p className="text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-[var(--color-muted)]">{item.label}</p>
            <p className={clsx("mt-3 text-[30px] font-semibold leading-none tracking-tight tabular-nums", item.emphasis ? "text-[var(--color-accent-ink)]" : "text-[var(--color-ink)]")}>{item.value}</p>
            {item.note ? <p className="mt-2 text-[12px] leading-4 text-[var(--color-muted)]">{item.note}</p> : null}
          </>
        );
        const tile = clsx(
          "flex min-w-0 flex-col rounded-2xl bg-white px-4 py-4 shadow-[0_1px_0_rgba(20,23,28,0.06)]",
          item.emphasis && "ring-1 ring-[var(--color-accent)]/35",
        );
        return item.href ? (
          <Link key={item.label} href={item.href} className={clsx(tile, "transition-colors hover:bg-[#fbf8f2]")}>{body}</Link>
        ) : (
          <div key={item.label} className={tile}>{body}</div>
        );
      })}
    </div>
  );
}

/** Section heading inside a panel: display serif title with a quiet one-line explanation. */
export function PanelHeading({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="font-[family-name:var(--font-display)] text-[22px] font-medium leading-tight tracking-tight">{title}</h2>
        {detail ? <p className="mt-1 text-pretty text-[13px] text-[var(--color-muted)]">{detail}</p> : null}
      </div>
      {action}
    </div>
  );
}

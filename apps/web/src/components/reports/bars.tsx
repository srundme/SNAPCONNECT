import type { ReactNode } from "react";
import { percentOf } from "./ist";

export type BarItem = { label: string; value: number; note?: string; muted?: boolean };

/**
 * A ranked list of horizontal bars. Each share is of `total`, so it never passes 100%,
 * and bars are drawn to the same scale.
 */
export function BarList({ items, total, empty }: { items: BarItem[]; total: number; empty: string }) {
  if (!items.length || !total) return <p className="mt-4 text-sm text-[var(--color-muted)]">{empty}</p>;
  return (
    <ul className="mt-4 space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className={item.muted ? "min-w-0 text-[var(--color-muted)]" : "min-w-0"}>{item.label}</span>
            <span className="shrink-0 tabular-nums font-semibold">
              {item.value.toLocaleString("en-IN")}
              <span className="ml-2 inline-block w-10 text-right text-[12px] font-normal text-[var(--color-muted)]">{percentOf(item.value, total)}</span>
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-[var(--color-paper)]">
            <div
              className="h-2 rounded-full"
              style={{ width: `${Math.min(1, item.value / total) * 100}%`, minWidth: item.value ? 4 : 0, background: item.muted ? "#d8cfc0" : "var(--color-accent)" }}
            />
          </div>
          {item.note ? <p className="mt-1 text-[12px] text-[var(--color-muted)]">{item.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export type Segment = { label: string; value: number; color: string };

/** One bar split into parts of a whole, with a legend that wraps on a phone. */
export function StackedBar({ segments, label }: { segments: Segment[]; label: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <div className="mt-4">
      <div className="flex h-3 overflow-hidden rounded-full bg-[var(--color-paper)]" role="img" aria-label={label}>
        {total
          ? segments.map((segment) => segment.value ? (
            <div key={segment.label} title={`${segment.label}: ${segment.value}`} style={{ width: `${(segment.value / total) * 100}%`, background: segment.color }} />
          ) : null)
          : null}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {segments.map((segment) => (
          <li key={segment.label} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: segment.color }} />
            <span>{segment.label}</span>
            <b className="font-semibold tabular-nums">{segment.value.toLocaleString("en-IN")}</b>
            <span className="text-[12px] tabular-nums text-[var(--color-muted)]">{percentOf(segment.value, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A labelled figure inside a panel. */
export function Figure({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-[var(--color-muted)]">{label}</dt>
      <dd className="mt-1 text-[22px] font-semibold leading-tight tabular-nums">{value}</dd>
      {note ? <p className="mt-1 text-[12px] leading-4 text-[var(--color-muted)]">{note}</p> : null}
    </div>
  );
}

/** Small heading between blocks inside one panel. */
export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">{children}</h3>;
}

export const RATING_COLORS = { hot: "#c2532d", unrated: "#d8cfc0", junk: "#8a8178" } as const;

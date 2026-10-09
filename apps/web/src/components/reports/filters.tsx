import Link from "next/link";
import { clsx } from "clsx";

export type FilterOption = { key: string; label: string; href: string; active: boolean };

/** A segmented row of links; scrolls sideways on a narrow phone instead of wrapping awkwardly. */
export function FilterGroup({ label, options }: { label: string; options: FilterOption[] }) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto px-1">
      <div className="inline-flex gap-0.5 rounded-full bg-white p-1 shadow-[0_1px_0_rgba(20,23,28,0.06)]">
        {options.map((option) => (
          <Link
            key={option.key}
            href={option.href}
            aria-current={option.active ? "page" : undefined}
            className={clsx(
              "whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
              option.active ? "bg-[var(--color-ink)] text-white" : "text-[var(--color-muted)] hover:bg-[var(--color-paper)] hover:text-[var(--color-ink)]",
            )}
          >
            {option.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

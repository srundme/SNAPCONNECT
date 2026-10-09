import { clsx } from "clsx";
import { ChannelMark } from "@/components/ui";

export type LeadRow = {
  id: string;
  name: string;
  channel: "INSTAGRAM" | "FACEBOOK" | "WHATSAPP";
  home: string;
  area: string;
  rating: string | null;
  when: string;
};

export function RatingChip({ rating }: { rating: string | null }) {
  if (rating !== "HOT" && rating !== "JUNK") return <span className="text-[var(--color-muted)]">–</span>;
  return (
    <span className={clsx(
      "inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em]",
      rating === "HOT" ? "bg-[#fde8e1] text-[#a2381b]" : "bg-[var(--color-paper)] text-[var(--color-muted)]",
    )}>
      {rating === "HOT" ? "Hot" : "Junk"}
    </span>
  );
}

/** A table on tablets and up; a stack of cards on a phone. */
export function LeadsTable({ rows }: { rows: LeadRow[] }) {
  return (
    <>
      <ul className="mt-4 divide-y divide-[var(--color-line)] sm:hidden">
        {rows.map((row) => (
          <li key={row.id} className="py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{row.name}</span>
              <span className="shrink-0 text-[12px] text-[var(--color-muted)]">{row.when}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px]">
              <ChannelMark channel={row.channel} />
              <RatingChip rating={row.rating} />
            </div>
            <p className="mt-1.5 text-[13px] text-[var(--color-muted)]">
              <span className="text-[var(--color-ink)]">{row.home}</span> · {row.area}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-3 hidden sm:block">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[20%]" />
            <col className="w-[14%]" />
            <col className="w-[18%]" />
            <col />
            <col className="w-[9%]" />
            <col className="w-[15%]" />
          </colgroup>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-[var(--color-muted)]">
              <th className="py-2 pr-3 font-semibold">Name</th>
              <th className="pr-3 font-semibold">Channel</th>
              <th className="pr-3 font-semibold">Home</th>
              <th className="pr-3 font-semibold">Project / area</th>
              <th className="pr-3 font-semibold">Rating</th>
              <th className="text-right font-semibold">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[var(--color-line)] align-top">
                <td className="truncate py-2.5 pr-3 font-medium" title={row.name}>{row.name}</td>
                <td className="py-2.5 pr-3"><ChannelMark channel={row.channel} /></td>
                <td className="py-2.5 pr-3"><span className="line-clamp-2" title={row.home}>{row.home}</span></td>
                <td className="py-2.5 pr-3"><span className="line-clamp-2" title={row.area}>{row.area}</span></td>
                <td className="py-2.5 pr-3"><RatingChip rating={row.rating} /></td>
                <td className="py-2.5 text-right tabular-nums text-[var(--color-muted)]">{row.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

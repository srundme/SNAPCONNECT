import { clsx } from "clsx";
import { Flame } from "lucide-react";
import { STATUS_LABEL, type LeadStatus, type Rating } from "./lead-data";

export function RatingChip({ rating, reason }: { rating: Rating; reason?: string | null }) {
  const label = rating === "HOT" ? "Hot" : rating === "JUNK" ? "Junk" : "Unrated";
  return (
    <span
      title={reason ?? undefined}
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em]",
        rating === "HOT" && "bg-[var(--color-accent)] text-white",
        rating === "JUNK" && "bg-[#efebe4] text-[var(--color-muted)]",
        rating === "UNRATED" && "border border-[var(--color-line)] text-[var(--color-muted)]",
      )}
    >
      {rating === "HOT" ? <Flame size={11} strokeWidth={2.2} aria-hidden /> : null}
      {label}
    </span>
  );
}

const STATUS_STYLE: Record<LeadStatus, { dot: string; text: string }> = {
  COLLECTING: { dot: "bg-[#c9a961]", text: "text-[var(--color-ink)]" },
  QUALIFIED: { dot: "bg-[var(--color-accent)]", text: "text-[var(--color-accent-ink)]" },
  IN_ZOHO: { dot: "bg-[var(--color-wa)]", text: "text-[var(--color-wa)]" },
  NOT_INTERESTED: { dot: "bg-[#b9b0a3]", text: "text-[var(--color-muted)]" },
};

export function StatusChip({ status }: { status: LeadStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium", style.text)}>
      <span className={clsx("size-1.5 rounded-full", style.dot)} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

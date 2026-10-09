import { clsx } from "clsx";
import { Bot, Hand, CirclePause, UserRound } from "lucide-react";
import { whenIST } from "@/lib/format";
import type { Ownership } from "./labels";

export function RatingChip({ rating }: { rating: string | null | undefined }) {
  if (rating !== "HOT" && rating !== "JUNK") return null;
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em]",
        rating === "HOT" ? "bg-[var(--color-accent)] text-white" : "bg-[#ece9e4] text-[var(--color-muted)]",
      )}
    >
      {rating === "HOT" ? "Hot" : "Junk"}
    </span>
  );
}

/** Compact owner badge for list rows. */
export function OwnerBadge({ owner }: { owner: Ownership }) {
  if (owner.kind === "ai") {
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--color-accent-ink)]">
        <Bot size={12} aria-hidden /> Varun (AI)
      </span>
    );
  }
  if (owner.kind === "paused") {
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--color-muted)]">
        <CirclePause size={12} aria-hidden /> Paused
      </span>
    );
  }
  if (owner.kind === "handed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#fff3df] px-2 py-0.5 text-[11.5px] font-semibold text-[#8a4b0f]">
        <Hand size={12} aria-hidden /> Needs team
      </span>
    );
  }
  return (
    <span className={clsx("inline-flex min-w-0 items-center gap-1 text-[11.5px] font-semibold", owner.mine ? "text-[var(--color-ink)]" : "text-[#3d362e]")}>
      <UserRound size={12} aria-hidden className="shrink-0" />
      <span className="truncate">{owner.mine ? "You" : owner.name}</span>
    </span>
  );
}

/** Full sentence for the chat header. */
export function OwnerLine({ owner }: { owner: Ownership }) {
  if (owner.kind === "ai") return <>Varun (AI) is replying</>;
  if (owner.kind === "paused") return <>Paused. Nobody is replying automatically.</>;
  if (owner.kind === "handed") {
    return <>Handed to team by Varun{owner.reason ? ` · ${owner.reason}` : ""}</>;
  }
  return <>Taken over by {owner.mine ? "you" : owner.name}{owner.at ? ` · ${whenIST(owner.at)}` : ""}</>;
}

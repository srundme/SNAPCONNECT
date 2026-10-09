import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ChannelMark, StatusLabel } from "@/components/ui";

export type AttentionItem = {
  id: string;
  name: string;
  channel: "INSTAGRAM" | "FACEBOOK" | "WHATSAPP";
  lastMessage: string;
  lastFrom: string;
  ago: string;
  owner: string;
  waiting: boolean;
};

/** Chats the team owns, newest first. Each row opens the chat in the inbox. */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  return (
    <ul className="divide-y divide-[var(--color-line)]">
      {items.map((item) => (
        <li key={item.id}>
          <Link href={`/inbox?id=${encodeURIComponent(item.id)}`} className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[#fbf8f2] sm:px-5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${item.waiting ? "bg-[var(--color-accent)]" : "bg-[var(--color-line)]"}`} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate font-medium">{item.name}</span>
                <ChannelMark channel={item.channel} />
                {item.waiting ? <StatusLabel tone="wait">Waiting for reply</StatusLabel> : null}
              </span>
              <span className="mt-1 block truncate text-[13px] text-[var(--color-muted)]">
                <span className="text-[var(--color-ink)]">{item.lastFrom}:</span> {item.lastMessage}
              </span>
              <span className="mt-1 block text-[12px] text-[var(--color-muted)]">{item.owner} · {item.ago}</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-[var(--color-muted)] transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

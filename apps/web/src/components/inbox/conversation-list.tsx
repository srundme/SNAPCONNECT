import Link from "next/link";
import { clsx } from "clsx";
import { Search } from "lucide-react";
import { ChannelGlyph, ChannelMark } from "@/components/ui";
import { whenIST } from "@/lib/format";
import { OwnerBadge, RatingChip } from "./chips";
import { inboxHref, type InboxState } from "./params";
import { channelName, type Channel, type InboxView, type Ownership } from "./labels";

export type ListRow = {
  id: string;
  name: string;
  channel: Channel;
  preview: string;
  previewAuthor: string | null;
  at: Date;
  rating: string | null;
  owner: Ownership;
  /** Other channels this same person has written on. */
  alsoOn: Channel[];
  /** An open "possibly the same person" suggestion waits for the team. */
  possibleMatch: boolean;
  /** A safety check flagged this chat: info fishing, a message flood or broadcast spam. */
  flagged: boolean;
};

const GLYPH_TONE: Record<Channel, string> = {
  INSTAGRAM: "text-[var(--color-ig)]",
  WHATSAPP: "text-[var(--color-wa)]",
  FACEBOOK: "text-[var(--color-fb)]",
};

const VIEWS: Array<[InboxView, string]> = [
  ["all", "All"],
  ["needs", "Needs team"],
  ["mine", "Mine"],
  ["varun", "Varun"],
];

const CHANNELS: Array<[Channel | undefined, string]> = [
  [undefined, "Every channel"],
  ["WHATSAPP", "WhatsApp"],
  ["INSTAGRAM", "Instagram"],
  ["FACEBOOK", "Facebook"],
];

export function ConversationList({ rows, state, selectedId, hiddenTests }: { rows: ListRow[]; state: InboxState; selectedId?: string; hiddenTests: number }) {
  const filtered = state.view !== "all" || state.channel || state.q;
  return (
    <div className="flex min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-[var(--color-line)] p-3">
        <nav aria-label="Who has the chat" className="flex gap-1 rounded-xl bg-[var(--color-paper)] p-1">
          {VIEWS.map(([view, label]) => (
            <Link
              key={view}
              href={inboxHref(state, { view, id: undefined })}
              aria-current={state.view === view ? "page" : undefined}
              className={clsx(
                "flex-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-center text-[12.5px] font-semibold transition-colors",
                state.view === view ? "bg-white text-[var(--color-ink)] shadow-[0_1px_2px_rgba(26,22,18,0.08)]" : "text-[var(--color-muted)] hover:text-[var(--color-ink)]",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <form action="/inbox" method="get" role="search" className="relative">
          {state.view !== "all" ? <input type="hidden" name="view" value={state.view} /> : null}
          {state.channel ? <input type="hidden" name="channel" value={state.channel} /> : null}
          {state.tests ? <input type="hidden" name="tests" value="1" /> : null}
          <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <label className="sr-only" htmlFor="inbox-search">Search chats</label>
          <input
            id="inbox-search"
            type="search"
            name="q"
            defaultValue={state.q ?? ""}
            placeholder="Name, @handle, phone or message"
            className="w-full pl-9 text-[13.5px]"
          />
        </form>
        <div className="flex flex-wrap gap-1.5">
          {CHANNELS.map(([channel, label]) => {
            const active = state.channel === channel;
            return (
              <Link
                key={label}
                href={inboxHref(state, { channel, id: undefined })}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-colors",
                  active ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-white" : "border-[var(--color-line)] text-[var(--color-muted)] hover:border-[#cfc5b5] hover:text-[var(--color-ink)]",
                )}
              >
                {label}
              </Link>
            );
          })}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="font-[family-name:var(--font-display)] text-[22px] leading-tight">
            {state.view === "mine" ? "No chats with you" : state.view === "needs" ? "Nothing waiting for the team" : "No chats found"}
          </p>
          <p className="mx-auto mt-2 max-w-[240px] text-[13px] leading-5 text-[var(--color-muted)]">
            {state.q
              ? `Nothing matches “${state.q}”. Try a shorter name or the last digits of the number.`
              : state.view === "mine"
                ? "Chats you take over from Varun appear here."
                : state.view === "needs"
                  ? "When Varun hands a customer to the team, or someone takes over, it shows up here."
                  : "New chats appear here as customers message."}
          </p>
          {filtered ? <Link href={inboxHref(state, { view: "all", channel: undefined, q: undefined, id: undefined })} className="mt-4 inline-block text-[13px] font-semibold text-[var(--color-accent-ink)] underline-offset-4 hover:underline">Show all chats</Link> : null}
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {rows.map((row) => {
            const active = row.id === selectedId;
            return (
              <li key={row.id}>
                <Link
                  href={inboxHref(state, { id: row.id })}
                  aria-current={active ? "true" : undefined}
                  className={clsx(
                    "relative block border-b border-[var(--color-line)] px-4 py-3 transition-colors",
                    active ? "bg-[#faf5ea]" : "hover:bg-[#fbf9f6]",
                  )}
                >
                  {active ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--color-accent)]" /> : null}
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 truncate text-[14px] font-semibold">{row.name}</p>
                    <time className="shrink-0 text-[11.5px] tabular-nums text-[var(--color-muted)]" dateTime={row.at.toISOString()}>{whenIST(row.at)}</time>
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-[var(--color-muted)]">
                    {row.previewAuthor ? <span className="font-medium text-[#4a4239]">{row.previewAuthor}: </span> : null}
                    {row.preview}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="inline-flex shrink-0 items-center gap-1">
                      <ChannelMark channel={row.channel} />
                      {row.alsoOn.map((channel) => (
                        <span
                          key={channel}
                          title={`Also on ${channelName(channel)}`}
                          className={clsx("inline-flex size-[18px] items-center justify-center rounded-full bg-[var(--color-paper)]", GLYPH_TONE[channel])}
                        >
                          <ChannelGlyph channel={channel} size={10} />
                          <span className="sr-only">Also on {channelName(channel)}</span>
                        </span>
                      ))}
                    </span>
                    <RatingChip rating={row.rating} />
                    {row.possibleMatch ? (
                      <span title="Possibly the same person as another chat" className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[var(--color-accent-ink)]">
                        <span aria-hidden className="size-1.5 rounded-full bg-[var(--color-accent)]" />
                        <span className="hidden sm:inline">Possible match</span>
                        <span className="sr-only sm:hidden">Possible match</span>
                      </span>
                    ) : null}
                    {row.flagged ? (
                      <span title="Flagged by a safety check: info fishing, a message burst or likely spam" className="inline-flex shrink-0 items-center rounded-full border border-[var(--color-line)] bg-[var(--color-paper)] px-1.5 py-px text-[10.5px] font-semibold text-[var(--color-muted)]">
                        Flagged
                      </span>
                    ) : null}
                    <span className="ml-auto min-w-0"><OwnerBadge owner={row.owner} /></span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <div className="shrink-0 border-t border-[var(--color-line)] px-4 py-2 text-[12px] text-[var(--color-muted)]">
        {state.tests ? (
          <Link href={inboxHref(state, { tests: false, id: undefined })} className="hover:text-[var(--color-ink)]">Hide test chats</Link>
        ) : (
          <Link href={inboxHref(state, { tests: true })} className="hover:text-[var(--color-ink)]">
            Show test chats{hiddenTests > 0 ? ` (${hiddenTests})` : ""}
          </Link>
        )}
      </div>
    </div>
  );
}

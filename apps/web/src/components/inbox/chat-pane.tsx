import Link from "next/link";
import { clsx } from "clsx";
import { Send, Undo2, UserRound } from "lucide-react";
import { ChannelMark } from "@/components/ui";
import { ChatThread } from "@/components/live-inbox";
import { claimConversation, releaseConversation, sendStaffReply } from "@/lib/actions";
import { whenIST } from "@/lib/format";
import { OwnerLine, RatingChip } from "./chips";
import { channelName, dayLabel, isNoisySystemNote, istDayKey, type Channel, type Ownership } from "./labels";
import { inboxHref, type InboxState } from "./params";

export type ChatMessage = {
  id: string;
  author: "PROSPECT" | "AI" | "STAFF" | "SYSTEM";
  body: string;
  createdAt: Date;
  voice: boolean;
  voiceClipId: string | null;
  staffName: string | null;
};

export function ChatPane({
  conversationId,
  channel,
  name,
  handle,
  rating,
  owner,
  alsoOn = [],
  messages,
  state,
  canReply,
  replyAllowed,
  replyReason,
}: {
  conversationId: string;
  channel: Channel;
  name: string;
  handle: string | null;
  rating: string | null;
  owner: Ownership;
  /** Other channels this same person writes on. */
  alsoOn?: Channel[];
  messages: ChatMessage[];
  state: InboxState;
  canReply: boolean;
  replyAllowed: boolean;
  replyReason: string | null;
}) {
  const noisy = messages.filter((message) => message.author === "SYSTEM" && isNoisySystemNote(message.body)).length;
  const shown = state.system ? messages : messages.filter((message) => !(message.author === "SYSTEM" && isNoisySystemNote(message.body)));
  const now = new Date();
  const ownerTone = owner.kind === "handed" ? "bg-[#fff3df] text-[#8a4b0f]" : owner.kind === "staff" ? "bg-[#f1ede6] text-[var(--color-ink)]" : owner.kind === "ai" ? "bg-[#f4ead2] text-[var(--color-accent-ink)]" : "bg-[#f1f1f1] text-[var(--color-muted)]";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-[var(--color-line)] px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-[family-name:var(--font-display)] text-[24px] font-medium leading-tight">{name}</h2>
              <RatingChip rating={rating} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--color-muted)]">
              <ChannelMark channel={channel} />
              {handle ? <span>{handle}</span> : null}
            </div>
            {alsoOn.length > 0 ? (
              <p className="mt-1 text-[12px] text-[var(--color-muted)]">
                Also on <span className="font-medium text-[#4a4239]">{alsoOn.map(channelName).join(" · ")}</span>
              </p>
            ) : null}
          </div>
          {canReply ? (
            <div className="flex shrink-0 flex-wrap gap-2">
              {owner.kind === "staff" && owner.mine ? null : (
                <form action={claimConversation}>
                  <input type="hidden" name="conversationId" value={conversationId} />
                  <button
                    type="submit"
                    title={owner.kind === "staff" ? `${owner.name} has this chat. Taking over makes it yours.` : "Varun stops replying while you have this chat."}
                    className="inline-flex items-center gap-1.5 border-transparent bg-[var(--color-ink)] text-white hover:bg-black"
                  >
                    <UserRound size={14} aria-hidden />
                    {owner.kind === "staff" ? `Take over from ${owner.name}` : "Take over"}
                  </button>
                </form>
              )}
              {owner.kind === "staff" || owner.kind === "handed" ? (
                <form action={releaseConversation}>
                  <input type="hidden" name="conversationId" value={conversationId} />
                  <button type="submit" className="inline-flex items-center gap-1.5" title="Varun answers the next customer message again.">
                    <Undo2 size={14} aria-hidden />
                    Hand back to Varun
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}
        </div>
        <p className={clsx("mt-3 inline-flex max-w-full rounded-lg px-2.5 py-1 text-[12.5px] font-medium", ownerTone)}>
          <span className="truncate"><OwnerLine owner={owner} /></span>
        </p>
      </header>

      <ChatThread key={conversationId} count={shown.length} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#fcfbf9] px-4 py-4 sm:px-6">
        {shown.length === 0 ? (
          <li className="py-16 text-center text-[13px] text-[var(--color-muted)]">No messages yet. The chat starts when the customer writes in.</li>
        ) : null}
        {shown.map((message, index) => {
          const previous = shown[index - 1];
          const newDay = !previous || istDayKey(previous.createdAt) !== istDayKey(message.createdAt);
          const separator = newDay ? (
            <div className="flex items-center gap-3 py-2" role="separator" aria-label={dayLabel(message.createdAt, now)}>
              <span className="h-px flex-1 bg-[var(--color-line)]" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">{dayLabel(message.createdAt, now)}</span>
              <span className="h-px flex-1 bg-[var(--color-line)]" />
            </div>
          ) : null;
          if (message.author === "SYSTEM") {
            return (
              <li key={message.id}>
                {separator}
                <p className="mx-auto max-w-[85%] text-center text-[11.5px] leading-4 text-[#8f877c]">
                  {message.body} <span className="whitespace-nowrap tabular-nums">· {whenIST(message.createdAt, now)}</span>
                </p>
              </li>
            );
          }
          const inbound = message.author === "PROSPECT";
          const label = inbound ? name : message.author === "AI" ? "Varun" : message.staffName ?? "Team";
          return (
            <li key={message.id}>
              {separator}
              <div className={clsx("flex flex-col", inbound ? "items-start" : "items-end")}>
                <p className={clsx("mb-1 flex items-center gap-1.5 px-1 text-[11.5px]", inbound ? "text-[var(--color-muted)]" : "text-[var(--color-accent-ink)]")}>
                  <span className="font-semibold">{label}</span>
                  {message.author === "AI" ? <span className="text-[var(--color-muted)]">AI</span> : null}
                  {message.voice ? <span className="text-[var(--color-muted)]">· Voice note</span> : null}
                  <span className="tabular-nums text-[var(--color-muted)]">· {whenIST(message.createdAt, now)}</span>
                </p>
                <p
                  className={clsx(
                    "max-w-[85%] whitespace-pre-line break-words rounded-2xl px-3.5 py-2 text-[14px] leading-[1.45] sm:max-w-[75%]",
                    inbound
                      ? "rounded-tl-md border border-[var(--color-line)] bg-white"
                      : message.author === "STAFF"
                        ? "rounded-tr-md bg-[var(--color-ink)] text-white"
                        : "rounded-tr-md bg-[#f4ead2] text-[#2b241b]",
                  )}
                >
                  {message.body}
                </p>
                {message.voiceClipId ? (
                  <audio controls preload="none" className="mt-1.5 h-8 w-56 max-w-full" src={`/api/voice/${message.voiceClipId}`} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ChatThread>

      {noisy > 0 || state.system ? (
        <div className="shrink-0 border-t border-[var(--color-line)] bg-[#fcfbf9] px-4 py-1.5 text-right text-[11.5px] sm:px-6">
          <Link href={inboxHref(state, { system: !state.system })} className="text-[var(--color-muted)] hover:text-[var(--color-ink)]">
            {state.system ? "Hide system notes" : `Show system notes (${noisy})`}
          </Link>
        </div>
      ) : null}

      {canReply ? (
        <form action={sendStaffReply} className="shrink-0 border-t border-[var(--color-line)] bg-white p-3 sm:px-4">
          <input type="hidden" name="conversationId" value={conversationId} />
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Reply</span>
              <textarea
                name="body"
                disabled={!replyAllowed}
                rows={2}
                maxLength={1000}
                placeholder={replyAllowed ? `Write to ${name}` : "Reply is unavailable"}
                className="text-[14px]"
              />
            </label>
            <button className="inline-flex shrink-0 items-center gap-1.5 border-transparent bg-[var(--color-accent)] text-white hover:bg-[#745722]" type="submit" disabled={!replyAllowed}>
              <Send size={15} aria-hidden />
              Send
            </button>
          </div>
          <p className="mt-2 text-[12px] leading-4 text-[var(--color-muted)]">
            {replyAllowed
              ? owner.kind === "staff" && owner.mine
                ? `Sends on the same ${channelName(channel)} chat.`
                : owner.kind === "staff"
                  ? `Sends on the same ${channelName(channel)} chat. ${owner.name} still owns it unless you take over.`
                  : `Sends on the same ${channelName(channel)} chat and takes it over from Varun.`
              : replyReason}
          </p>
        </form>
      ) : null}
    </div>
  );
}

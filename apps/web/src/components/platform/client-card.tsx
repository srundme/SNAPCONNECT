import { clsx } from "clsx";
import { ArrowRight, Check } from "lucide-react";
import { ChannelGlyph } from "@/components/ui";
import { switchWorkspace } from "@/lib/actions";

type ChannelName = "INSTAGRAM" | "FACEBOOK" | "WHATSAPP";

export type ClientChannel = { id: string; channel: ChannelName; account: string; state: "on" | "paused" | "disconnected" };

export type ClientCardData = {
  id: string;
  name: string;
  live: boolean;
  suspended: boolean;
  assistant: string;
  replying: boolean;
  channels: ClientChannel[];
  zoho: boolean;
  conversations: number;
  zohoLeads: number;
  hotLeads: number;
  lastActivity: string;
  lastActivityFull: string;
  current: boolean;
};

const CHANNEL_TINT: Record<ChannelName, string> = {
  INSTAGRAM: "bg-[#fdf2f6] text-[var(--color-ig)]",
  FACEBOOK: "bg-[#eff4ff] text-[var(--color-fb)]",
  WHATSAPP: "bg-[#ecfdf3] text-[var(--color-wa)]",
};

const CHANNEL_WORD: Record<ChannelName, string> = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", WHATSAPP: "WhatsApp" };

function ChannelChip({ item }: { item: ClientChannel }) {
  const muted = item.state !== "on";
  const note = item.state === "paused" ? "auto-replies paused" : item.state === "disconnected" ? "disconnected" : "auto-replies on";
  return (
    <span
      title={`${CHANNEL_WORD[item.channel]} · ${item.account} · ${note}`}
      className={clsx(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold",
        muted ? "bg-[#f1eee9] text-[var(--color-muted)]" : CHANNEL_TINT[item.channel],
      )}
    >
      <ChannelGlyph channel={item.channel} />
      <span className={clsx("truncate", item.state === "disconnected" && "line-through decoration-1")}>{item.account}</span>
      {item.state === "paused" ? <span className="shrink-0 font-medium">· paused</span> : null}
    </span>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-[var(--color-muted)]">{label}</dt>
      <dd className={clsx("mt-1.5 text-[24px] font-semibold leading-none tracking-tight tabular-nums", accent && value !== 0 ? "text-[var(--color-accent-ink)]" : "text-[var(--color-ink)]")}>{value}</dd>
    </div>
  );
}

/** One client workspace: who answers, where, whether it is working, and what it did this week. */
export function ClientCard({ client }: { client: ClientCardData }) {
  return (
    <article
      className={clsx(
        "flex min-w-0 flex-col rounded-2xl bg-white shadow-[var(--shadow-card)]",
        client.current && "ring-2 ring-[var(--color-accent)]",
      )}
    >
      <div className="px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-[family-name:var(--font-display)] text-[26px] font-medium leading-tight tracking-tight">{client.name}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[var(--color-muted)]">
              <span>Assistant: <span className="font-semibold text-[var(--color-ink)]">{client.assistant}</span></span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1.5">
                <span className={clsx("h-2 w-2 rounded-full", client.replying ? "bg-[var(--color-wa)]" : "bg-[#d97706]")} aria-hidden />
                <span className="font-medium text-[var(--color-ink)]">{client.replying ? "Replying" : "Paused"}</span>
              </span>
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={clsx(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold leading-5",
                client.live ? "bg-[var(--color-accent)] text-white" : "bg-[#eef1f4] text-[#334155]",
              )}
            >
              {client.live ? "Live" : "Practice"}
            </span>
            {client.suspended ? <span className="rounded-full bg-[#fde8ec] px-2.5 py-0.5 text-[12px] font-semibold leading-5 text-[#9f1239]">Suspended</span> : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {client.channels.length ? client.channels.map((item) => <ChannelChip key={item.id} item={item} />) : (
            <span className="text-[13px] text-[var(--color-muted)]">No channels connected yet</span>
          )}
          {client.zoho ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#f4ead2] px-2.5 py-1 text-[12px] font-semibold text-[#6e5420]">
              <Check size={12} strokeWidth={2.5} aria-hidden />
              Zoho connected
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-[#f1eee9] px-2.5 py-1 text-[12px] font-semibold text-[var(--color-muted)]">Zoho not connected</span>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--color-line)] px-5 py-4">
        <p className="mb-3 text-[12px] font-medium text-[var(--color-muted)]">Last 7 days</p>
        <dl className="grid grid-cols-3 gap-3">
          <Stat label="Conversations" value={client.conversations} />
          <Stat label="Leads in Zoho" value={client.zohoLeads} />
          <Stat label="Hot leads" value={client.hotLeads} accent />
        </dl>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] bg-[#fbf9f5] px-5 py-3">
        <p className="min-w-0 text-[13px] text-[var(--color-muted)]">
          Last message <span className="font-medium text-[var(--color-ink)]" title={client.lastActivityFull}>{client.lastActivity}</span>
        </p>
        {client.current ? (
          <span className="inline-flex items-center gap-1.5 rounded-[10px] px-1 py-2 text-[14px] font-semibold text-[var(--color-accent-ink)]">
            <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" aria-hidden />
            You&apos;re here
          </span>
        ) : (
          <form action={switchWorkspace}>
            <input type="hidden" name="workspaceId" value={client.id} />
            <button type="submit" className="inline-flex items-center gap-1.5 text-white">
              Open
              <ArrowRight size={15} aria-hidden />
            </button>
          </form>
        )}
      </div>
    </article>
  );
}

import { clsx } from "clsx";
import { ChannelMark } from "@/components/ui";

export type ChannelState = {
  channel: "INSTAGRAM" | "FACEBOOK" | "WHATSAPP";
  connected: boolean;
  repliesOn: boolean;
  practice: boolean;
  account: string | null;
};

function line(state: ChannelState): { text: string; dot: string } {
  if (!state.connected) return { text: "Not connected", dot: "bg-[var(--color-line)]" };
  if (!state.repliesOn) return { text: "Connected · auto-replies paused", dot: "bg-[#d97706]" };
  return { text: "Connected · auto-replies on", dot: "bg-[var(--color-wa)]" };
}

/** One card per channel, in plain words: is it connected, and is the assistant answering. */
export function ChannelStrip({ states, className }: { states: ChannelState[]; className?: string }) {
  return (
    <div className={clsx("grid gap-3", className ?? "sm:grid-cols-3")}>
      {states.map((state) => {
        const status = line(state);
        return (
          <div key={state.channel} className="rounded-2xl bg-white px-4 py-3.5 shadow-[0_1px_0_rgba(20,23,28,0.06)]">
            <div className="flex items-center justify-between gap-2">
              <ChannelMark channel={state.channel} />
              {state.practice ? <span className="text-[11px] font-medium text-[var(--color-muted)]">Practice account</span> : null}
            </div>
            <p className="mt-2 flex items-center gap-2 text-sm font-medium">
              <span className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} aria-hidden />
              {status.text}
            </p>
            {state.account ? <p className="mt-0.5 truncate pl-4 text-[12px] text-[var(--color-muted)]">{state.account}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

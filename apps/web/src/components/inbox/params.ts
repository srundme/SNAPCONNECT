import type { Channel, InboxView } from "./labels";

export type InboxState = {
  id?: string;
  view: InboxView;
  channel?: Channel;
  q?: string;
  tests: boolean;
  system: boolean;
};

export function readInboxState(params: Record<string, string | string[] | undefined>): InboxState {
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const view = one("view");
  const channel = one("channel");
  const q = one("q")?.trim().slice(0, 80);
  return {
    id: one("id") || undefined,
    view: view === "needs" || view === "mine" || view === "varun" ? view : "all",
    channel: channel === "INSTAGRAM" || channel === "FACEBOOK" || channel === "WHATSAPP" ? channel : undefined,
    q: q || undefined,
    tests: one("tests") === "1",
    system: one("system") === "1",
  };
}

/** Builds an /inbox link that keeps the current filters, with the given changes. */
export function inboxHref(state: InboxState, change: Partial<InboxState> = {}): string {
  const next = { ...state, ...change };
  const search = new URLSearchParams();
  if (next.view !== "all") search.set("view", next.view);
  if (next.channel) search.set("channel", next.channel);
  if (next.q) search.set("q", next.q);
  if (next.tests) search.set("tests", "1");
  if (next.system) search.set("system", "1");
  if (next.id) search.set("id", next.id);
  const text = search.toString();
  return text ? `/inbox?${text}` : "/inbox";
}

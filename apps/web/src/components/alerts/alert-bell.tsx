"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Bell, BellOff, MessageSquare, Volume2, X } from "lucide-react";
import { clsx } from "clsx";
import { markAlertsRead } from "@/lib/actions";
import { agoIST } from "@/lib/format";

export type TeamAlertItem = {
  id: string;
  kind: string;
  text: string;
  conversationId: string;
  createdAt: string;
};

type Toast = TeamAlertItem & { shownAt: number };

type AlertsState = {
  enabled: boolean;
  alerts: TeamAlertItem[];
  unread: number;
  muted: boolean;
  toggleMute: () => void;
  markAllRead: () => void;
  marking: boolean;
};

const POLL_MS = 10_000;
const TOAST_MS = 12_000;
const MUTE_KEY = "sc-alerts-muted";

const AlertsContext = createContext<AlertsState>({
  enabled: false,
  alerts: [],
  unread: 0,
  muted: false,
  toggleMute: () => {},
  markAllRead: () => {},
  marking: false,
});

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(value: boolean) {
  try {
    if (value) window.localStorage.setItem(MUTE_KEY, "1");
    else window.localStorage.removeItem(MUTE_KEY);
  } catch {
    // Storage blocked: the choice lasts for this tab only.
  }
}

/** A soft two-note chime made with the Web Audio API. No audio files. */
function chime(context: AudioContext) {
  const now = context.currentTime;
  const out = context.createGain();
  out.gain.value = 0.16;
  out.connect(context.destination);
  [
    { freq: 880, at: 0 },
    { freq: 1318.5, at: 0.14 },
  ].forEach(({ freq, at }) => {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(1, now + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.7);
    osc.connect(gain);
    gain.connect(out);
    osc.start(now + at);
    osc.stop(now + at + 0.75);
  });
}

/**
 * Polls /api/alerts every 10 seconds for the whole console. A new alert (one this tab has not seen)
 * shows a toast at the top right and plays a soft chime, once the person has interacted with the page.
 */
export function AlertsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [alerts, setAlerts] = useState<TeamAlertItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [muted, setMuted] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [marking, startMarking] = useTransition();
  const seen = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const interacted = useRef(false);
  const mutedRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    const value = readMuted();
    setMuted(value);
    mutedRef.current = value;
  }, []);

  // Browsers only allow sound after the person has clicked or typed on the page once.
  useEffect(() => {
    if (!enabled) return;
    function unlock() {
      interacted.current = true;
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!audio.current && Ctor) audio.current = new Ctor();
        void audio.current?.resume();
      } catch {
        // No Web Audio: alerts stay silent.
      }
    }
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [enabled]);

  const play = useCallback(() => {
    if (mutedRef.current || !interacted.current || !audio.current) return;
    try {
      void audio.current.resume();
      chime(audio.current);
    } catch {
      // Ignore sound failures.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const response = await fetch("/api/alerts", { cache: "no-store", headers: { accept: "application/json" } });
        if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
          const data = (await response.json()) as { alerts?: TeamAlertItem[]; unread?: number };
          if (stopped) return;
          const list = Array.isArray(data.alerts) ? data.alerts : [];
          setAlerts(list);
          setUnread(typeof data.unread === "number" ? data.unread : list.length);
          if (seen.current === null) {
            // First load: what is already waiting shows on the badge, without a toast.
            seen.current = new Set(list.map((item) => item.id));
          } else {
            const fresh = list.filter((item) => !seen.current!.has(item.id));
            fresh.forEach((item) => seen.current!.add(item.id));
            if (fresh.length) {
              const shownAt = Date.now();
              setToasts((current) => [...fresh.reverse().map((item) => ({ ...item, shownAt })), ...current].slice(0, 4));
              play();
            }
          }
        }
      } catch {
        // Offline or signed out: try again on the next tick.
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    }
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, play]);

  // Each toast hides itself 12 seconds after it appears.
  useEffect(() => {
    if (!toasts.length) return;
    const next = Math.min(...toasts.map((toast) => toast.shownAt + TOAST_MS));
    const timer = setTimeout(() => {
      const now = Date.now();
      setToasts((current) => current.filter((toast) => toast.shownAt + TOAST_MS > now));
    }, Math.max(0, next - Date.now()));
    return () => clearTimeout(timer);
  }, [toasts]);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const value = !current;
      mutedRef.current = value;
      writeMuted(value);
      return value;
    });
  }, []);

  const markAllRead = useCallback(() => {
    startMarking(async () => {
      try {
        const result = await markAlertsRead();
        if (result.ok) {
          setAlerts([]);
          setUnread(0);
          setToasts([]);
        }
      } catch {
        // Leave the list as it is; the next poll shows the truth.
      }
    });
  }, []);

  const dismiss = (id: string) => setToasts((current) => current.filter((toast) => toast.id !== id));

  return (
    <AlertsContext.Provider value={{ enabled, alerts, unread, muted, toggleMute, markAllRead, marking }}>
      {children}
      {enabled && mounted
        ? createPortal(
            <div
              aria-live="polite"
              aria-relevant="additions"
              className="pointer-events-none fixed right-4 top-4 z-[70] grid w-[min(380px,calc(100vw-32px))] gap-2 max-lg:top-[68px]"
            >
              {toasts.map((toast) => (
                <div
                  key={toast.id}
                  role="status"
                  className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-[var(--color-line)] bg-white px-4 py-3 text-[var(--color-ink)] shadow-[var(--shadow-lift)]"
                >
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#f4ead2] text-[var(--color-accent-ink)]" aria-hidden>
                    <Bell size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-accent-ink)]">Team alert</p>
                    <p className="mt-0.5 text-pretty text-sm font-medium leading-5">{toast.text}</p>
                    <Link
                      href={`/inbox?id=${encodeURIComponent(toast.conversationId)}`}
                      onClick={() => dismiss(toast.id)}
                      className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-ink)]"
                    >
                      <MessageSquare size={13} aria-hidden />
                      Open chat
                    </Link>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(toast.id)}
                    aria-label="Dismiss alert"
                    className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center border-0 bg-transparent p-0 text-[var(--color-muted)] hover:bg-[#f6f3ee] hover:text-[var(--color-ink)]"
                  >
                    <X size={15} aria-hidden />
                  </button>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </AlertsContext.Provider>
  );
}

/**
 * The bell with a gold unread badge. Clicking opens the list of unread alerts.
 * `placement` decides where the list opens: beside the sidebar, or under the phone top bar.
 */
export function AlertBell({ placement, className }: { placement: "sidebar" | "topbar"; className?: string }) {
  const { enabled, alerts, unread, muted, toggleMute, markAllRead, marking } = useContext(AlertsContext);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left?: number; right?: number }>({ top: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  function toggle() {
    if (open) {
      close();
      return;
    }
    const rect = button.current?.getBoundingClientRect();
    if (rect) {
      setPosition(
        placement === "sidebar"
          ? { top: Math.max(12, rect.top), left: rect.right + 10 }
          : { top: rect.bottom + 10, right: 16 },
      );
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }
    function onPointer(event: PointerEvent) {
      const target = event.target as Node;
      if (panel.current?.contains(target) || button.current?.contains(target)) return;
      close(false);
    }
    function onResize() {
      close(false);
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  if (!enabled) return null;

  const label = unread ? `Alerts, ${unread} unread` : "Alerts, none unread";

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={clsx(
          "relative grid h-10 w-10 shrink-0 place-items-center border-0 bg-transparent p-0 text-white/75 hover:bg-white/10 hover:text-white",
          open && "bg-white/10 text-white",
          className,
        )}
      >
        <Bell size={19} strokeWidth={1.9} aria-hidden />
        {unread ? (
          <span
            aria-hidden
            className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#d4ad5f] px-1 text-[10.5px] font-bold leading-none text-[#1a140c] ring-2 ring-[var(--color-shell)]"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
      {open
        ? createPortal(
            <div
              ref={panel}
              role="dialog"
              aria-label="Team alerts"
              tabIndex={-1}
              style={{ top: position.top, left: position.left, right: position.right }}
              className="fixed z-[65] flex max-h-[min(520px,calc(100dvh-96px))] w-[min(380px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-white text-[var(--color-ink)] shadow-[var(--shadow-lift)]"
            >
              <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
                <div>
                  <p className="font-[family-name:var(--font-display)] text-[22px] font-medium leading-none tracking-tight">Alerts</p>
                  <p className="mt-1 text-[12px] text-[var(--color-muted)]">{unread ? `${unread} unread from the last 48 hours` : "Nothing unread in the last 48 hours"}</p>
                </div>
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-pressed={muted}
                  title={muted ? "Sound is off" : "Sound is on"}
                  className="inline-flex h-8 items-center gap-1.5 px-2.5 text-[12px] font-semibold text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                >
                  {muted ? <BellOff size={14} aria-hidden /> : <Volume2 size={14} aria-hidden />}
                  {muted ? "Muted" : "Sound on"}
                </button>
              </div>
              {alerts.length ? (
                <ul className="min-h-0 flex-1 divide-y divide-[var(--color-line)] overflow-y-auto overscroll-contain">
                  {alerts.map((alert) => (
                    <li key={alert.id} className="px-4 py-3">
                      <p className="text-[11.5px] font-medium text-[var(--color-muted)]">{agoIST(alert.createdAt)}</p>
                      <p className="mt-0.5 text-pretty text-sm leading-5">{alert.text}</p>
                      <Link
                        href={`/inbox?id=${encodeURIComponent(alert.conversationId)}`}
                        onClick={() => close(false)}
                        className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-ink)]"
                      >
                        <MessageSquare size={13} aria-hidden />
                        Open chat
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-8 text-center text-sm text-[var(--color-muted)]">You are all caught up.</p>
              )}
              {alerts.length ? (
                <div className="border-t border-[var(--color-line)] bg-[#fbf9f5] px-4 py-2.5">
                  <button type="button" onClick={markAllRead} disabled={marking} className="w-full text-[13px]">
                    {marking ? "Marking…" : "Mark all read"}
                  </button>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export function LiveInbox({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter();
  const version = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;
    async function check() {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/inbox/version", { cache: "no-store" });
        if (!response.ok) return;
        const { version: next } = (await response.json()) as { version: string | null };
        if (stopped || !next) return;
        if (version.current && version.current !== next) router.refresh();
        version.current = next;
      } catch {
        // Offline or redeploying; the next tick tries again.
      }
    }
    void check();
    const timer = setInterval(check, intervalMs);
    const onVisible = () => { if (!document.hidden) void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);

  return null;
}

/** Keeps the thread pinned to the newest message unless the reader has scrolled up. */
export function ChatThread({ count, className, children }: { count: number; className?: string; children: ReactNode }) {
  const list = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const node = list.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [count]);

  return (
    <ol
      ref={list}
      className={className}
      onScroll={(event) => {
        const node = event.currentTarget;
        pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      }}
    >
      {children}
    </ol>
  );
}

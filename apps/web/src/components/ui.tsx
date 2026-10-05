import type { ReactNode } from "react";
import { clsx } from "clsx";

export function SnapMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#0c7a72" />
      <path d="M8 18.5 13.2 12h5.1L23.8 18.5" fill="none" stroke="white" strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M8 22.2h11.5" fill="none" stroke="white" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="23.4" cy="11.2" r="1.7" fill="white" />
    </svg>
  );
}

export function StatusLabel({ tone, children }: { tone: "ok" | "wait" | "stop" | "sim" | "neutral"; children: ReactNode }) {
  const color = {
    ok: "bg-[#e7f6f3] text-[#085e58]",
    wait: "bg-[#fff6e8] text-[#92400e]",
    stop: "bg-[#fde8ec] text-[#9f1239]",
    sim: "bg-[#eef1f4] text-[#334155]",
    neutral: "bg-[#f4f5f7] text-[#334155]",
  }[tone];
  return <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-semibold leading-5", color)}>{children}</span>;
}

function ChannelGlyph({ channel }: { channel: "INSTAGRAM" | "FACEBOOK" | "WHATSAPP" }) {
  if (channel === "WHATSAPP") {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
        <path d="M8 1.6a6.4 6.4 0 0 0-5.5 9.7L1.6 14.4l3.2-.9A6.4 6.4 0 1 0 8 1.6Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M6 5.2c.2-.3.6-.3.8 0l.5 1.1c.1.2 0 .5-.2.7l-.3.3c.4.8 1 1.4 1.8 1.8l.3-.3c.2-.2.5-.3.7-.2l1.1.5c.3.2.3.6 0 .8-.6.6-1.5.8-2.3.4A6 6 0 0 1 5.6 7.5c-.4-.8-.2-1.7.4-2.3Z" fill="currentColor" />
      </svg>
    );
  }
  if (channel === "INSTAGRAM") {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
        <rect x="1.5" y="1.5" width="13" height="13" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="11.6" cy="4.4" r="0.8" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path d="M9.2 14V8.7h1.8l.3-2H9.2V5.4c0-.6.2-1 .9-1H11.4V2.6c-.3 0-.9-.1-1.6-.1-1.6 0-2.7 1-2.7 2.8v1.4H5.4v2h1.7V14h2.1Z" fill="currentColor" />
    </svg>
  );
}

export function ChannelMark({ channel }: { channel: "INSTAGRAM" | "FACEBOOK" | "WHATSAPP" }) {
  const style = channel === "INSTAGRAM"
    ? "bg-[#fdf2f6] text-[var(--color-ig)]"
    : channel === "WHATSAPP"
      ? "bg-[#ecfdf3] text-[var(--color-wa)]"
      : "bg-[#eff4ff] text-[var(--color-fb)]";
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", style)}>
      <ChannelGlyph channel={channel} />
      {channel === "INSTAGRAM" ? "Instagram" : channel === "WHATSAPP" ? "WhatsApp" : "Facebook"}
    </span>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--color-line)] bg-white px-6 py-12">
      <p className="text-[17px] font-semibold tracking-tight">{title}</p>
      <p className="mt-1 max-w-lg text-sm text-[var(--color-muted)]">{body}</p>
    </div>
  );
}

export function Notice({ tone, children }: { tone: "ok" | "stop"; children: ReactNode }) {
  return (
    <p className={clsx("mb-4 rounded-xl px-3 py-2 text-sm", tone === "ok" ? "bg-[#e7f6f3] text-[#085e58]" : "bg-[#fde8ec] text-[#9f1239]")}>
      {children}
    </p>
  );
}

export function PageTitle({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-balance text-[26px] font-semibold leading-none tracking-tight">{title}</h1>
        {detail ? <p className="mt-2 max-w-2xl text-pretty text-sm text-[var(--color-muted)]">{detail}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function StatGrid({ items, columns = 4 }: { items: Array<{ label: string; value: ReactNode }>; columns?: 4 | 5 }) {
  return (
    <dl className={clsx("grid gap-3 sm:grid-cols-2", columns === 5 ? "xl:grid-cols-5" : "lg:grid-cols-4")}>
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl bg-white px-4 py-4 shadow-[0_1px_0_rgba(20,23,28,0.06)]">
          <dt className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">{item.label}</dt>
          <dd className="mt-2 text-[30px] font-semibold leading-none tracking-tight">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("overflow-hidden rounded-2xl bg-white shadow-[0_1px_0_rgba(20,23,28,0.06)]", className)}>{children}</div>;
}

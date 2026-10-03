import type { ReactNode } from "react";
import { clsx } from "clsx";

export function StatusLabel({ tone, children }: { tone: "ok" | "wait" | "stop" | "sim" | "neutral"; children: ReactNode }) {
  const color = {
    ok: "bg-[#e7f6f3] text-[#115e59]",
    wait: "bg-[#fff6e8] text-[#92400e]",
    stop: "bg-[#fde8ec] text-[#9f1239]",
    sim: "bg-[#eef1f4] text-[#334155]",
    neutral: "bg-white text-[#334155] border border-[var(--color-line)]",
  }[tone];
  return <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium leading-5", color)}>{children}</span>;
}

export function ChannelMark({ channel }: { channel: "INSTAGRAM" | "FACEBOOK" }) {
  return (
    <span className={clsx("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", channel === "INSTAGRAM" ? "bg-[#fdf2f6] text-[var(--color-ig)]" : "bg-[#eff4ff] text-[var(--color-fb)]")}>
      {channel === "INSTAGRAM" ? "Instagram" : "Facebook"}
    </span>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-white px-5 py-10">
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-lg text-sm text-[var(--color-muted)]">{body}</p>
    </div>
  );
}

export function PageTitle({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-balance text-[28px] font-semibold leading-none tracking-tight">{title}</h1>
        {detail ? <p className="mt-2 max-w-2xl text-pretty text-sm text-[var(--color-muted)]">{detail}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function StatGrid({ items, columns = 4 }: { items: Array<{ label: string; value: ReactNode }>; columns?: 4 | 5 }) {
  return (
    <dl className={clsx("grid gap-px overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2", columns === 5 ? "xl:grid-cols-5" : "lg:grid-cols-4")}>
      {items.map((item) => (
        <div key={item.label} className="bg-white px-4 py-3.5">
          <dt className="text-[13px] text-[var(--color-muted)]">{item.label}</dt>
          <dd className="mt-1.5 text-[28px] font-semibold leading-none tracking-tight">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("rounded-lg border border-[var(--color-line)] bg-white", className)}>{children}</div>;
}

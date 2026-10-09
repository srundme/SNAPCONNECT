import type { ReactNode } from "react";
import { clsx } from "clsx";

export function Card({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("rounded-2xl bg-white shadow-[0_1px_0_rgba(20,23,28,0.06)]", className)}>
      <header className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-5 py-3.5">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]">{title}</h2>
        {action}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Field({ label, children, muted }: { label: string; children: ReactNode; muted?: boolean }) {
  return (
    <div className="grid gap-0.5 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[13px] text-[var(--color-muted)]">{label}</dt>
      <dd className={clsx("min-w-0 break-words text-[14px]", muted ? "italic text-[#a59c8f]" : "font-medium")}>{children}</dd>
    </div>
  );
}

export function ActionLink({ href, icon, children, external }: { href: string; icon: ReactNode; children: ReactNode; external?: boolean }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-1.5 text-[13px] font-semibold hover:border-[var(--color-accent)] hover:text-[var(--color-accent-ink)]"
    >
      {icon}
      {children}
    </a>
  );
}

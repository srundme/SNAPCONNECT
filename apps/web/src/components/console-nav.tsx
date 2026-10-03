"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bot,
  Inbox,
  LayoutDashboard,
  Plug,
  ScrollText,
  Shield,
  SquarePen,
  Users,
  UsersRound,
} from "lucide-react";
import { clsx } from "clsx";

const groups = [
  {
    label: "Work",
    items: [
      ["/overview", "Overview", LayoutDashboard],
      ["/inbox", "Inbox", Inbox],
      ["/leads", "Leads", Users],
      ["/reports", "Reports", BarChart3],
    ],
  },
  {
    label: "Setup",
    items: [
      ["/posts", "Posts & Rules", SquarePen],
      ["/ai", "AI settings", Bot],
      ["/integrations", "Integrations", Plug],
      ["/team", "Team", UsersRound],
    ],
  },
  {
    label: "System",
    items: [
      ["/audit", "Audit", ScrollText],
      ["/health", "System health", Activity],
    ],
  },
] as const;

export function ConsoleNav({ showPlatform, viewer }: { showPlatform: boolean; viewer: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="grid gap-5 px-3 py-2">
      {showPlatform ? <NavLink href="/platform" label="Platform" icon={Shield} active={pathname.startsWith("/platform")} /> : null}
      {groups.map((group) => {
        const items = group.items.filter(([href]) => !viewer || href === "/overview" || href === "/reports");
        if (items.length === 0) return null;
        return (
          <div key={group.label}>
            <p className="px-2 pb-1 text-[11px] font-medium text-[var(--color-muted)]">{group.label}</p>
            <div className="grid gap-0.5">
              {items.map(([href, label, Icon]) => (
                <NavLink key={href} href={href} label={label} icon={Icon} active={pathname === href || pathname.startsWith(`${href}/`)} />
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: typeof Inbox;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm",
        active ? "bg-[var(--color-paper)] font-medium text-[var(--color-ink)]" : "text-[#3d4b57] hover:bg-[var(--color-paper)]",
      )}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden />
      {label}
    </Link>
  );
}

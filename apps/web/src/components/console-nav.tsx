"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bot,
  ChevronDown,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Plug,
  ScrollText,
  Settings2,
  Shield,
  ShieldCheck,
  SquarePen,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { logout } from "@/lib/actions";

type Role = "SUPER_ADMIN" | "ADMIN" | "AGENT" | "VIEWER" | null;
type Item = { href: string; label: string; icon: typeof Inbox; roles?: Role[] };

const ADMINS: Role[] = ["ADMIN", "SUPER_ADMIN"];
const STAFF: Role[] = ["ADMIN", "SUPER_ADMIN", "AGENT"];

const work: Item[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: Inbox, roles: STAFF },
  { href: "/leads", label: "Leads", icon: Users, roles: STAFF },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

const setup: Item[] = [
  { href: "/posts", label: "Replies", icon: SquarePen, roles: ADMINS },
  { href: "/ai", label: "Agent", icon: Bot, roles: STAFF },
  { href: "/integrations", label: "Connections", icon: Plug, roles: ADMINS },
  { href: "/team", label: "Team", icon: UsersRound, roles: ADMINS },
];

const system: Item[] = [
  { href: "/compliance", label: "Compliance", icon: ShieldCheck },
  { href: "/audit", label: "Audit", icon: ScrollText },
  { href: "/health", label: "Health", icon: Activity },
];

const titles: Record<string, string> = {
  "/platform": "Platform",
  ...Object.fromEntries([...work, ...setup, ...system].map((item) => [item.href, item.label])),
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function allowed(item: Item, role: Role) {
  return !item.roles || item.roles.includes(role);
}

/** Old export kept for compatibility: renders just the nav list. */
export function ConsoleNav({ showPlatform, viewer }: { showPlatform: boolean; viewer: boolean }) {
  return <NavList role={viewer ? "VIEWER" : showPlatform ? "SUPER_ADMIN" : "ADMIN"} showPlatform={showPlatform} />;
}

function NavList({ role, showPlatform, onNavigate }: { role: Role; showPlatform: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const admin = role === "ADMIN" || role === "SUPER_ADMIN";
  const inSystem = system.some((item) => isActive(pathname, item.href));
  const [systemOpen, setSystemOpen] = useState(inSystem);
  const groups = [
    { label: "Work", items: work.filter((item) => allowed(item, role)) },
    { label: "Setup", items: setup.filter((item) => allowed(item, role)) },
  ];
  return (
    <nav aria-label="Main" className="grid gap-5 px-3 py-2">
      {showPlatform ? (
        <NavLink href="/platform" label="Platform" icon={Shield} active={isActive(pathname, "/platform")} onNavigate={onNavigate} />
      ) : null}
      {groups.map((group) =>
        group.items.length ? (
          <div key={group.label}>
            <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/35">{group.label}</p>
            <div className="grid gap-0.5">
              {group.items.map((item) => (
                <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} active={isActive(pathname, item.href)} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ) : null,
      )}
      {admin ? (
        <div>
          <button
            type="button"
            aria-expanded={systemOpen || inSystem}
            aria-controls="nav-system"
            onClick={() => setSystemOpen((open) => !open)}
            className="flex w-full items-center gap-2.5 rounded-xl border-0 bg-transparent px-2.5 py-2 text-left text-sm font-normal text-white/60 hover:bg-white/8 hover:text-white"
          >
            <Settings2 size={18} strokeWidth={1.9} aria-hidden />
            <span className="flex-1">System</span>
            <ChevronDown size={15} aria-hidden className={clsx("transition-transform", (systemOpen || inSystem) && "rotate-180")} />
          </button>
          <div id="nav-system" hidden={!(systemOpen || inSystem)} className="mt-0.5 grid gap-0.5 pl-3">
            {system.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} active={isActive(pathname, item.href)} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ) : null}
    </nav>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: typeof Inbox;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors",
        active ? "bg-[#f4ead2] font-semibold text-[#1a140c]" : "text-white/72 hover:bg-white/8 hover:text-white",
      )}
    >
      <Icon size={18} strokeWidth={1.9} aria-hidden />
      {label}
    </Link>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The console frame. Desktop (lg and up): a fixed left sidebar. Phones and tablets:
 * a slim top bar with the page title and a menu button that slides the same sidebar in as a drawer.
 */
export function ConsoleShell({
  role,
  showPlatform,
  userName,
  roleText,
  practice,
  brand,
  workspaceSwitch,
  children,
}: {
  role: Role;
  showPlatform: boolean;
  userName: string;
  roleText: string;
  practice: boolean;
  brand: ReactNode;
  workspaceSwitch: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const title = Object.entries(titles).find(([href]) => isActive(pathname, href))?.[1] ?? "";

  const close = useCallback(() => {
    setOpen(false);
    menuButton.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const panel = drawer.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel?.querySelector<HTMLElement>("[data-drawer-close]")?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    function onResize() {
      if (window.matchMedia("(min-width: 1024px)").matches) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[252px_minmax(0,1fr)]">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/10 bg-[var(--color-shell)] px-4 text-white lg:hidden">
        <button
          ref={menuButton}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="console-drawer"
          className="-ml-1.5 grid h-10 w-10 place-items-center border-0 bg-transparent p-0 text-white hover:bg-white/10"
        >
          <Menu size={22} aria-hidden />
        </button>
        <Link href="/overview" className="shrink-0" aria-label="Home">
          <img src="/brand/mark.png" alt="" className="h-9 w-auto" />
        </Link>
        <span className="h-5 w-px bg-white/15" aria-hidden />
        <p className="min-w-0 flex-1 truncate font-[family-name:var(--font-display)] text-[20px] font-medium leading-none tracking-tight">{title}</p>
        {practice ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/80">Practice</span> : null}
      </header>

      <div
        aria-hidden
        onClick={close}
        className={clsx(
          "fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] transition-opacity duration-200 lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        id="console-drawer"
        ref={drawer}
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        aria-label="Menu"
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex w-[min(300px,86vw)] flex-col overflow-y-auto overscroll-contain bg-[var(--color-shell)] text-white shadow-2xl transition-[transform,visibility] duration-200 ease-out",
          "lg:sticky lg:top-0 lg:z-20 lg:h-dvh lg:w-auto lg:translate-x-0 lg:self-start lg:shadow-none lg:visible",
          open ? "visible translate-x-0" : "invisible -translate-x-full",
        )}
      >
        <div className="flex items-start justify-between px-3 pb-3 pt-4">
          {brand}
          <button
            type="button"
            data-drawer-close
            onClick={close}
            aria-label="Close menu"
            className="grid h-10 w-10 place-items-center border-0 bg-transparent p-0 text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        {workspaceSwitch}
        <NavList role={role} showPlatform={showPlatform} onNavigate={() => setOpen(false)} />
        <div className="mt-auto border-t border-white/10 px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f4ead2] text-[13px] font-semibold text-[#6e5420]" aria-hidden>
              {initials(userName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{userName}</p>
              <p className="text-[12px] text-white/50">
                {roleText}
                {practice ? " · Practice" : ""}
              </p>
            </div>
          </div>
          <form action={logout} className="mt-3">
            <button type="submit" className="inline-flex items-center gap-1.5 border-white/10 bg-white/8 text-white/85 hover:border-white/20 hover:bg-white/14 hover:text-white">
              <LogOut size={14} aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 overflow-x-clip">
        <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</div>
      </main>
    </div>
  );
}

function initials(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "·";
}

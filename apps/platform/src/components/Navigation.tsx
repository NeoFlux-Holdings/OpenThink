"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Cloud, GitBranch, ShieldCheck, TerminalSquare, Workflow } from "lucide-react";

const navItems = [
  { href: "/deploy", label: "Deploy", icon: Cloud },
  { href: "/chat", label: "Chat", icon: Bot },
  { href: "/terminal", label: "Terminal", icon: TerminalSquare },
  { href: "/sync", label: "Sync", icon: GitBranch },
  { href: "/admin", label: "Admin", icon: ShieldCheck }
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <header className="topbar">
      <Link className="brand" href="/deploy" aria-label="open-think deploy">
        <span className="brand-mark" aria-hidden="true">
          <Workflow size={18} />
        </span>
        <span>
          <strong>open-think</strong>
          <small>beta2</small>
        </span>
      </Link>
      <nav className="nav-links" aria-label="Primary navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              className="nav-link"
              data-active={active}
              href={item.href}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="topbar-status" aria-label="Platform status">
        <span className="status-dot" aria-hidden="true" />
        Cloudflare native
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AgentsIcon, BriefsIcon, HomeIcon, MarketsIcon, PortfolioIcon, SettingsIcon, WatchlistIcon } from "./icons";
import styles from "./shell.module.css";

const LINKS = [
  { href: "/", label: "Home", icon: HomeIcon, match: (path: string) => path === "/" },
  { href: "/markets", label: "Markets", icon: MarketsIcon, match: (path: string) => path.startsWith("/markets") },
  { href: "/watchlist", label: "Watchlist", icon: WatchlistIcon, match: (path: string) => path.startsWith("/watchlist") },
  { href: "/agents", label: "Agents", icon: AgentsIcon, match: (path: string) => path.startsWith("/agents") },
  { href: "/briefs", label: "Briefs", icon: BriefsIcon, match: (path: string) => path.startsWith("/briefs") },
  { href: "/positions", label: "Portfolio", icon: PortfolioIcon, match: (path: string) => path.startsWith("/positions") },
] as const;

export function Shell({ children }: { readonly children: ReactNode }) {
  const path = usePathname();
  return (
    <div className={styles.app}>
      <nav className={styles.sidebar} aria-label="Main">
        <Link href="/" className={styles.brand}>
          <img className={styles.mark} src="/logo.svg" alt="" />
          <span className={styles.wordmark}>Predictle</span>
        </Link>
        {LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href} className={styles.navLink} aria-current={link.match(path) ? "page" : undefined}>
              <Icon />
              {link.label}
            </Link>
          );
        })}
        <div className={styles.spacer} />
        <Link href="/settings" className={styles.navLink} aria-current={path.startsWith("/settings") ? "page" : undefined}>
          <SettingsIcon />
          Settings
        </Link>
      </nav>
      <div className={styles.column}>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}

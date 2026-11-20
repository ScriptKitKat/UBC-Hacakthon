"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { formatBudgetCents, formatResetLabel } from "@/shared";
import { usePolling } from "../_desk/use-polling";
import { loadRail } from "./api";
import type { HomeRail } from "./api";
import { BriefsIcon, HomeIcon, MarketsIcon, PortfolioIcon, SettingsIcon, WatchlistIcon } from "./icons";
import styles from "./shell.module.css";

const LINKS = [
  { href: "/", label: "Home", icon: HomeIcon, match: (path: string) => path === "/" },
  { href: "/markets", label: "Markets", icon: MarketsIcon, match: (path: string) => path.startsWith("/markets") },
  { href: "/watchlist", label: "Watchlist", icon: WatchlistIcon, match: (path: string) => path.startsWith("/watchlist") },
  { href: "/briefs", label: "Briefs", icon: BriefsIcon, match: (path: string) => path.startsWith("/briefs") },
  { href: "/positions", label: "Portfolio", icon: PortfolioIcon, match: (path: string) => path.startsWith("/positions") },
] as const;

const RAIL_MS = 8000;

export function Shell({ children }: { readonly children: ReactNode }) {
  const path = usePathname();
  const [rail, setRail] = useState<HomeRail | undefined>(undefined);
  usePolling(() => { void loadRail().then(setRail); }, RAIL_MS);
  const spent = rail ? Math.min(100, rail.dailyCapCents <= 0 ? 0 : (rail.spentCents / rail.dailyCapCents) * 100) : 0;
  return (
    <div className={styles.app}>
      <nav className={styles.sidebar} aria-label="Main">
        <Link href="/" className={styles.brand}>
          <span className={styles.mark}>PD</span>
          <span className={styles.wordmark}>Prediction Desk</span>
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
        <div className={styles.budget}>
          <div className={styles.budgetRow}>
            <span>Daily budget</span>
            <span className={styles.budgetValue}>
              {rail ? `${formatBudgetCents(rail.spentCents)} / ${formatBudgetCents(rail.dailyCapCents)}` : "…"}
            </span>
          </div>
          <div className={styles.track} aria-hidden="true">
            <div className={styles.fill} style={{ width: `${String(spent)}%` }} />
          </div>
          <div className={styles.budgetHint}>
            {rail ? `${formatBudgetCents(rail.remainingCents)} left · ${formatResetLabel(rail.resetAt)}` : "Loading budget…"}
          </div>
        </div>
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

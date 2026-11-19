import Link from "next/link";
import type { LedgerView } from "@/shared";
import { BrandMark } from "./icons";
import styles from "./desk.module.css";

export interface AppBarState {
  readonly ledger: LedgerView;
  readonly killSwitch: boolean;
}

function ledgerChip(ledger: LedgerView): { readonly label: string; readonly tone: "ok" | "warn" } {
  return ledger.configured
    ? { label: `Solana ${ledger.cluster}`, tone: "ok" }
    : { label: "Solana ledger not configured", tone: "warn" };
}

export function AppBar({ state }: { readonly state: AppBarState | null }) {
  const ledger = state ? ledgerChip(state.ledger) : null;
  return (
    <header className={styles.appBar}>
      <div className={styles.brand}>
        <BrandMark />
        <h1 className={styles.wordmark}>
          News-to-Trade <span>Desk</span>
        </h1>
        <span className={styles.liveTag}>
          <span className={styles.liveDot} aria-hidden="true" />
          LIVE
        </span>
      </div>
      <nav className={styles.appNav} aria-label="Pages">
        <Link className={styles.appNavLink} href="/">Desk</Link>
        <Link className={styles.appNavLink} href="/positions">Positions</Link>
      </nav>
      {state && ledger ? (
        <ul className={styles.appChips}>
          <li className={styles.appChip} data-tone={ledger.tone}>{ledger.label}</li>
          <li className={styles.appChip} data-tone="ok">Gemini Prediction Markets</li>
          <li className={styles.appChip} data-tone={state.killSwitch ? "danger" : "ok"}>
            {state.killSwitch ? "Kill switch ON" : "Trading live"}
          </li>
        </ul>
      ) : null}
    </header>
  );
}

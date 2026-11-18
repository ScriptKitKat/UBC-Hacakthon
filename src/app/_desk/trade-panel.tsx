"use client";

import { useState } from "react";
import type { MatchView, Outcome, PendingView } from "@/shared";
import { formatClock, formatDollars, parseDollarsToCents } from "./format";
import styles from "./desk.module.css";

export interface BetRequest {
  readonly instrumentSymbol: string;
  readonly outcome: Outcome;
  readonly notionalCents: number;
  readonly senderId: string;
}

interface TradePanelProps {
  readonly match: MatchView;
  readonly senders: readonly string[];
  readonly pending: readonly PendingView[];
  readonly busy: boolean;
  readonly onBet: (bet: BetRequest) => void;
  readonly onApprove: (intentId: string, approverId: string) => void;
}

export function TradePanel({ match, senders, pending, busy, onBet, onApprove }: TradePanelProps) {
  const [outcome, setOutcome] = useState<Outcome>("yes");
  const [amount, setAmount] = useState("2");
  const [chosenSender, setChosenSender] = useState<string | undefined>(undefined);
  const senderId = chosenSender ?? senders[0] ?? "";
  const cents = parseDollarsToCents(amount);
  const symbol = match.kind === "matched" ? match.market.instrumentSymbol : undefined;
  const canBet = symbol !== undefined && cents !== undefined && senderId !== "" && !busy;
  return (
    <section className={styles.panel} aria-labelledby="trade-heading">
      <h2 id="trade-heading" className={styles.panelTitle}>Trade</h2>
      <div className={styles.controls}>
        <div className={styles.segment} role="group" aria-label="Outcome">
          {(["yes", "no"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={outcome === option}
              className={outcome === option ? (option === "yes" ? styles.segmentYes : styles.segmentNo) : styles.segmentIdle}
              onClick={() => {
                setOutcome(option);
              }}
            >
              {option === "yes" ? "Yes" : "No"}
            </button>
          ))}
        </div>
        <label className={styles.amount}>
          <span className={styles.fieldLabel}>Amount ($)</span>
          <input
            className={styles.input}
            inputMode="decimal"
            value={amount}
            aria-invalid={cents === undefined}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        </label>
        <label className={styles.amount}>
          <span className={styles.fieldLabel}>Acting as</span>
          <select
            className={styles.input}
            value={senderId}
            onChange={(event) => {
              setChosenSender(event.target.value);
            }}
          >
            {senders.map((sender) => (
              <option key={sender} value={sender}>{sender}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={styles.betButton}
          disabled={!canBet}
          onClick={() => {
            if (symbol !== undefined && cents !== undefined) onBet({ instrumentSymbol: symbol, outcome, notionalCents: cents, senderId });
          }}
        >
          Bet
        </button>
      </div>
      {symbol === undefined ? <p className={styles.empty}>Match news to a market to enable betting.</p> : null}
      {cents === undefined ? <p className={styles.warning}>Enter a dollar amount with at most two decimals.</p> : null}

      <h3 className={styles.subTitle}>Waiting for approval</h3>
      {pending.length === 0 ? (
        <p className={styles.empty}>Nothing waiting for approval.</p>
      ) : (
        <ul className={styles.pendingList}>
          {pending.map((item) => (
            <li key={item.intentId} className={styles.pendingItem}>
              <span className={styles.pendingText}>
                {formatDollars(item.notionalCents)} {item.outcome.toUpperCase()} · {item.symbol} · {item.senderId} · {formatClock(item.createdAt)}
              </span>
              <button
                type="button"
                className={styles.approveButton}
                disabled={busy || senderId === ""}
                onClick={() => {
                  onApprove(item.intentId, senderId);
                }}
              >
                Approve
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

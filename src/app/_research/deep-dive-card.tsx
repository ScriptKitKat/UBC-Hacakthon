"use client";

import { useState } from "react";
import type { DeepDiveResult, DeepDiveStep, ResearchBrief } from "@/shared";
import { formatClock, shortenMiddle } from "../_desk/format";
import { purchaseDeepDive } from "./api";
import styles from "./research.module.css";

const REVEAL_INTERVAL_MS = 450;

const STEP_TITLES: readonly { readonly step: DeepDiveStep["step"]; readonly title: string }[] = [
  { step: "requirements", title: "402 Payment Required" },
  { step: "guardrails", title: "Guardrails" },
  { step: "signed", title: "Payment signed" },
  { step: "settled", title: "Settled on Solana" },
  { step: "brief", title: "Brief delivered" },
];

type StepState = "done" | "active" | "failed" | "pending";

type Progress =
  | { readonly phase: "idle" }
  | { readonly phase: "paying" }
  | { readonly phase: "revealing"; readonly result: DeepDiveResult; readonly shown: number }
  | { readonly phase: "finished"; readonly result: DeepDiveResult }
  | { readonly phase: "error"; readonly message: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stepState(index: number, shown: number, outcome: "working" | "success" | "failed"): StepState {
  if (index < shown) return "done";
  if (index > shown || outcome === "success") return "pending";
  return outcome === "failed" ? "failed" : "active";
}

function StepMark({ state }: { readonly state: StepState }) {
  const marks: Record<StepState, string> = { done: "✓", active: "…", failed: "✗", pending: "·" };
  return <span className={styles.stepMark} aria-hidden="true">{marks[state]}</span>;
}

function StepDetail({ step }: { readonly step: DeepDiveStep }) {
  return (
    <span className={styles.stepDetail}>
      {step.detail}
      {step.step === "signed" ? <> {shortenMiddle(step.signature, 8, 6)}</> : null}
      {step.step === "settled" ? (
        <>
          {" "}
          <a className={styles.link} href={step.explorerUrl} target="_blank" rel="noopener noreferrer" title={step.signature}>
            View on Solana Explorer ↗
          </a>{" "}
          {shortenMiddle(step.signature, 8, 6)}
        </>
      ) : null}
    </span>
  );
}

function Steps({ trace, shown, outcome, failureReason }: {
  readonly trace: readonly DeepDiveStep[];
  readonly shown: number;
  readonly outcome: "working" | "success" | "failed";
  readonly failureReason: string | null;
}) {
  return (
    <ol className={styles.steps} aria-label="Payment steps" aria-live="polite">
      {STEP_TITLES.map(({ step, title }, index) => {
        const state = stepState(index, shown, outcome);
        const reached = trace[index];
        return (
          <li key={step} className={styles.step} data-state={state}>
            <StepMark state={state} />
            <span>
              <span className={styles.stepTitle}>{title}</span>
              {reached !== undefined && state === "done" ? <> <StepDetail step={reached} /></> : null}
              {state === "failed" && failureReason !== null ? <> <span className={styles.stepDetail}>{failureReason}</span></> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Brief({ brief, result }: { readonly brief: ResearchBrief; readonly result: DeepDiveResult }) {
  return (
    <article className={styles.brief} aria-label="Deep dive brief">
      <h3 className={styles.briefHeadline}>{brief.headline}</h3>
      {brief.sections.map((section) => (
        <section key={section.title} className={styles.briefSection}>
          <h4 className={styles.briefSectionTitle}>{section.title}</h4>
          <p className={styles.briefBody}>{section.body}</p>
        </section>
      ))}
      <p className={styles.briefFoot}>
        {result.alreadyPurchased && result.purchase !== null ? `Bought at ${formatClock(result.purchase.at)}; opening it again was free. ` : null}
        Written by {brief.polishedBy === "grok" ? "Grok from the desk's template" : "the desk's template"} using data from this page.
      </p>
    </article>
  );
}

export function DeepDiveCard({ symbol }: { readonly symbol: string }) {
  const [progress, setProgress] = useState<Progress>({ phase: "idle" });
  const busy = progress.phase === "paying" || progress.phase === "revealing";

  const buy = async () => {
    setProgress({ phase: "paying" });
    const purchase = await purchaseDeepDive(symbol);
    if (purchase.kind === "error") {
      setProgress({ phase: "error", message: purchase.message });
      return;
    }
    const { result } = purchase;
    for (let shown = 0; shown <= result.trace.length; shown += 1) {
      setProgress({ phase: "revealing", result, shown });
      if (shown < result.trace.length) await sleep(REVEAL_INTERVAL_MS);
    }
    setProgress({ phase: "finished", result });
  };

  const result = progress.phase === "revealing" || progress.phase === "finished" ? progress.result : null;
  const finished = progress.phase === "finished";
  const shown = progress.phase === "revealing" ? progress.shown : result?.trace.length ?? 0;
  const revealed = result !== null && shown >= result.trace.length;
  const outcome = result === null || !revealed ? "working" : result.status === "delivered" ? "success" : "failed";
  return (
    <section className={styles.deepDive} aria-labelledby="deep-dive-heading">
      <div className={styles.deepDiveHead}>
        <h2 id="deep-dive-heading" className={styles.panelTitle}>Deep dive · $0.05</h2>
      </div>
      <p className={styles.explainerNote}>
        The desk's agent pays 0.05 USDC over x402 from its own wallet, inside the same daily budget as its bets, and gets back a written brief built from this market's data.
      </p>
      {progress.phase === "error" ? <p className={styles.refusal} role="alert">{progress.message}</p> : null}
      {progress.phase === "paying" ? <Steps trace={[]} shown={0} outcome="working" failureReason={null} /> : null}
      {result !== null ? <Steps trace={result.trace} shown={shown} outcome={outcome} failureReason={result.failureReason} /> : null}
      {finished && result?.brief ? <Brief brief={result.brief} result={result} /> : null}
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={busy}
        onClick={() => {
          void buy();
        }}
      >
        {busy ? "Paying…" : finished && result?.brief ? "Open again (no new charge)" : "Buy deep dive"}
      </button>
    </section>
  );
}

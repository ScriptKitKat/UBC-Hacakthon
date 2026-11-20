"use client";

import { useRef, useState } from "react";
import type { ResearchTimeframe, ResearchView } from "@/shared";
import { usePolling } from "../_desk/use-polling";
import { loadResearch } from "./api";
import type { ResearchResult } from "./api";
import { BeginnerView } from "./beginner-view";
import type { ViewMode } from "./use-view-mode";
import styles from "./research.module.css";

const POLL_INTERVAL_MS = 15_000;
const DEFAULT_TIMEFRAME: ResearchTimeframe = "1D";

interface Loaded {
  readonly view: ResearchView | null;
  readonly problem: "unknown" | "unavailable" | "error" | null;
}

function problemMessage(problem: NonNullable<Loaded["problem"]>): string {
  switch (problem) {
    case "unknown":
      return "We couldn't find this market on Gemini. It may have been removed or the link may be wrong.";
    case "unavailable":
      return "Gemini isn't responding right now (the exchange has a nightly maintenance window, 11pm–2am CST). Try again in a few minutes.";
    case "error":
      return "Couldn't refresh this page. Trying again shortly.";
    default: {
      const exhaustive: never = problem;
      return exhaustive;
    }
  }
}

function dataBanners(view: ResearchView): readonly string[] {
  return [
    view.data.event === "stale" ? "Gemini isn't responding, so the prices and details below are the last ones we saw." : null,
  ].filter((message) => message !== null);
}

export function ResearchPage({ symbol, refreshKey }: { readonly symbol: string; readonly initialView?: ViewMode; readonly refreshKey?: number }) {
  const [loaded, setLoaded] = useState<Loaded>({ view: null, problem: null });
  const [timeframe, setTimeframe] = useState<ResearchTimeframe>(DEFAULT_TIMEFRAME);
  const wanted = useRef<ResearchTimeframe>(DEFAULT_TIMEFRAME);

  const apply = (result: ResearchResult, requested: ResearchTimeframe) => {
    if (requested !== wanted.current) return;
    if (result.kind === "ready") setLoaded({ view: result.view, problem: null });
    else setLoaded((previous) => ({ view: result.kind === "unknown" ? null : previous.view, problem: result.kind }));
  };

  const refresh = () => {
    const requested = wanted.current;
    void loadResearch(symbol, requested).then((result) => {
      apply(result, requested);
    });
  };
  usePolling(refresh, POLL_INTERVAL_MS, refreshKey);

  const chooseTimeframe = (next: ResearchTimeframe) => {
    wanted.current = next;
    setTimeframe(next);
    refresh();
  };

  const { view, problem } = loaded;
  const banners = view === null ? [] : dataBanners(view);
  return (
    <div className={styles.page}>
      {problem !== null ? <p className={styles.banner} role="alert">{problemMessage(problem)}</p> : null}
      {view === null && problem === null ? <p className={styles.status}>Loading market data…</p> : null}
      {view !== null ? (
        <BeginnerView view={view} timeframe={timeframe} onTimeframe={chooseTimeframe} banners={banners} />
      ) : null}
    </div>
  );
}

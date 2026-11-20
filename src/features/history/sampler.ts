import { parseInstrumentSymbol } from "@/features/markets";
import type { GeminiMarketsClient } from "@/features/markets";
import type { HistoryStore } from "./store";

export const DEFAULT_SAMPLE_INTERVAL_MS = 30_000;

export interface Sampler {
  readonly sampleOnce: () => Promise<void>;
  readonly start: () => void;
  readonly stop: () => void;
}

export interface SamplerOptions {
  readonly history: HistoryStore;
  readonly markets: Pick<GeminiMarketsClient, "getEvent">;
  readonly nowMs: () => number;
  readonly intervalMs?: number;
  readonly schedule?: (task: () => Promise<void>, intervalMs: number) => () => void;
}

function defaultSchedule(task: () => Promise<void>, intervalMs: number): () => void {
  const timer = setInterval(() => { void task(); }, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}

export function createSampler(options: SamplerOptions): Sampler {
  const { history, markets, nowMs } = options;
  const schedule = options.schedule ?? defaultSchedule;
  let running = false;
  let cancel: (() => void) | undefined;

  async function sampleEvent(eventTicker: string, symbols: ReadonlySet<string>): Promise<void> {
    const result = await markets.getEvent(eventTicker, { refresh: true });
    if (!result.ok) return;
    const atMs = nowMs();
    for (const contract of result.value.contracts) {
      const { buyYesCents, bestBidCents, bestAskCents } = contract.prices;
      if (symbols.has(contract.instrumentSymbol) && buyYesCents !== null) {
        history.record(contract.instrumentSymbol, { atMs, yesCents: buyYesCents, bidCents: bestBidCents, askCents: bestAskCents });
      }
    }
  }

  async function sampleOnce(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const byEvent = new Map<string, Set<string>>();
      for (const symbol of history.watched()) {
        const parsed = parseInstrumentSymbol(symbol);
        if (parsed) byEvent.set(parsed.eventTicker, (byEvent.get(parsed.eventTicker) ?? new Set()).add(symbol));
      }
      await Promise.all([...byEvent].map(([eventTicker, symbols]) => sampleEvent(eventTicker, symbols).catch(() => undefined)));
      await history.flush().catch(() => undefined);
    } finally {
      running = false;
    }
  }

  return {
    sampleOnce,
    start() {
      cancel ??= schedule(sampleOnce, options.intervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS);
    },
    stop() {
      cancel?.();
      cancel = undefined;
    },
  };
}

"use client";

import { useRef, useState } from "react";
import { usePolling } from "../_desk/use-polling";
import { changeWatchlist, loadWatchlist } from "../_shell/api";
import { applyStarToggle, isStarred } from "./query";

const POLL_MS = 30_000;

export function starKeys(eventTicker: string, instrumentSymbol?: string | null): string[] {
  return instrumentSymbol === undefined || instrumentSymbol === null || instrumentSymbol === eventTicker
    ? [eventTicker]
    : [eventTicker, instrumentSymbol];
}

export function useWatchlist(initialSymbols: readonly string[] = []) {
  const [saved, setSaved] = useState(() => new Set(initialSymbols));
  const pending = useRef(0);

  usePolling(() => {
    if (pending.current > 0) return;
    void loadWatchlist().then((keys) => {
      if (pending.current > 0) return;
      setSaved(new Set(keys));
    });
  }, POLL_MS);

  const starred = (eventTicker: string, instrumentSymbol?: string | null): boolean => isStarred(saved, starKeys(eventTicker, instrumentSymbol));

  const toggle = async (input: { eventTicker: string; instrumentSymbol?: string | null; yesCents?: number | null }): Promise<boolean> => {
    const keys = starKeys(input.eventTicker, input.instrumentSymbol);
    const nextSaved = !starred(input.eventTicker, input.instrumentSymbol);
    const previous = saved;
    setSaved(applyStarToggle(saved, keys, nextSaved));
    pending.current += 1;
    const result = await changeWatchlist({
      action: nextSaved ? "add" : "remove",
      eventTicker: input.eventTicker,
      ...(input.instrumentSymbol ? { contract: input.instrumentSymbol } : {}),
      ...(input.yesCents === undefined ? {} : { yesCents: input.yesCents }),
    });
    pending.current -= 1;
    if (!result.ok) {
      setSaved(previous);
      return false;
    }
    setSaved(new Set(result.view.symbols));
    return true;
  };

  return { starred, toggle, symbols: saved };
}

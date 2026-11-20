import { z } from "zod";
import { parseInstrumentSymbol } from "@/features/markets";
import { createJsonStore, createSerialQueue } from "@/features/storage";
import type { FileSystem } from "@/features/storage";

const itemSchema = z.object({
  eventTicker: z.string().min(1),
  instrumentSymbol: z.string().min(1).nullable(),
  savedAt: z.string().min(1).nullable(),
  savedYesCents: z.number().nullable(),
});

const storedSchema = z.object({ items: z.array(itemSchema) });
const legacySchema = z.object({ symbols: z.array(z.string().min(1)) });
const fileSchema = z.union([storedSchema, legacySchema]).transform((value) => {
  if ("items" in value) return { items: value.items };
  const items: WatchlistItem[] = [];
  for (const symbol of value.symbols) {
    const item = itemFromIdentifier(symbol);
    if (item !== undefined) items.push(item);
  }
  return { items };
});

export interface WatchlistItem {
  readonly eventTicker: string;
  readonly instrumentSymbol: string | null;
  readonly savedAt: string | null;
  readonly savedYesCents: number | null;
}

export interface WatchlistWrite {
  readonly symbol?: string;
  readonly eventTicker?: string;
  readonly contract?: string;
  readonly instrumentSymbol?: string;
  readonly yesCents?: number | null;
}

export interface Watchlist {
  readonly list: () => Promise<readonly string[]>;
  readonly items: () => Promise<readonly WatchlistItem[]>;
  readonly add: (input: string | WatchlistWrite) => Promise<readonly WatchlistItem[]>;
  readonly remove: (input: string | WatchlistWrite) => Promise<readonly WatchlistItem[]>;
  readonly flush: () => Promise<void>;
}

export function itemFromIdentifier(symbol: string): WatchlistItem | undefined {
  const trimmed = symbol.trim();
  if (trimmed === "") return undefined;
  const parsed = parseInstrumentSymbol(trimmed);
  if (parsed === undefined) {
    return { eventTicker: trimmed, instrumentSymbol: null, savedAt: null, savedYesCents: null };
  }
  return { eventTicker: parsed.eventTicker, instrumentSymbol: trimmed, savedAt: null, savedYesCents: null };
}

export function resolveWatchlistWrite(input: string | WatchlistWrite): WatchlistItem | undefined {
  const body: WatchlistWrite = typeof input === "string" ? { symbol: input } : input;
  const contract = body.contract?.trim() || body.instrumentSymbol?.trim() || undefined;
  const symbol = body.symbol?.trim() || undefined;
  const eventTicker = body.eventTicker?.trim() || undefined;
  const fromContract = contract === undefined ? undefined : parseInstrumentSymbol(contract);
  const fromSymbol = symbol === undefined ? undefined : parseInstrumentSymbol(symbol);
  const ticker = eventTicker ?? fromContract?.eventTicker ?? fromSymbol?.eventTicker ?? (fromSymbol === undefined ? symbol : undefined);
  if (ticker === undefined || ticker === "") return undefined;
  const instrument = contract ?? (fromSymbol === undefined ? null : symbol ?? null);
  return {
    eventTicker: ticker,
    instrumentSymbol: instrument,
    savedAt: null,
    savedYesCents: body.yesCents === undefined ? null : body.yesCents,
  };
}

export function watchlistIdentifiers(items: readonly WatchlistItem[]): string[] {
  const keys: string[] = [];
  for (const item of items) {
    keys.push(item.eventTicker);
    if (item.instrumentSymbol !== null && item.instrumentSymbol !== item.eventTicker) keys.push(item.instrumentSymbol);
  }
  return keys;
}

export function matchesWatchlistItem(item: WatchlistItem, key: WatchlistItem): boolean {
  if (item.eventTicker === key.eventTicker) return true;
  if (key.instrumentSymbol !== null && (item.instrumentSymbol === key.instrumentSymbol || item.eventTicker === key.instrumentSymbol)) return true;
  if (item.instrumentSymbol !== null && (item.instrumentSymbol === key.eventTicker || item.instrumentSymbol === key.instrumentSymbol)) return true;
  return false;
}

export function openWatchlist(options: { readonly fs: FileSystem; readonly path: string; readonly now?: () => Date }): Watchlist {
  const store = createJsonStore({ fs: options.fs, path: options.path, schema: fileSchema, empty: () => ({ items: [] }) });
  const queue = createSerialQueue();
  const now = options.now ?? (() => new Date());

  async function loadItems(): Promise<WatchlistItem[]> {
    return [...(await store.load()).items];
  }

  async function write(items: readonly WatchlistItem[]): Promise<readonly WatchlistItem[]> {
    const unique: WatchlistItem[] = [];
    for (const item of items) {
      if (unique.some((existing) => matchesWatchlistItem(existing, item))) continue;
      unique.push(item);
    }
    await store.save({ items: unique });
    return unique;
  }

  return {
    async list() {
      return watchlistIdentifiers(await loadItems());
    },
    async items() {
      return loadItems();
    },
    add(input) {
      return queue.run(async () => {
        const resolved = resolveWatchlistWrite(input);
        if (resolved === undefined) return loadItems();
        const current = await loadItems();
        if (current.some((item) => matchesWatchlistItem(item, resolved))) return current;
        return write([
          ...current,
          {
            eventTicker: resolved.eventTicker,
            instrumentSymbol: resolved.instrumentSymbol,
            savedAt: now().toISOString(),
            savedYesCents: resolved.savedYesCents,
          },
        ]);
      });
    },
    remove(input) {
      return queue.run(async () => {
        const resolved = resolveWatchlistWrite(input);
        if (resolved === undefined) return loadItems();
        return write((await loadItems()).filter((item) => !matchesWatchlistItem(item, resolved)));
      });
    },
    async flush() {
      await queue.flush();
      await store.flush();
    },
  };
}

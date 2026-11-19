import { z } from "zod";
import { StoreUnavailableError, createJsonStore } from "@/features/storage";
import type { FileSystem } from "@/features/storage";

export const MAX_WATCHED_SYMBOLS = 24;
export const MAX_POINTS_PER_SYMBOL = 2880;
export const MIN_POINT_GAP_MS = 10_000;

export interface PriceSnapshot {
  readonly atMs: number;
  readonly yesCents: number;
  readonly bidCents: number | null;
  readonly askCents: number | null;
}

export interface HistoryStore {
  readonly watch: (symbol: string) => void;
  readonly record: (symbol: string, snapshot: PriceSnapshot) => void;
  readonly series: (symbol: string) => readonly PriceSnapshot[];
  readonly watched: () => readonly string[];
  readonly flush: () => Promise<void>;
}

export interface HistoryLimits {
  readonly maxWatched: number;
  readonly maxPoints: number;
  readonly minGapMs: number;
}

const DEFAULT_LIMITS: HistoryLimits = { maxWatched: MAX_WATCHED_SYMBOLS, maxPoints: MAX_POINTS_PER_SYMBOL, minGapMs: MIN_POINT_GAP_MS };

const nullableCents = z.number().min(0).max(100).nullable();
const pointSchema = z.tuple([z.number().int().nonnegative(), z.number().min(0).max(100), nullableCents, nullableCents]);

const fileSchema = z.object({
  version: z.literal(1),
  watched: z.array(z.string()),
  points: z.record(z.string(), z.array(pointSchema)),
});

type HistoryFile = z.output<typeof fileSchema>;

const emptyFile = (): HistoryFile => ({ version: 1, watched: [], points: {} });

function toSnapshot([atMs, yesCents, bidCents, askCents]: z.output<typeof pointSchema>): PriceSnapshot {
  return { atMs, yesCents, bidCents, askCents };
}

export interface OpenHistoryOptions {
  readonly fs: FileSystem;
  readonly path: string;
  readonly limits?: Partial<HistoryLimits>;
}

function buildHistoryStore(loaded: HistoryFile, persist: (file: HistoryFile) => Promise<void>, overrides: Partial<HistoryLimits> | undefined): HistoryStore {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const watchedOrder: string[] = loaded.watched.slice(-limits.maxWatched);
  const points = new Map<string, PriceSnapshot[]>(
    watchedOrder.map((symbol) => [symbol, (loaded.points[symbol] ?? []).map(toSnapshot).slice(-limits.maxPoints)]),
  );
  let dirty = false;

  function watch(symbol: string): void {
    const index = watchedOrder.indexOf(symbol);
    if (index >= 0 && index === watchedOrder.length - 1) return;
    if (index >= 0) watchedOrder.splice(index, 1);
    watchedOrder.push(symbol);
    if (!points.has(symbol)) points.set(symbol, []);
    for (const evicted of watchedOrder.splice(0, Math.max(0, watchedOrder.length - limits.maxWatched))) points.delete(evicted);
    dirty = true;
  }

  return {
    watch,
    record(symbol, snapshot) {
      const series = points.get(symbol);
      if (series === undefined) return;
      const last = series.at(-1);
      if (last !== undefined && snapshot.atMs - last.atMs < limits.minGapMs) return;
      series.push(snapshot);
      points.set(symbol, series.length > limits.maxPoints ? series.slice(-limits.maxPoints) : series);
      dirty = true;
    },
    series: (symbol) => [...(points.get(symbol) ?? [])],
    watched: () => [...watchedOrder],
    async flush() {
      if (!dirty) return;
      dirty = false;
      const snapshot: HistoryFile = {
        version: 1,
        watched: [...watchedOrder],
        points: Object.fromEntries(
          watchedOrder.map((symbol) => [
            symbol,
            (points.get(symbol) ?? []).map((point): z.output<typeof pointSchema> => [point.atMs, point.yesCents, point.bidCents, point.askCents]),
          ]),
        ),
      };
      try {
        await persist(snapshot);
      } catch (error) {
        dirty = true;
        throw error;
      }
    },
  };
}

export async function openHistoryStore(options: OpenHistoryOptions): Promise<HistoryStore> {
  const file = createJsonStore({ fs: options.fs, path: options.path, schema: fileSchema, empty: emptyFile });
  const loaded = await file.load().catch((error: unknown) => {
    if (error instanceof StoreUnavailableError) return emptyFile();
    throw error;
  });
  return buildHistoryStore(loaded, file.save, options.limits);
}

export function createMemoryHistory(limits?: Partial<HistoryLimits>): HistoryStore {
  return buildHistoryStore(emptyFile(), () => Promise.resolve(), limits);
}

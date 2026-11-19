import { z } from "zod";
import { createJsonStore } from "@/features/storage";
import type { FileSystem } from "@/features/storage";

const schema = z.object({ symbols: z.array(z.string().min(1)) });

export interface Watchlist {
  readonly list: () => Promise<readonly string[]>;
  readonly add: (symbol: string) => Promise<readonly string[]>;
  readonly remove: (symbol: string) => Promise<readonly string[]>;
}

export function openWatchlist(options: { readonly fs: FileSystem; readonly path: string }): Watchlist {
  const store = createJsonStore({ fs: options.fs, path: options.path, schema, empty: () => ({ symbols: [] }) });

  async function write(symbols: readonly string[]): Promise<readonly string[]> {
    const unique = [...new Set(symbols)];
    await store.save({ symbols: unique });
    return unique;
  }

  return {
    async list() {
      return (await store.load()).symbols;
    },
    async add(symbol) {
      const current = (await store.load()).symbols;
      if (current.includes(symbol)) return current;
      return write([...current, symbol]);
    },
    async remove(symbol) {
      return write((await store.load()).symbols.filter((item) => item !== symbol));
    },
  };
}

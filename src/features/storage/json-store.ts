import type { z } from "zod";
import type { FileSystem } from "./file-system";

export interface JsonStore<T> {
  readonly load: () => Promise<T>;
  readonly save: (value: T) => Promise<void>;
}

export interface JsonStoreOptions<S extends z.ZodType> {
  readonly fs: FileSystem;
  readonly path: string;
  readonly schema: S;
  readonly empty: () => z.output<S>;
}

export function createJsonStore<S extends z.ZodType>(options: JsonStoreOptions<S>): JsonStore<z.output<S>> {
  const { fs, path, schema, empty } = options;
  let inFlight: Promise<void> = Promise.resolve();
  let queued: { readonly value: z.output<S> } | undefined;
  let queuedDone: Promise<void> | undefined;

  function drain(): Promise<void> {
    const next = queued;
    queued = undefined;
    queuedDone = undefined;
    if (next === undefined) return Promise.resolve();
    return fs.writeTextAtomic(path, JSON.stringify(next.value));
  }

  return {
    async load() {
      let text: string | undefined;
      try {
        text = await fs.readText(path);
      } catch {
        return empty();
      }
      if (text === undefined) return empty();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return empty();
      }
      const parsed = schema.safeParse(json);
      return parsed.success ? parsed.data : empty();
    },
    save(value) {
      queued = { value };
      if (queuedDone === undefined) {
        queuedDone = inFlight.catch(() => undefined).then(drain);
        inFlight = queuedDone;
      }
      return queuedDone;
    },
  };
}

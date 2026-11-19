import type { z } from "zod";
import type { FileSystem } from "./file-system";

export type StoreProblem = "unreadable" | "corrupt";

export class StoreUnavailableError extends Error {
  readonly problem: StoreProblem;
  readonly path: string;
  readonly preservedAt: string | undefined;

  constructor(problem: StoreProblem, path: string, preservedAt?: string) {
    super(
      problem === "unreadable"
        ? `${path} could not be read`
        : `${path} is corrupt${preservedAt === undefined ? "" : ` and was preserved as ${preservedAt}`}`,
    );
    this.name = "StoreUnavailableError";
    this.problem = problem;
    this.path = path;
    this.preservedAt = preservedAt;
  }
}

export interface JsonStore<T> {
  readonly load: () => Promise<T>;
  readonly save: (value: T) => Promise<void>;
}

export interface JsonStoreOptions<S extends z.ZodType> {
  readonly fs: FileSystem;
  readonly path: string;
  readonly schema: S;
  readonly empty: () => z.output<S>;
  readonly nowMs?: () => number;
}

export function createJsonStore<S extends z.ZodType>(options: JsonStoreOptions<S>): JsonStore<z.output<S>> {
  const { fs, path, schema, empty } = options;
  const nowMs = options.nowMs ?? Date.now;
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

  async function quarantine(): Promise<StoreUnavailableError> {
    const preservedAt = `${path}.corrupt-${String(nowMs())}`;
    try {
      await fs.preserveCopy(path, preservedAt);
    } catch {
      return new StoreUnavailableError("corrupt", path);
    }
    return new StoreUnavailableError("corrupt", path, preservedAt);
  }

  return {
    async load() {
      let text: string | undefined;
      try {
        text = await fs.readText(path);
      } catch {
        throw new StoreUnavailableError("unreadable", path);
      }
      if (text === undefined) return empty();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw await quarantine();
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) throw await quarantine();
      return parsed.data;
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

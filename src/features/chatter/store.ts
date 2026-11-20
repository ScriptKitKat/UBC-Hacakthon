import { z } from "zod";
import { createJsonStore } from "@/features/storage";
import type { FileSystem } from "@/features/storage";
import { researchPostContextSchema } from "@/shared";

const EVENT_LIMIT = 500;

const storedChatterSchema = z.object({
  eventTicker: z.string().min(1),
  fetchedAtMs: z.number(),
  posts: z.array(researchPostContextSchema),
});

const fileSchema = z.object({ version: z.literal(1), events: z.array(storedChatterSchema) });

export type StoredChatter = z.output<typeof storedChatterSchema>;

export interface ChatterPersistence {
  readonly initialChatter: readonly StoredChatter[];
  readonly saveChatter: (events: readonly StoredChatter[]) => Promise<void>;
}

export function capChatter(events: readonly StoredChatter[]): StoredChatter[] {
  return [...events].sort((left, right) => right.fetchedAtMs - left.fetchedAtMs).slice(0, EVENT_LIMIT);
}

export async function openChatterStore(options: { readonly fs: FileSystem; readonly path: string }): Promise<ChatterPersistence> {
  const file = createJsonStore({ fs: options.fs, path: options.path, schema: fileSchema, empty: () => ({ version: 1 as const, events: [] }) });
  const loaded = await file.load();
  return {
    initialChatter: capChatter(loaded.events),
    saveChatter: (events) => file.save({ version: 1, events: capChatter(events) }),
  };
}

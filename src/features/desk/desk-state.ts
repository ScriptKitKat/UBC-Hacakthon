import { z } from "zod";
import { createJsonStore } from "@/features/storage";
import type { FileSystem } from "@/features/storage";

const schema = z.object({ killSwitch: z.boolean() }).strict();

export interface DeskStateStore {
  readonly killSwitch: boolean;
  readonly setKillSwitch: (on: boolean) => Promise<void>;
}

export async function openDeskState(options: { readonly fs: FileSystem; readonly path: string }): Promise<DeskStateStore> {
  const store = createJsonStore({ ...options, schema, empty: () => ({ killSwitch: false }) });
  const state = await store.load();
  return {
    killSwitch: state.killSwitch,
    setKillSwitch: (on) => store.save({ killSwitch: on }),
  };
}

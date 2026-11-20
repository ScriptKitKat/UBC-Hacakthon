import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@/features/storage";
import { openDeskState } from "./desk-state";

it("restores the kill switch when desk state is reopened", async () => {
  const fs = createMemoryFileSystem();
  const first = await openDeskState({ fs, path: "desk-state.json" });
  expect(first.killSwitch).toBe(false);
  await first.setKillSwitch(true);
  const rebuilt = await openDeskState({ fs, path: "desk-state.json" });
  expect(rebuilt.killSwitch).toBe(true);
});

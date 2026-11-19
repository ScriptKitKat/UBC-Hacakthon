import { mkdir, open, rename } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { nodeFileSystem } from "./file-system";

vi.mock("node:fs/promises", { spy: true });

it.each([
  [undefined, undefined],
  ["/data", "EIO"],
  ["/", "EIO"],
  ["/data", "EINVAL"],
])("syncs the file before rename and the directory chain after it (%s, %s)", async (failedDirectory, directoryError) => {
  const order: string[] = [];
  const path = "/data/store.json";
  const openMock = vi.mocked(open);
  vi.mocked(mkdir).mockResolvedValue(undefined);
  vi.mocked(rename).mockImplementation(() => {
    order.push("rename");
    return Promise.resolve();
  });
  openMock.mockImplementation((target, flags) => {
    const file = flags === "w";
    if (file) expect(target).toMatch(/^\/data\/store\.json\..*\.tmp$/);
    else expect(["/data", "/"]).toContain(target);
    const handle = {
      writeFile: () => {
        order.push("write");
        return Promise.resolve();
      },
      sync: () => {
        order.push(file ? "sync file" : `sync ${String(target)}`);
        if (!file && target === failedDirectory) return Promise.reject(Object.assign(new Error(directoryError), { code: directoryError }));
        return Promise.resolve();
      },
      close: () => {
        order.push(file ? "close file" : `close ${String(target)}`);
        return Promise.resolve();
      },
    };
    return Promise.resolve(handle as unknown as Awaited<ReturnType<typeof open>>);
  });

  const write = nodeFileSystem.writeTextAtomic(path, "contents");
  if (directoryError) await expect(write).rejects.toThrow(directoryError);
  else await expect(write).resolves.toBeUndefined();
  expect(order).toEqual([
    "write", "sync file", "close file", "rename", "sync /data", "close /data",
    ...(failedDirectory === "/data" ? [] : ["sync /", "close /"]),
  ]);
});

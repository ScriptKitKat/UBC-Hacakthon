import { mkdir, open, rename } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { nodeFileSystem } from "./file-system";

vi.mock("node:fs/promises", { spy: true });

it.each([undefined, "EINVAL", "EISDIR", "EIO"])("syncs the file before rename and the directory after it (%s)", async (directoryError) => {
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
    else expect(target).toBe("/data");
    const handle = {
      writeFile: () => {
        order.push("write");
        return Promise.resolve();
      },
      sync: () => {
        order.push(file ? "sync file" : "sync directory");
        if (!file && directoryError) return Promise.reject(Object.assign(new Error(directoryError), { code: directoryError }));
        return Promise.resolve();
      },
      close: () => {
        order.push(file ? "close file" : "close directory");
        return Promise.resolve();
      },
    };
    return Promise.resolve(handle as unknown as Awaited<ReturnType<typeof open>>);
  });

  const write = nodeFileSystem.writeTextAtomic(path, "contents");
  if (directoryError === "EIO") await expect(write).rejects.toThrow("EIO");
  else await expect(write).resolves.toBeUndefined();
  expect(order).toEqual(["write", "sync file", "close file", "rename", "sync directory", "close directory"]);
});

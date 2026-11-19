import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { resolveDataDirectory } from "./data-dir";
import { createMemoryFileSystem, nodeFileSystem } from "./file-system";
import { StoreUnavailableError, createJsonStore } from "./json-store";
import { createSerialQueue } from "./serial-queue";

const schema = z.object({ items: z.array(z.number()) });
const empty = () => ({ items: [] as number[] });

describe("createJsonStore with a memory file system", () => {
  it("returns the empty value when the file is missing", async () => {
    const store = createJsonStore({ fs: createMemoryFileSystem(), path: "/d/a.json", schema, empty });
    expect(await store.load()).toEqual({ items: [] });
  });

  it("round-trips saved values", async () => {
    const fs = createMemoryFileSystem();
    const store = createJsonStore({ fs, path: "/d/a.json", schema, empty });
    await store.save({ items: [1, 2] });
    expect(await createJsonStore({ fs, path: "/d/a.json", schema, empty }).load()).toEqual({ items: [1, 2] });
  });

  it("refuses a corrupted file, keeps a timestamped copy, and leaves the original so every start refuses until it is fixed", async () => {
    const fs = createMemoryFileSystem({ "/d/a.json": "{not json" });
    const store = createJsonStore({ fs, path: "/d/a.json", schema, empty, nowMs: () => 42 });
    await expect(store.load()).rejects.toMatchObject({ name: "StoreUnavailableError", problem: "corrupt", preservedAt: "/d/a.json.corrupt-42" });
    expect(fs.files.get("/d/a.json.corrupt-42")).toBe("{not json");
    expect(fs.files.get("/d/a.json")).toBe("{not json");
    await expect(store.load()).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it("refuses a file that fails schema validation and preserves it", async () => {
    const contents = JSON.stringify({ items: ["x"] });
    const fs = createMemoryFileSystem({ "/d/a.json": contents });
    await expect(createJsonStore({ fs, path: "/d/a.json", schema, empty, nowMs: () => 7 }).load()).rejects.toBeInstanceOf(StoreUnavailableError);
    expect(fs.files.get("/d/a.json.corrupt-7")).toBe(contents);
  });

  it("refuses to start empty when reading throws", async () => {
    const fs = { ...createMemoryFileSystem(), readText: () => Promise.reject(new Error("EIO")) };
    await expect(createJsonStore({ fs, path: "/d/a.json", schema, empty }).load()).rejects.toMatchObject({ problem: "unreadable" });
  });

  it("still refuses when the corrupt file cannot be moved aside", async () => {
    const memory = createMemoryFileSystem({ "/d/a.json": "garbage" });
    const fs = { ...memory, preserveCopy: () => Promise.reject(new Error("EPERM")) };
    await expect(createJsonStore({ fs, path: "/d/a.json", schema, empty }).load()).rejects.toMatchObject({ problem: "corrupt", preservedAt: undefined });
  });

  it("coalesces saves issued while a write is in flight and keeps the latest", async () => {
    const fs = createMemoryFileSystem();
    const store = createJsonStore({ fs, path: "/d/a.json", schema, empty });
    await Promise.all([store.save({ items: [1] }), store.save({ items: [2] }), store.save({ items: [3] })]);
    expect(fs.writes).toHaveLength(1);
    expect(await store.load()).toEqual({ items: [3] });
  });

  it("writes strictly in order across batches", async () => {
    const order: string[] = [];
    const memory = createMemoryFileSystem();
    const fs = {
      ...memory,
      writeTextAtomic: async (path: string, contents: string) => {
        await new Promise((resolve) => setTimeout(resolve, contents.includes("1") ? 20 : 0));
        order.push(contents);
        await memory.writeTextAtomic(path, contents);
      },
    };
    const store = createJsonStore({ fs, path: "/d/a.json", schema, empty });
    const first = store.save({ items: [1] });
    await new Promise((resolve) => setTimeout(resolve, 1));
    const second = store.save({ items: [2] });
    await Promise.all([first, second]);
    expect(order).toEqual([JSON.stringify({ items: [1] }), JSON.stringify({ items: [2] })]);
    expect(memory.files.get("/d/a.json")).toBe(JSON.stringify({ items: [2] }));
  });

  it("surfaces a failed write and recovers on the next save", async () => {
    const memory = createMemoryFileSystem();
    let failing = true;
    const fs = {
      ...memory,
      writeTextAtomic: (path: string, contents: string) =>
        failing ? Promise.reject(new Error("ENOSPC")) : memory.writeTextAtomic(path, contents),
    };
    const store = createJsonStore({ fs, path: "/d/a.json", schema, empty });
    await expect(store.save({ items: [1] })).rejects.toThrow("ENOSPC");
    failing = false;
    await store.save({ items: [2] });
    expect(await store.load()).toEqual({ items: [2] });
  });
});

describe("nodeFileSystem", () => {
  let directory = "";
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "ntd-storage-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("reads undefined for a missing file", async () => {
    expect(await nodeFileSystem.readText(join(directory, "nope.json"))).toBeUndefined();
  });

  it("creates nested directories and leaves no temporary files", async () => {
    const path = join(directory, "deep", "er", "a.json");
    await nodeFileSystem.writeTextAtomic(path, "one");
    await nodeFileSystem.writeTextAtomic(path, "two");
    expect(await readFile(path, "utf8")).toBe("two");
    expect(await readdir(join(directory, "deep", "er"))).toEqual(["a.json"]);
  });

  it("keeps the previous contents when the write cannot complete", async () => {
    const path = join(directory, "a.json");
    await nodeFileSystem.writeTextAtomic(path, "good");
    await expect(nodeFileSystem.writeTextAtomic(join(path, "child.json"), "x")).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("good");
  });

  it("survives a restart through the json store and, for a corrupted file on disk, refuses on every start while keeping a copy", async () => {
    const path = join(directory, "store.json");
    const first = createJsonStore({ fs: nodeFileSystem, path, schema, empty });
    await first.save({ items: [7, 8] });
    expect(await createJsonStore({ fs: nodeFileSystem, path, schema, empty }).load()).toEqual({ items: [7, 8] });
    await writeFile(path, "garbage", "utf8");
    const restarted = createJsonStore({ fs: nodeFileSystem, path, schema, empty, nowMs: () => 99 });
    await expect(restarted.load()).rejects.toBeInstanceOf(StoreUnavailableError);
    expect(await readFile(`${path}.corrupt-99`, "utf8")).toBe("garbage");
    await expect(createJsonStore({ fs: nodeFileSystem, path, schema, empty }).load()).rejects.toBeInstanceOf(StoreUnavailableError);
    expect(await readFile(path, "utf8")).toBe("garbage");
  });
});

describe("createSerialQueue", () => {
  it("runs tasks one at a time in submission order, even when one fails", async () => {
    const queue = createSerialQueue();
    const order: string[] = [];
    const slow = queue.run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      order.push("slow");
      throw new Error("boom");
    });
    const fast = queue.run(() => {
      order.push("fast");
      return Promise.resolve("ok");
    });
    await expect(slow).rejects.toThrow("boom");
    expect(await fast).toBe("ok");
    expect(order).toEqual(["slow", "fast"]);
  });
});

describe("resolveDataDirectory", () => {
  it("defaults to .data under the working directory", () => {
    expect(resolveDataDirectory({}, "/app")).toBe("/app/.data");
  });

  it("uses DESK_DATA_DIR when set", () => {
    expect(resolveDataDirectory({ DESK_DATA_DIR: "/var/desk" }, "/app")).toBe("/var/desk");
  });

  it("ignores a blank DESK_DATA_DIR", () => {
    expect(resolveDataDirectory({ DESK_DATA_DIR: "  " }, "/app")).toBe("/app/.data");
  });
});

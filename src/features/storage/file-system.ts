import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface FileSystem {
  readonly readText: (path: string) => Promise<string | undefined>;
  readonly writeTextAtomic: (path: string, contents: string) => Promise<void>;
  readonly preserveCopy: (path: string, preservedPath: string) => Promise<void>;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

let tempCounter = 0;

export const nodeFileSystem: FileSystem = {
  async readText(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  },
  async writeTextAtomic(path, contents) {
    await mkdir(dirname(path), { recursive: true });
    tempCounter += 1;
    const temporary = `${path}.${String(process.pid)}.${String(tempCounter)}.tmp`;
    try {
      await writeFile(temporary, contents, "utf8");
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  },
  async preserveCopy(path, preservedPath) {
    await copyFile(path, preservedPath);
  },
};

export interface MemoryFileSystem extends FileSystem {
  readonly files: Map<string, string>;
  readonly writes: string[];
}

export function createMemoryFileSystem(initial: Readonly<Record<string, string>> = {}): MemoryFileSystem {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    files,
    writes,
    readText: (path) => Promise.resolve(files.get(path)),
    writeTextAtomic: (path, contents) => {
      files.set(path, contents);
      writes.push(path);
      return Promise.resolve();
    },
    preserveCopy: (path, preservedPath) => {
      const contents = files.get(path);
      if (contents !== undefined) files.set(preservedPath, contents);
      return Promise.resolve();
    },
  };
}

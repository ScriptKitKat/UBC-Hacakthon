import { join } from "node:path";

export const DEFAULT_DATA_DIRECTORY = ".data";

export function resolveDataDirectory(env: Readonly<Record<string, string | undefined>>, cwd: string): string {
  const configured = env["DESK_DATA_DIR"]?.trim();
  return configured === undefined || configured === "" ? join(cwd, DEFAULT_DATA_DIRECTORY) : configured;
}

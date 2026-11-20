import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { z } from "zod";

const secretKey = z.array(z.number().int().min(0).max(255)).length(64);

function parseKeypair(serialized: string): Keypair {
  const bytes = secretKey.parse(JSON.parse(serialized));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

export async function loadKeypair(path: string): Promise<Keypair> {
  try {
    const expandedPath = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
    return parseKeypair(await readFile(expandedPath, "utf8"));
  } catch {
    throw new Error("Unable to load Solana keypair");
  }
}

export function loadKeypairFromJson(serialized: string): Keypair {
  try {
    return parseKeypair(serialized);
  } catch {
    throw new Error("Unable to load Solana keypair");
  }
}

import { randomUUID } from "node:crypto";
import { getDesk } from "@/features/desk";
import { createXBot } from "./bot";
import type { XBot } from "./bot";
import { loadXConfig } from "./config";
import { createFakeXClient } from "./fake-client";
import { createLiveXClient } from "./live-client";

const DEFAULT_BOT_HANDLE = "@newstotradedesk";

export type XBotAccess =
  | { readonly ok: true; readonly bot: XBot }
  | { readonly ok: false; readonly issues: readonly string[] };

async function buildXBot(env: Readonly<Record<string, string | undefined>>): Promise<XBotAccess> {
  const access = await getDesk();
  if (!access.ok) return access;
  const config = loadXConfig(env);
  const client =
    config.mode === "live"
      ? createLiveXClient({ credentials: config.credentials, fetch, userId: config.userId })
      : createFakeXClient();
  const bot = createXBot({
    desk: access.desk,
    client,
    now: () => new Date(),
    idGen: randomUUID,
    botHandle: env.X_BOT_HANDLE?.trim() || DEFAULT_BOT_HANDLE,
    configuredMissing: config.mode === "fake" ? config.missing : [],
  });
  return { ok: true, bot };
}

const xbotKey: unique symbol = Symbol.for("news-to-trade-desk.xbot");
const holder = globalThis as typeof globalThis & { [xbotKey]?: Promise<XBotAccess> };

export function getXBot(): Promise<XBotAccess> {
  const existing = holder[xbotKey];
  if (existing) return existing;
  const created = buildXBot(process.env);
  holder[xbotKey] = created;
  return created;
}

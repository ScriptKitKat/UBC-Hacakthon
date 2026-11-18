export interface XCredentials {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly accessToken: string;
  readonly accessSecret: string;
  readonly bearerToken: string;
}

export type XConfig =
  | { readonly mode: "live"; readonly credentials: XCredentials; readonly userId: string }
  | { readonly mode: "fake"; readonly missing: readonly string[] };

const REQUIRED = [
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_SECRET",
  "X_BEARER_TOKEN",
  "X_BOT_USER_ID",
] as const;

export function loadXConfig(env: Readonly<Record<string, string | undefined>>): XConfig {
  const value = (name: (typeof REQUIRED)[number]): string => env[name]?.trim() ?? "";
  const missing = REQUIRED.filter((name) => value(name) === "");
  if (missing.length > 0) return { mode: "fake", missing };
  return {
    mode: "live",
    userId: value("X_BOT_USER_ID"),
    credentials: {
      apiKey: value("X_API_KEY"),
      apiSecret: value("X_API_SECRET"),
      accessToken: value("X_ACCESS_TOKEN"),
      accessSecret: value("X_ACCESS_SECRET"),
      bearerToken: value("X_BEARER_TOKEN"),
    },
  };
}

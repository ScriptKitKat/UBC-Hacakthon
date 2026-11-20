export interface XFeedSettings {
  readonly bearerToken: string | undefined;
}

export function loadXFeedSettings(env: Readonly<Record<string, string | undefined>>): XFeedSettings {
  const bearerToken = env.X_BEARER_TOKEN?.trim();
  return { bearerToken: bearerToken === "" ? undefined : bearerToken };
}

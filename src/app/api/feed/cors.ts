const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/u;

export function configuredOrigins(env: Readonly<Record<string, string | undefined>>): readonly string[] | undefined {
  const origins = (env.FEED_EXTENSION_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter((origin) => origin !== "");
  return origins.length > 0 ? origins : undefined;
}

export function isAllowedOrigin(origin: string, env: Readonly<Record<string, string | undefined>>): boolean {
  const configured = configuredOrigins(env);
  return configured ? configured.includes(origin) : EXTENSION_ORIGIN.test(origin);
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

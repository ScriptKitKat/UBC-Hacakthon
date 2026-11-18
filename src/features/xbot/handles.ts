const HANDLE = /^@?[a-zA-Z0-9_]{1,15}$/u;

export function isHandle(raw: string): boolean {
  return HANDLE.test(raw);
}

export function normalizeHandle(raw: string): string {
  return `@${raw.trim().replace(/^@+/u, "").toLowerCase()}`;
}

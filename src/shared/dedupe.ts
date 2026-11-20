export function uniqueByKey<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function mergeByKeyKeepNewest<T>(existing: readonly T[], incoming: readonly T[], keyOf: (item: T) => string): T[] {
  const indexByKey = new Map<string, number>();
  const out: T[] = [];
  for (const item of existing) {
    const key = keyOf(item);
    const prior = indexByKey.get(key);
    if (prior !== undefined) {
      out[prior] = item;
      continue;
    }
    indexByKey.set(key, out.length);
    out.push(item);
  }
  for (const item of incoming) {
    const key = keyOf(item);
    const index = indexByKey.get(key);
    if (index === undefined) {
      indexByKey.set(key, out.length);
      out.push(item);
      continue;
    }
    out[index] = item;
  }
  return out;
}

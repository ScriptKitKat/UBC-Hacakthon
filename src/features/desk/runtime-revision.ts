export function isStale(loadedRev: number, ownWrites: number, currentRev: number): boolean {
  return currentRev > loadedRev + ownWrites;
}

export async function waitForIdleOrTimeout(idle: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    idle.then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => { resolve(true); }, timeoutMs);
      timer.unref();
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  return timedOut;
}

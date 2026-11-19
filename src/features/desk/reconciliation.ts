const RECONCILIATION_INTERVAL_MS = 30_000;

export function singleReconciliation<T>(run: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | undefined;
  return () => {
    running ??= Promise.resolve().then(run).finally(() => { running = undefined; });
    return running;
  };
}

export function startReconciliation(run: () => Promise<unknown>): ReturnType<typeof setInterval> {
  const tick = singleReconciliation(run);
  const timer = setInterval(() => { void tick().catch(() => undefined); }, RECONCILIATION_INTERVAL_MS);
  timer.unref();
  return timer;
}

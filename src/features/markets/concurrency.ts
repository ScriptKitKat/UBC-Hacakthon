export class ConcurrencyBusyError extends Error {
  constructor() {
    super("concurrency queue is full");
  }
}

export type ConcurrencyLimiter = <T>(task: () => Promise<T>) => Promise<T>;

export function createConcurrencyLimiter(maxInFlight: number, maxQueued: number): ConcurrencyLimiter {
  let inFlight = 0;
  const waiting: Array<() => void> = [];

  return async (task) => {
    if (inFlight >= maxInFlight) {
      if (waiting.length >= maxQueued) throw new ConcurrencyBusyError();
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
    }
    inFlight += 1;
    try {
      return await task();
    } finally {
      inFlight -= 1;
      const next = waiting.shift();
      next?.();
    }
  };
}

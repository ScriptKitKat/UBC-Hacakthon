export interface SerialQueue {
  readonly run: <T>(task: () => Promise<T>) => Promise<T>;
  readonly flush: () => Promise<void>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run(task) {
      const result = tail.then(task, task);
      tail = result.catch(() => undefined);
      return result;
    },
    async flush() {
      for (;;) {
        const pending = tail;
        await pending;
        if (pending === tail) return;
      }
    },
  };
}

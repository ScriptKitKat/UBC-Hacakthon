export interface Clock {
  readonly nowMs: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export const systemClock: Clock = {
  nowMs: () => Date.now(),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};

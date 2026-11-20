import { createSerialQueue } from "@/features/storage";
import type { AgentCycleOptions, AgentCycleReport, AgentRunnerDeps } from "./runner";
import { runAgentCycle } from "./runner";

export const AGENT_LOOP_INTERVAL_MS = 60_000;

const queues = new WeakMap<AgentRunnerDeps, ReturnType<typeof createSerialQueue>>();
export type AgentCycleGuard = (cycle: () => Promise<AgentCycleReport>) => Promise<AgentCycleReport>;

function singleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | undefined;
  return () => {
    running ??= Promise.resolve().then(run).finally(() => { running = undefined; });
    return running;
  };
}

function queueFor(deps: AgentRunnerDeps): ReturnType<typeof createSerialQueue> {
  const existing = queues.get(deps);
  if (existing !== undefined) return existing;
  const queue = createSerialQueue();
  queues.set(deps, queue);
  return queue;
}

export function startAgentLoop(deps: AgentRunnerDeps, guard: AgentCycleGuard = (cycle) => cycle()): ReturnType<typeof setInterval> {
  const queue = queueFor(deps);
  const tick = singleFlight(() => queue.run(() => guard(() => runAgentCycle(deps))));
  const timer = setInterval(() => { void tick().catch(() => undefined); }, AGENT_LOOP_INTERVAL_MS);
  timer.unref();
  return timer;
}

export function agentCycle(deps: AgentRunnerDeps): (agentId?: string, options?: AgentCycleOptions) => Promise<AgentCycleReport> {
  const queue = queueFor(deps);
  const tick = singleFlight(() => queue.run(() => runAgentCycle(deps)));
  return (agentId, options = {}) => agentId === undefined && options.review !== true
    ? tick()
    : queue.run(() => runAgentCycle(deps, agentId, options));
}

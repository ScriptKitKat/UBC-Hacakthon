import type { AgentCycleReport, AgentRunnerDeps } from "./runner";
import { runAgentCycle } from "./runner";

export const AGENT_LOOP_INTERVAL_MS = 60_000;

function singleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | undefined;
  return () => {
    running ??= Promise.resolve().then(run).finally(() => { running = undefined; });
    return running;
  };
}

export function startAgentLoop(deps: AgentRunnerDeps): ReturnType<typeof setInterval> {
  const tick = singleFlight(() => runAgentCycle(deps));
  const timer = setInterval(() => { void tick().catch(() => undefined); }, AGENT_LOOP_INTERVAL_MS);
  timer.unref();
  return timer;
}

export function agentCycle(deps: AgentRunnerDeps): (agentId?: string) => Promise<AgentCycleReport> {
  const tick = singleFlight(() => runAgentCycle(deps));
  return (agentId) => agentId === undefined ? tick() : runAgentCycle(deps, agentId);
}

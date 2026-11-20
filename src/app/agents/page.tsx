import { AgentsPage } from "../_agents/agents-page";
import { Shell } from "../_shell/shell";

export const dynamic = "force-dynamic";

export default async function AgentsRoute({
  searchParams,
}: {
  readonly searchParams?: Promise<{ readonly agent?: string }>;
}) {
  const params = searchParams === undefined ? {} : await searchParams;
  const initialAgentId = params.agent?.trim() ? params.agent.trim() : null;
  return (
    <Shell>
      <AgentsPage key={initialAgentId ?? "default"} initialAgentId={initialAgentId} />
    </Shell>
  );
}

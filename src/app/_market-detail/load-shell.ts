import { getHomeServices } from "@/features/desk";
import { parseInstrumentSymbol } from "@/features/markets";
import { isProTimeframe } from "@/shared";
import type { ProShell, ProTimeframe } from "@/shared";

export async function loadProShell(symbol: string, timeframe?: ProTimeframe): Promise<ProShell | undefined> {
  if (!parseInstrumentSymbol(symbol)) return undefined;
  if (timeframe !== undefined && !isProTimeframe(timeframe)) return undefined;
  const access = await getHomeServices();
  if (!access.ok) return undefined;
  const result = await access.marketPro.shell(symbol, timeframe);
  return result.kind === "ok" ? result.shell : undefined;
}

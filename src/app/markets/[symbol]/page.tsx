import { Shell } from "../../_shell/shell";
import { MarketDetail } from "../../_market-detail/market-detail";
import { loadProShell } from "../../_market-detail/load-shell";
import type { ViewMode } from "../../_research/use-view-mode";
import { selectedResearchSymbol } from "../research-symbol";

export const dynamic = "force-dynamic";

export default async function MarketPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly symbol: string }>;
  readonly searchParams: Promise<{ readonly contract?: string; readonly view?: string }>;
}) {
  const { symbol } = await params;
  const query = await searchParams;
  const selected = selectedResearchSymbol(decodeURIComponent(symbol), query.contract);
  const decoded = decodeURIComponent(selected);
  const initialView: ViewMode | undefined = query.view === "pro" || query.view === "beginner" ? query.view : undefined;
  const initialPro = initialView === "pro" ? await loadProShell(decoded) : undefined;
  return (
    <Shell {...(initialView === undefined ? {} : { initialView })}>
      <MarketDetail
        symbol={decoded}
        {...(initialView === undefined ? {} : { initialView })}
        {...(initialPro === undefined ? {} : { initialPro })}
      />
    </Shell>
  );
}

import { ResearchPage } from "../../_research/research-page";
import { Shell } from "../../_shell/shell";
import { selectedResearchSymbol } from "../research-symbol";

export const dynamic = "force-dynamic";

export default async function MarketPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly symbol: string }>;
  readonly searchParams: Promise<{ readonly contract?: string }>;
}) {
  const { symbol } = await params;
  const query = await searchParams;
  const selected = selectedResearchSymbol(decodeURIComponent(symbol), query.contract);
  return (
    <Shell>
      <ResearchPage symbol={decodeURIComponent(selected)} />
    </Shell>
  );
}

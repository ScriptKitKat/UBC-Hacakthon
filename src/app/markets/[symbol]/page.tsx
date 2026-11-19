import { ResearchPage } from "../../_research/research-page";
import { Shell } from "../../_shell/shell";

export const dynamic = "force-dynamic";

export default async function MarketPage({ params }: { readonly params: Promise<{ readonly symbol: string }> }) {
  const { symbol } = await params;
  return (
    <Shell>
      <ResearchPage symbol={decodeURIComponent(symbol)} />
    </Shell>
  );
}

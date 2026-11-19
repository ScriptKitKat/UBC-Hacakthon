import { ResearchPage } from "../../_research/research-page";

export const dynamic = "force-dynamic";

export default async function MarketPage({ params }: { readonly params: Promise<{ readonly symbol: string }> }) {
  const { symbol } = await params;
  return (
    <main className="shell">
      <ResearchPage symbol={decodeURIComponent(symbol)} />
    </main>
  );
}

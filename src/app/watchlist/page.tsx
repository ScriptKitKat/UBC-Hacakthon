import { watchlistIdentifiers } from "@/features/catalog";
import { getHomeServices } from "@/features/desk";
import { watchlistCardSchema, watchlistViewSchema } from "@/shared";
import type { WatchlistView } from "@/shared";
import { Shell } from "../_shell/shell";
import { WatchlistPage } from "../_watchlist/watchlist-page";

export const dynamic = "force-dynamic";

async function loadInitial(): Promise<WatchlistView | undefined> {
  const access = await getHomeServices();
  if (!access.ok) return undefined;
  const items = await access.catalog.watchlist.items();
  const cards = watchlistCardSchema.array().parse(await access.catalog.cardsForSaved(items));
  return watchlistViewSchema.parse({ symbols: watchlistIdentifiers(items), items, cards });
}

export default async function WatchlistRoute({
  searchParams,
}: {
  readonly searchParams?: Promise<{ readonly tab?: string; readonly market?: string }>;
}) {
  const initialView = await loadInitial();
  const params = searchParams === undefined ? {} : await searchParams;
  const initialTab = params.tab === "agents" ? "agents" : "markets";
  const initialMarket = params.market?.trim() ? params.market.trim() : null;
  return (
    <Shell>
      {initialView === undefined
        ? <WatchlistPage initialTab={initialTab} initialMarket={initialMarket} />
        : <WatchlistPage initialView={initialView} initialTab={initialTab} initialMarket={initialMarket} />}
    </Shell>
  );
}

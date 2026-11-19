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

export default async function WatchlistRoute() {
  const initialView = await loadInitial();
  return (
    <Shell>
      {initialView === undefined ? <WatchlistPage /> : <WatchlistPage initialView={initialView} />}
    </Shell>
  );
}

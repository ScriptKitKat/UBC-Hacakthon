import { Shell } from "../_shell/shell";
import { WatchlistPage } from "../_watchlist/watchlist-page";

export const dynamic = "force-dynamic";

export default function WatchlistRoute() {
  return (
    <Shell>
      <WatchlistPage />
    </Shell>
  );
}

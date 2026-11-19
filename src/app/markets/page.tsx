import { BrowsePage } from "../_markets/browse-page";
import { Shell } from "../_shell/shell";

export const dynamic = "force-dynamic";

export default function MarketsRoute() {
  return (
    <Shell>
      <BrowsePage />
    </Shell>
  );
}

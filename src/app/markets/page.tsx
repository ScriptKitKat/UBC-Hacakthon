import { getHomeServices } from "@/features/desk";
import type { BrowsePage as BrowsePageData } from "@/shared";
import { BrowsePage } from "../_markets/browse-page";
import { Shell } from "../_shell/shell";

export const dynamic = "force-dynamic";

async function loadInitial(): Promise<BrowsePageData | undefined> {
  const access = await getHomeServices();
  if (!access.ok) return undefined;
  const listed = await access.catalog.browse({ sort: "trending", limit: 24, offset: 0 });
  return listed.ok ? listed.page : undefined;
}

export default async function MarketsRoute() {
  const initialPage = await loadInitial();
  return (
    <Shell>
      {initialPage === undefined ? <BrowsePage /> : <BrowsePage initialPage={initialPage} />}
    </Shell>
  );
}

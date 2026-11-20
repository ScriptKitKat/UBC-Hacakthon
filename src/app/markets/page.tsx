import { getHomeServices } from "@/features/desk";
import type { BrowsePage as BrowsePageData } from "@/shared";
import { BrowsePage } from "../_markets/browse-page";
import { Shell } from "../_shell/shell";

export const dynamic = "force-dynamic";

async function loadInitial(search: string): Promise<BrowsePageData | undefined> {
  const access = await getHomeServices();
  if (!access.ok) return undefined;
  const listed = await access.catalog.browse({ sort: "trending", limit: 24, offset: 0, ...(search === "" ? {} : { search }) });
  return listed.ok ? listed.page : undefined;
}

export default async function MarketsRoute({
  searchParams,
}: {
  readonly searchParams?: Promise<{ readonly search?: string | readonly string[] }>;
}) {
  const params = searchParams === undefined ? {} : await searchParams;
  const requested = params.search;
  const search = (typeof requested === "string" ? requested : requested?.[0] ?? "").trim();
  const initialPage = await loadInitial(search);
  return (
    <Shell>
      {initialPage === undefined
        ? <BrowsePage initialSearch={search} />
        : <BrowsePage initialPage={initialPage} initialSearch={search} />}
    </Shell>
  );
}

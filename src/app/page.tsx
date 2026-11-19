import { getHomeServices } from "@/features/desk";
import { railFromSnapshot } from "@/features/catalog";
import { homeViewSchema } from "@/shared";
import type { HomeView } from "@/shared";
import { HomePage } from "./_home/home-page";
import { Shell } from "./_shell/shell";

export const dynamic = "force-dynamic";

async function loadInitial(): Promise<HomeView | undefined> {
  const access = await getHomeServices();
  if (!access.ok) return undefined;
  const [listed, snapshot] = await Promise.all([
    access.catalog.list({ sort: "moving", limit: 6 }),
    access.desk.getSnapshot(),
  ]);
  if (!listed.ok) return undefined;
  return homeViewSchema.parse({ ...listed.page, rail: railFromSnapshot(snapshot) });
}

export default async function HomeRoute() {
  const initialView = await loadInitial();
  return (
    <Shell>
      {initialView === undefined ? <HomePage /> : <HomePage initialView={initialView} />}
    </Shell>
  );
}

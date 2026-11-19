import { HomePage } from "./_home/home-page";
import { Shell } from "./_shell/shell";

export const dynamic = "force-dynamic";

export default function HomeRoute() {
  return (
    <Shell>
      <HomePage />
    </Shell>
  );
}

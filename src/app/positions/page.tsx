import { PositionsPage } from "../_positions/positions-page";
import { Shell } from "../_shell/shell";

export const dynamic = "force-dynamic";

export default function PositionsRoute() {
  return (
    <Shell>
      <PositionsPage />
    </Shell>
  );
}

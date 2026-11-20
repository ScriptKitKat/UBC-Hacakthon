import { BriefsPage } from "../_briefs/briefs-page";
import { Shell } from "../_shell/shell";

export const dynamic = "force-dynamic";

export default function BriefsRoute() {
  return (
    <Shell>
      <BriefsPage />
    </Shell>
  );
}

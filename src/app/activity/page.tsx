import { ActivityPage } from "../_activity/activity-page";
import { Shell } from "../_shell/shell";

export const dynamic = "force-dynamic";

export default function ActivityRoute() {
  return (
    <Shell>
      <ActivityPage />
    </Shell>
  );
}

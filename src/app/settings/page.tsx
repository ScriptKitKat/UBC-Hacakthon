import { SettingsPage } from "../_settings/settings-page";
import { Shell } from "../_shell/shell";

export const dynamic = "force-dynamic";

export default function SettingsRoute() {
  return (
    <Shell>
      <SettingsPage />
    </Shell>
  );
}

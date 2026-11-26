import { PageTabs } from "@/features/cms-admin/pages/shared";
import { ALL_STAFF, guard } from "./guard";
import { SETTINGS_TABS } from "./nav";

/**
 * Tabs across the settings pages (general, studio details and logo, my account, users, Facebook, backups): one
 * «الإعدادات» entry in the sidebar, the pages themselves unchanged. Only the tabs the viewer's role may open are listed.
 */
export async function SettingsTabs({ current }: { current: string }) {
  const session = await guard(ALL_STAFF);
  if (!session) return null;
  const tabs = SETTINGS_TABS.filter((t) => t.roles.includes(session.role));
  if (tabs.length < 2) return null;
  return <PageTabs label="أقسام الإعدادات" tabs={tabs} current={current} />;
}

import { Suspense } from "react";
import { SettingsPage } from "@/features/settings/pages";
import { PageSkeleton } from "@/features/admin/ui";

export const metadata = { title: "الإعدادات" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettingsPage />
    </Suspense>
  );
}

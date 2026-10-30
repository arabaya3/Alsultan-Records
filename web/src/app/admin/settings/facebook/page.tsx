import { Suspense } from "react";
import { FacebookSettingsPage } from "@/features/facebook/admin";
import { PageSkeleton } from "@/features/admin/ui";

export const metadata = { title: "صفحة فيسبوك" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FacebookSettingsPage />
    </Suspense>
  );
}

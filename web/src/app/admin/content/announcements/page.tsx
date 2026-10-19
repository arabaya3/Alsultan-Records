import { Suspense } from "react";
import { PageSkeleton } from "@/features/admin/ui";
import { AnnouncementsPage } from "@/features/cms-admin/pages/offers";


export const metadata = { title: "الإعلانات" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AnnouncementsPage  />
    </Suspense>
  );
}

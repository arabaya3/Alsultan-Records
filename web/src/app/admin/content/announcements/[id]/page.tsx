import { Suspense } from "react";
import { PageSkeleton } from "@/features/admin/ui";
import { AnnouncementEditPage } from "@/features/cms-admin/pages/offers";
import type { IdParams, SP } from "@/features/admin/query";

export const metadata = { title: "تعديل إعلان" };

export default function Page({ params, searchParams }: { params: IdParams; searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AnnouncementEditPage params={params} searchParams={searchParams} />
    </Suspense>
  );
}

import { Suspense } from "react";
import { PageSkeleton } from "@/features/admin/ui";
import { OfferPreviewPage } from "@/features/cms-admin/pages/offers";
import type { IdParams } from "@/features/admin/query";

export const metadata = { title: "معاينة عرض" };

export default function Page({ params }: { params: IdParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OfferPreviewPage params={params} />
    </Suspense>
  );
}

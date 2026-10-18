import { Suspense } from "react";
import { PageSkeleton } from "@/features/admin/ui";
import { OfferEditPage } from "@/features/cms-admin/pages/offers";
import type { IdParams, SP } from "@/features/admin/query";

export const metadata = { title: "تعديل عرض" };

export default function Page({ params, searchParams }: { params: IdParams; searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OfferEditPage params={params} searchParams={searchParams} />
    </Suspense>
  );
}

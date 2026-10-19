import { Suspense } from "react";
import { PageSkeleton } from "@/features/admin/ui";
import { ServiceEditPage } from "@/features/cms-admin/pages/services";
import type { IdParams, SP } from "@/features/admin/query";

export const metadata = { title: "تعديل خدمة" };

export default function Page({ params, searchParams }: { params: IdParams; searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ServiceEditPage params={params} searchParams={searchParams} />
    </Suspense>
  );
}

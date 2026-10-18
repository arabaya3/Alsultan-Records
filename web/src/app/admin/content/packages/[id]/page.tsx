import { Suspense } from "react";
import { PageSkeleton } from "@/features/admin/ui";
import { PackageEditPage } from "@/features/cms-admin/pages/packages";
import type { IdParams, SP } from "@/features/admin/query";

export const metadata = { title: "تعديل بكج" };

export default function Page({ params, searchParams }: { params: IdParams; searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PackageEditPage params={params} searchParams={searchParams} />
    </Suspense>
  );
}

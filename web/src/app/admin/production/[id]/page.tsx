import { Suspense } from "react";
import { DeliverableDetail } from "@/features/projects/production-pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type IdParams } from "@/features/admin/query";

export const metadata = { title: "تسليم" };

export default function Page({ params }: { params: IdParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DeliverableDetail params={params} />
    </Suspense>
  );
}

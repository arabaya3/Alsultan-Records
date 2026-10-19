import { Suspense } from "react";
import { SupportDetail } from "@/features/support/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type IdParams } from "@/features/admin/query";

export const metadata = { title: "طلب دعم" };

export default function Page({ params }: { params: IdParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SupportDetail params={params} />
    </Suspense>
  );
}

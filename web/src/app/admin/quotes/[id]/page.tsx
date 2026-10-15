import { Suspense } from "react";
import { QuoteDetail } from "@/features/quotes/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type IdParams } from "@/features/admin/query";

export const metadata = { title: "عرض سعر" };

export default function Page({ params }: { params: IdParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <QuoteDetail params={params} />
    </Suspense>
  );
}

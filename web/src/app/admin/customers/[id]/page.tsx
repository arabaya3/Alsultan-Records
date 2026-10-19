import { Suspense } from "react";
import { CustomerDetail } from "@/features/customers/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type IdParams } from "@/features/admin/query";

export const metadata = { title: "العميل" };

export default function Page({ params }: { params: IdParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CustomerDetail params={params} />
    </Suspense>
  );
}

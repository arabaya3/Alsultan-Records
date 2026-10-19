import { Suspense } from "react";
import { CustomerNew } from "@/features/customers/pages";
import { PageSkeleton } from "@/features/admin/ui";

export const metadata = { title: "عميل جديد" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CustomerNew />
    </Suspense>
  );
}

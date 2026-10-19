import { Suspense } from "react";
import { StaffPage } from "@/features/staff/pages";
import { PageSkeleton } from "@/features/admin/ui";

export const metadata = { title: "الطاقم" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StaffPage />
    </Suspense>
  );
}

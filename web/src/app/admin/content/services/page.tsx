import { Suspense } from "react";
import { PageSkeleton } from "@/features/admin/ui";
import { ServicesPage } from "@/features/cms-admin/pages/services";


export const metadata = { title: "الخدمات" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ServicesPage  />
    </Suspense>
  );
}

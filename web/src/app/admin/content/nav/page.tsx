import { Suspense } from "react";
import { PageSkeleton } from "@/features/admin/ui";
import { NavSectionsPage } from "@/features/cms-admin/pages/nav";


export const metadata = { title: "القائمة والأقسام" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NavSectionsPage  />
    </Suspense>
  );
}

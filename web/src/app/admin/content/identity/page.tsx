import { Suspense } from "react";
import { PageSkeleton } from "@/features/admin/ui";
import { IdentityPage } from "@/features/cms-admin/pages/site";


export const metadata = { title: "الهوية ومعلومات النشاط" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <IdentityPage  />
    </Suspense>
  );
}

import { Suspense } from "react";
import { PageSkeleton } from "@/features/admin/ui";
import { HomeContentPage } from "@/features/cms-admin/pages/site";


export const metadata = { title: "الرئيسية" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HomeContentPage  />
    </Suspense>
  );
}

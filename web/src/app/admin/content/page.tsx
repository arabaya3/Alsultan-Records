import { Suspense } from "react";
import { PageSkeleton } from "@/features/admin/ui";
import { ContentIndexPage } from "@/features/cms-admin/pages/site";


export const metadata = { title: "محتوى الموقع" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ContentIndexPage  />
    </Suspense>
  );
}

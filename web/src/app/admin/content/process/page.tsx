import { Suspense } from "react";
import { PageSkeleton } from "@/features/admin/ui";
import { ProcessPage } from "@/features/cms-admin/pages/process";


export const metadata = { title: "طريقة شغلنا" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProcessPage  />
    </Suspense>
  );
}

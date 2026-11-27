import { Suspense } from "react";
import { PageSkeleton } from "@/features/admin/ui";
import { HomeContentPage } from "@/features/cms-admin/pages/site";
import type { SP } from "@/features/admin/query";

export const metadata = { title: "الرئيسية" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HomeContentPage searchParams={searchParams} />
    </Suspense>
  );
}

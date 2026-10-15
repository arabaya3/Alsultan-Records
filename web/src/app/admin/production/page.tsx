import { Suspense } from "react";
import { ProductionList } from "@/features/projects/production-pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "الإنتاج" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProductionList searchParams={searchParams} />
    </Suspense>
  );
}

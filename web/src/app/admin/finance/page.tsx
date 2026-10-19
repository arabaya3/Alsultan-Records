import { Suspense } from "react";
import { FinancePage } from "@/features/finance/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "المالية" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FinancePage searchParams={searchParams} />
    </Suspense>
  );
}

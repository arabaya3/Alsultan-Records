import { Suspense } from "react";
import { QuoteNew } from "@/features/quotes/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "عرض جديد" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <QuoteNew searchParams={searchParams} />
    </Suspense>
  );
}

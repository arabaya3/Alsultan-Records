import { Suspense } from "react";
import { QuotesList } from "@/features/quotes/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "عروض الأسعار" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <QuotesList searchParams={searchParams} />
    </Suspense>
  );
}

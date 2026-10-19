import { Suspense } from "react";
import { SupportList } from "@/features/support/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "الدعم" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SupportList searchParams={searchParams} />
    </Suspense>
  );
}

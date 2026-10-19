import { Suspense } from "react";
import { EventNew } from "@/features/projects/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "مناسبة جديدة" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EventNew searchParams={searchParams} />
    </Suspense>
  );
}

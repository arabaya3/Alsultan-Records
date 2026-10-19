import { Suspense } from "react";
import { EventsList } from "@/features/projects/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "المناسبات" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EventsList searchParams={searchParams} />
    </Suspense>
  );
}

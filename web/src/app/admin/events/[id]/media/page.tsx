import { Suspense } from "react";
import { EventMedia } from "@/features/projects/media-pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type IdParams, type SP } from "@/features/admin/query";

export const metadata = { title: "وسائط المناسبة" };

export default function Page({ params, searchParams }: { params: IdParams; searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EventMedia params={params} searchParams={searchParams} />
    </Suspense>
  );
}

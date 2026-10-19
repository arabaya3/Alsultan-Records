import { Suspense } from "react";
import { EventDetail } from "@/features/projects/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type IdParams } from "@/features/admin/query";

export const metadata = { title: "المناسبة" };

export default function Page({ params }: { params: IdParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EventDetail params={params} />
    </Suspense>
  );
}

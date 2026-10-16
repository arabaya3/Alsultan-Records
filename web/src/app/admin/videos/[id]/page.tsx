import { Suspense } from "react";
import { VideoEditPage } from "@/features/videos-admin/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type IdParams } from "@/features/admin/query";

export const metadata = { title: "تعديل فيديو" };

export default function Page({ params }: { params: IdParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <VideoEditPage params={params} />
    </Suspense>
  );
}

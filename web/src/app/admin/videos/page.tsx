import { Suspense } from "react";
import { VideosPage } from "@/features/videos-admin/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "الفيديوهات" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <VideosPage searchParams={searchParams} />
    </Suspense>
  );
}

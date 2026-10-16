import { Suspense } from "react";
import { VideosPage } from "@/features/videos-admin/pages";
import { PageSkeleton } from "@/features/admin/ui";

export const metadata = { title: "الفيديوهات" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <VideosPage />
    </Suspense>
  );
}

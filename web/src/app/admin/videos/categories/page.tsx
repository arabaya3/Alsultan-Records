import { Suspense } from "react";
import { VideoCategoriesPage } from "@/features/videos-admin/pages";
import { PageSkeleton } from "@/features/admin/ui";

export const metadata = { title: "تصنيفات الفيديو" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <VideoCategoriesPage />
    </Suspense>
  );
}

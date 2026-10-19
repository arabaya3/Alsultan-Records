import { Suspense } from "react";
import { AlbumPreviewPage } from "@/features/albums-admin/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type IdParams } from "@/features/admin/query";

export const metadata = { title: "معاينة ألبوم", robots: { index: false, follow: false } };

export default function Page({ params }: { params: IdParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlbumPreviewPage params={params} />
    </Suspense>
  );
}

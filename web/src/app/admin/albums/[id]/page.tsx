import { Suspense } from "react";
import { AlbumEditPage } from "@/features/albums-admin/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type IdParams } from "@/features/admin/query";

export const metadata = { title: "تعديل ألبوم" };

export default function Page({ params }: { params: IdParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlbumEditPage params={params} />
    </Suspense>
  );
}

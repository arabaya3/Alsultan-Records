import { Suspense } from "react";
import { AlbumSnapshot } from "@/features/projects/production-pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type IdParams } from "@/features/admin/query";

export const metadata = { title: "اختيار ألبوم" };

export default function Page({ params }: { params: IdParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlbumSnapshot params={params} />
    </Suspense>
  );
}

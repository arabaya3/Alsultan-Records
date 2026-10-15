import { Suspense } from "react";
import { AlbumsList } from "@/features/projects/production-pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "اختيارات الألبوم" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlbumsList searchParams={searchParams} />
    </Suspense>
  );
}

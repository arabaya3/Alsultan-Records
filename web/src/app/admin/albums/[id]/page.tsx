import { Suspense } from "react";
import { AlbumEditPage } from "@/features/albums-admin/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type IdParams } from "@/features/admin/query";

export const metadata = { title: "تعديل ألبوم" };
// Upload completion starts the photo worker after the response (next/server after()); give it the same budget
// as the cron route (60 s Hobby limit).
export const maxDuration = 60;

export default function Page({ params }: { params: IdParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlbumEditPage params={params} />
    </Suspense>
  );
}

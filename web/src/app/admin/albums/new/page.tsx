import { Suspense } from "react";
import { AlbumNewPage } from "@/features/albums-admin/pages";
import { PageSkeleton } from "@/features/admin/ui";

export const metadata = { title: "ألبوم جديد" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlbumNewPage />
    </Suspense>
  );
}

import { Suspense } from "react";
import { AlbumsPage } from "@/features/albums-admin/pages";
import { PageSkeleton } from "@/features/admin/ui";

export const metadata = { title: "الألبومات" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlbumsPage />
    </Suspense>
  );
}

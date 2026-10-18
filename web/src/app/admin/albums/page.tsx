import { Suspense } from "react";
import { AlbumsPage } from "@/features/albums-admin/pages";
import { PageSkeleton } from "@/features/admin/ui";
import type { SP } from "@/features/admin/query";

export const metadata = { title: "الألبومات" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlbumsPage searchParams={searchParams} />
    </Suspense>
  );
}

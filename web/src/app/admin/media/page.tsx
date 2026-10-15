import { Suspense } from "react";
import { MediaIndex } from "@/features/projects/media-pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "الوسائط" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MediaIndex searchParams={searchParams} />
    </Suspense>
  );
}

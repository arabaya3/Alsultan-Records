import { Suspense } from "react";
import { AlbumFacebookPage } from "@/features/facebook/album-page";
import { PageSkeleton } from "@/features/admin/ui";
import { type IdParams } from "@/features/admin/query";

export const metadata = { title: "نشر على فيسبوك", robots: { index: false, follow: false } };
// The publish action uploads photos one by one; a run stops itself before this limit (album-core.ts).
export const maxDuration = 60;

export default function Page({ params }: { params: IdParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlbumFacebookPage params={params} />
    </Suspense>
  );
}

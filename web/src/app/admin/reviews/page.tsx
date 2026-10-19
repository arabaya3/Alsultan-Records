import { Suspense } from "react";
import { ReviewsPage } from "@/features/reviews/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "التقييمات" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReviewsPage searchParams={searchParams} />
    </Suspense>
  );
}

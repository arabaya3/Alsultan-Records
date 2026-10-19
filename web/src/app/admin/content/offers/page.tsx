import { Suspense } from "react";
import { PageSkeleton } from "@/features/admin/ui";
import { OffersPage } from "@/features/cms-admin/pages/offers";
import type { SP } from "@/features/admin/query";

export const metadata = { title: "العروض" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OffersPage searchParams={searchParams} />
    </Suspense>
  );
}

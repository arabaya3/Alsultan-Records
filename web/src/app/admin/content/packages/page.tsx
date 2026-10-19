import { Suspense } from "react";
import { PageSkeleton } from "@/features/admin/ui";
import { PackagesPage } from "@/features/cms-admin/pages/packages";
import type { SP } from "@/features/admin/query";

export const metadata = { title: "البكجات" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PackagesPage searchParams={searchParams} />
    </Suspense>
  );
}

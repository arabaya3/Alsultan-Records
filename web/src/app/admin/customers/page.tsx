import { Suspense } from "react";
import { CustomersList } from "@/features/customers/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "العملاء" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CustomersList searchParams={searchParams} />
    </Suspense>
  );
}

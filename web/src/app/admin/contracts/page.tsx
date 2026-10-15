import { Suspense } from "react";
import { ContractsList } from "@/features/contracts/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "العقود" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ContractsList searchParams={searchParams} />
    </Suspense>
  );
}

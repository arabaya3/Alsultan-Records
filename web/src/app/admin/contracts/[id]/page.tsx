import { Suspense } from "react";
import { ContractDetail } from "@/features/contracts/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type IdParams } from "@/features/admin/query";

export const metadata = { title: "عقد" };

export default function Page({ params }: { params: IdParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ContractDetail params={params} />
    </Suspense>
  );
}

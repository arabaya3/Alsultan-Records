import { Suspense } from "react";
import { EquipmentPage } from "@/features/equipment/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "المعدات" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EquipmentPage searchParams={searchParams} />
    </Suspense>
  );
}

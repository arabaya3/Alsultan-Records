import { Suspense } from "react";
import { CalendarView } from "@/features/bookings/admin/Calendar";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "التقويم" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CalendarView searchParams={searchParams} />
    </Suspense>
  );
}

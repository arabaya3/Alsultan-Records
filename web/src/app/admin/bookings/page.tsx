import { Suspense } from "react";
import { BookingsList } from "@/features/bookings/admin/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "طلبات الحجز" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BookingsList searchParams={searchParams} />
    </Suspense>
  );
}

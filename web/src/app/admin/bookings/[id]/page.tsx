import { Suspense } from "react";
import { BookingDetail } from "@/features/bookings/admin/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type IdParams } from "@/features/admin/query";

export const metadata = { title: "طلب حجز" };

export default function Page({ params }: { params: IdParams }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BookingDetail params={params} />
    </Suspense>
  );
}

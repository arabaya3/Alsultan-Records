import { Suspense } from "react";
import { Overview } from "@/features/admin/Overview";
import { PageSkeleton } from "@/features/admin/ui";

export const metadata = { title: "نظرة عامة" };

export default function AdminHome() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview />
    </Suspense>
  );
}

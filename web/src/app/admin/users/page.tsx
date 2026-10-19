import { Suspense } from "react";
import { UsersPage } from "@/features/users/pages";
import { PageSkeleton } from "@/features/admin/ui";
import { type SP } from "@/features/admin/query";

export const metadata = { title: "المستخدمون" };

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <UsersPage searchParams={searchParams} />
    </Suspense>
  );
}

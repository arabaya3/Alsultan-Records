import { Suspense } from "react";
import { AccountPage } from "@/features/account/pages";
import { PageSkeleton } from "@/features/admin/ui";

export const metadata = { title: "حسابي" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AccountPage />
    </Suspense>
  );
}

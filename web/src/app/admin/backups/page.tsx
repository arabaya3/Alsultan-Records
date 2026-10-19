import { Suspense } from "react";
import { BackupsPage } from "@/features/backups/pages";
import { PageSkeleton } from "@/features/admin/ui";

export const metadata = { title: "النسخ الاحتياطي" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BackupsPage />
    </Suspense>
  );
}

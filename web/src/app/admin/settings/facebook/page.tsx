import { Suspense } from "react";
import { FacebookSettingsPage } from "@/features/facebook/admin";
import { PageSkeleton } from "@/features/admin/ui";

export const metadata = { title: "صفحة فيسبوك" };

async function Content({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const { result } = await searchParams;
  return <FacebookSettingsPage result={result} />;
}

export default function Page({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

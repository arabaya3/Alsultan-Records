import type { Metadata } from "next";
import { Suspense } from "react";
import { EventGallery } from "@/features/galleries/components/EventGallery";
import { fetchGalleryPage } from "@/features/galleries/data";
import { PanelSkeleton, Unavailable } from "@/features/portal/components/PortalUi";
import { loadEventPage } from "@/features/portal/event-page";

export const metadata: Metadata = { title: "المعرض" };

async function Gallery({ params }: { params: Promise<{ eventId: string }> }) {
  const { supabase, eventId, path, overview } = await loadEventPage(params, "gallery");
  const first = overview ? await fetchGalleryPage(supabase, eventId, 0) : null;
  if (!first) return <Unavailable retryHref={path} />;
  return (
    <>
      <h2 className="mb-6 text-2xl font-bold">
        المعرض <span className="text-base font-normal text-on-cream-muted">({first.total} صورة)</span>
      </h2>
      <EventGallery eventId={eventId} initial={first} mode="view" />
    </>
  );
}

export default function GalleryPage({ params }: PageProps<"/portal/events/[eventId]/gallery">) {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <Gallery params={params} />
    </Suspense>
  );
}

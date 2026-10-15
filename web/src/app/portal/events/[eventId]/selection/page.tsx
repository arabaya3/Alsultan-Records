import type { Metadata } from "next";
import { Suspense } from "react";
import { getSelectionState } from "@/features/album-selections/data";
import { EventGallery } from "@/features/galleries/components/EventGallery";
import { fetchGalleryPage } from "@/features/galleries/data";
import { PanelSkeleton, Unavailable } from "@/features/portal/components/PortalUi";
import { loadEventPage } from "@/features/portal/event-page";
import { dateAr } from "@/features/portal/format";

export const metadata: Metadata = { title: "اختيار صور الألبوم" };

async function Selection({ params }: { params: Promise<{ eventId: string }> }) {
  const { supabase, eventId, path, overview } = await loadEventPage(params, "selection");
  if (!overview) return <Unavailable retryHref={path} />;
  const [first, sel] = await Promise.all([fetchGalleryPage(supabase, eventId, 0), getSelectionState(supabase, eventId)]);
  if (!first || !sel) return <Unavailable retryHref={path} />;
  const submitted = sel.status !== "draft";
  return (
    <>
      <div className="mb-6">
        <h2 className="text-2xl font-bold">اختيار صور الألبوم</h2>
        {submitted ? (
          <p role="status" className="mt-3 rounded-sm border border-success/40 bg-success/5 px-4 py-3" data-testid="snapshot-status">
            {sel.status === "locked" ? "اعتمد الاستوديو اختيارك وبدأ العمل على الألبوم." : "تم إرسال اختيارك إلى الاستوديو"}
            {sel.snapshot ? ` — ${sel.snapshot.itemCount} صورة، بتاريخ ${dateAr(sel.snapshot.submittedAt)}.` : "."}{" "}
            لم يعد الاختيار قابلاً للتعديل.
          </p>
        ) : (
          <p className="mt-2 text-on-cream-muted">
            اضغط «اختيار» على الصور التي تريدها في الألبوم. يُحفظ اختيارك تلقائياً، وعندما تنتهي راجعه وأرسله.
          </p>
        )}
      </div>
      <EventGallery
        eventId={eventId}
        initial={first}
        mode="select"
        selection={{ status: sel.status, count: sel.count, items: sel.items }}
      />
    </>
  );
}

export default function SelectionPage({ params }: PageProps<"/portal/events/[eventId]/selection">) {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <Selection params={params} />
    </Suspense>
  );
}

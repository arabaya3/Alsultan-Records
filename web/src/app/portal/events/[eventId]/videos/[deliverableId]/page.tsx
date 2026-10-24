import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RequestRevisionForm } from "@/features/deliverables/components/DeliverableControls";
import { getDeliverable } from "@/features/deliverables/data";
import { PanelSkeleton, StatusPill, Unavailable } from "@/features/portal/components/PortalUi";
import { loadEventPage } from "@/features/portal/event-page";
import { isUuid } from "@/features/portal/session";
import { VideoReview } from "@/features/video-reviews/components/VideoReview";
import { bidiDir } from "@/lib/bidi";

export const metadata: Metadata = { title: "مراجعة الفيلم" };

async function Review({ params }: { params: Promise<{ eventId: string; deliverableId: string }> }) {
  const { deliverableId } = await params;
  const { supabase, eventId, path, overview } = await loadEventPage(params, `videos/${deliverableId}`);
  if (!overview) return <Unavailable retryHref={path} />;
  if (!isUuid(deliverableId)) notFound();
  const res = await getDeliverable(supabase, eventId, deliverableId);
  if (res.status === "unavailable") return <Unavailable retryHref={path} />;
  const d = res.data;
  if (!d || d.kind !== "video") notFound();
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href={`/portal/events/${eventId}/videos`} className="underline">
          كل الأفلام
        </Link>
      </p>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold"><bdi dir={bidiDir(d.title)}>{d.title}</bdi></h2>
        <StatusPill status={d.status} />
      </div>
      <VideoReview
        key={d.id}
        status={d.status}
        revisions={d.revisions.map((r) => ({ id: r.id, revisionNo: r.revisionNo, notes: r.notes, createdAt: r.createdAt }))}
      />
      {d.status === "review" ? (
        <section className="mt-10 rounded-md border border-cream-line bg-cream-2 p-5">
          <h3 className="mb-2 text-lg font-semibold">هل تريد تعديلات على هذه النسخة؟</h3>
          <p className="mb-4 text-sm text-on-cream-muted">أضف ملاحظاتك بالتوقيت أعلاه، ثم أرسل طلب التعديل ليبدأ الفريق العمل عليها.</p>
          <RequestRevisionForm deliverableId={d.id} />
        </section>
      ) : null}
    </>
  );
}

export default function VideoReviewPage({ params }: PageProps<"/portal/events/[eventId]/videos/[deliverableId]">) {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <Review params={params} />
    </Suspense>
  );
}

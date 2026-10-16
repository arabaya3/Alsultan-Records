import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PlayBadge } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { listDeliverables } from "@/features/deliverables/data";
import { PanelSkeleton, StatusPill, Unavailable } from "@/features/portal/components/PortalUi";
import { loadEventPage } from "@/features/portal/event-page";
import { dateAr } from "@/features/portal/format";

export const metadata: Metadata = { title: "الأفلام" };

async function Videos({ params }: { params: Promise<{ eventId: string }> }) {
  const { supabase, eventId, path, overview } = await loadEventPage(params, "videos");
  const list = overview ? await listDeliverables(supabase, eventId, ["video"]) : null;
  if (!list) return <Unavailable retryHref={path} />;
  if (!list.length) return <EmptyState title="لا توجد أفلام بعد" body="سنُعلمك فور رفع أول نسخة من فيلمك للمراجعة." />;
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {list.map((d) => (
        <li key={d.id}>
          <Link
            href={`/portal/events/${eventId}/videos/${d.id}`}
            className="flex items-center gap-4 rounded-md border border-cream-line bg-[#fffdf8] p-5 transition-colors hover:border-gold"
            data-testid="video-deliverable"
          >
            <span className="grid h-16 w-24 shrink-0 place-items-center rounded-sm bg-ink text-gold">
              <PlayBadge size={32} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-lg font-semibold"><bdi dir="auto">{d.title}</bdi></span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-on-cream-muted">
                <StatusPill status={d.status} />
                {d.revisions.length ? `${d.revisions.length} نسخ · آخرها ${dateAr(d.revisions[0].createdAt)}` : "لا توجد نسخ بعد"}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function VideosPage({ params }: PageProps<"/portal/events/[eventId]/videos">) {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <Videos params={params} />
    </Suspense>
  );
}

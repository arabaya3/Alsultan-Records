import type { Metadata } from "next";
import { Suspense } from "react";
import { EmptyState } from "@/components/ui/States";
import { DownloadButton, RequestRevisionForm } from "@/features/deliverables/components/DeliverableControls";
import { listDeliverables, listEventFiles } from "@/features/deliverables/data";
import { PanelSkeleton, StatusPill, Unavailable } from "@/features/portal/components/PortalUi";
import { loadEventPage } from "@/features/portal/event-page";
import { dateAr, DELIVERABLE_KIND } from "@/features/portal/format";
import { bidiDir } from "@/lib/bidi";

export const metadata: Metadata = { title: "الملفات" };

function size(bytes: number | null) {
  if (!bytes) return "";
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} غيغابايت` : `${mb.toFixed(mb < 10 ? 1 : 0)} ميغابايت`;
}

async function Files({ params }: { params: Promise<{ eventId: string }> }) {
  const { supabase, eventId, path, overview } = await loadEventPage(params, "files");
  if (!overview) return <Unavailable retryHref={path} />;
  const [deliv, files] = await Promise.all([
    listDeliverables(supabase, eventId, ["files", "album", "gallery"]),
    listEventFiles(supabase, eventId),
  ]);
  if (!deliv || !files) return <Unavailable retryHref={path} />;
  if (!deliv.length && !files.length) return <EmptyState title="لا توجد ملفات بعد" body="ستظهر هنا الملفات الجاهزة للتنزيل." />;
  return (
    <div className="grid gap-10">
      {deliv.length ? (
        <section aria-labelledby="d-h">
          <h2 id="d-h" className="mb-4 text-2xl font-bold">الأعمال</h2>
          <ul className="grid gap-4">
            {deliv.map((d) => (
              <li key={d.id} className="rounded-md border border-cream-line bg-[#fffdf8] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p>
                    <span className="text-on-cream-muted">{DELIVERABLE_KIND[d.kind]} · </span>
                    <span className="font-semibold"><bdi dir={bidiDir(d.title)}>{d.title}</bdi></span>
                  </p>
                  <StatusPill status={d.status} />
                </div>
                {d.revisions[0]?.mediaAssetId ? (
                  <div className="mt-3">
                    <DownloadButton assetId={d.revisions[0].mediaAssetId} label={`تنزيل النسخة ${d.revisions[0].revisionNo}`} />
                  </div>
                ) : null}
                {d.status === "review" ? (
                  <div className="mt-4">
                    <RequestRevisionForm deliverableId={d.id} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {files.length ? (
        <section aria-labelledby="f-h">
          <h2 id="f-h" className="mb-4 text-2xl font-bold">ملفات للتنزيل</h2>
          <ul className="divide-y divide-cream-line rounded-md border border-cream-line bg-[#fffdf8]">
            {files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid="file-row">
                <div className="min-w-0">
                  <p className="font-medium">{f.kind === "video" ? "فيديو" : "مستند"}</p>
                  <p className="text-sm text-on-cream-muted">{[size(f.bytes), dateAr(f.createdAt)].filter(Boolean).join(" · ")}</p>
                </div>
                <DownloadButton assetId={f.id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export default function FilesPage({ params }: PageProps<"/portal/events/[eventId]/files">) {
  return (
    <Suspense fallback={<PanelSkeleton />}>
      <Files params={params} />
    </Suspense>
  );
}

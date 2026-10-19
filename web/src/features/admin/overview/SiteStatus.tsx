import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hebronToday, isOfferActive } from "@/features/public-content/cms-model";
import { Stat } from "../ui";

/** Real counts of what is live on the site, read with the caller's client under RLS (admin). */
export async function SiteStatus() {
  const sb = await createClient();
  const head = { count: "exact" as const, head: true };
  const [offers, albums, videos, processing, failed, lastAlbum, lastVideo] = await Promise.all([
    sb.from("offers").select("status, starts_on, ends_on").eq("status", "published"),
    sb.from("photo_albums").select("id", head).eq("is_published", true).is("deleted_at", null),
    sb.from("showcase_videos").select("id", head).eq("is_published", true),
    sb.from("album_photos").select("id", head).in("upload_status", ["pending", "processing"]).is("deleted_at", null),
    sb.from("album_photos").select("id", head).eq("upload_status", "failed").is("deleted_at", null),
    sb.from("photo_albums").select("id, title").is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("showcase_videos").select("id, title").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const today = hebronToday();
  const n = (v: number | null | undefined, err: unknown) => (err ? "—" : (v ?? 0));
  const activeOffers = offers.error ? "—" : (offers.data ?? []).filter((o) => isOfferActive(o, today)).length;
  const failedN = failed.count ?? 0;

  return (
    <section aria-labelledby="site-status-h" className="mb-6" data-testid="site-status">
      <h2 id="site-status-h" className="mb-3 font-display text-lg font-bold">حالة الموقع</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="عروض فعّالة اليوم" value={activeOffers} href="/admin/content/offers" />
        <Stat label="ألبومات منشورة" value={n(albums.count, albums.error)} href="/admin/albums" />
        <Stat label="فيديوهات منشورة" value={n(videos.count, videos.error)} href="/admin/videos" />
        <Stat label="صور قيد المعالجة" value={n(processing.count, processing.error)} href="/admin/albums" />
        <Stat
          label="صور فشل رفعها"
          value={n(failed.count, failed.error)}
          href="/admin/albums"
          tone={failedN > 0 ? "danger" : undefined}
        />
      </div>
      {lastAlbum.data || lastVideo.data ? (
        <p className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {lastAlbum.data ? (
            <span>
              آخر ألبوم:{" "}
              <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={`/admin/albums/${lastAlbum.data.id}`}>
                {lastAlbum.data.title}
              </Link>
            </span>
          ) : null}
          {lastVideo.data ? (
            <span>
              آخر فيديو:{" "}
              <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={`/admin/videos/${lastVideo.data.id}`}>
                {lastVideo.data.title}
              </Link>
            </span>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hebronToday, isOfferActive } from "@/features/public-content/cms-model";

export type FollowUp = { label: string; href: string; tone?: "danger" | "gold" };

function Arrow() {
  // "Forward" in RTL points left.
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0">
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

function Heading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 id={id} className="font-display text-2xl font-bold">
        {children}
      </h2>
      <span aria-hidden="true" className="mt-2 block h-0.5 w-14 rounded-full bg-gold" />
    </div>
  );
}

/**
 * What is live on the site (real counts under RLS, admin), what needs a follow-up (failed or stuck uploads plus the
 * caller's own alerts) and the latest album and video. Laid out as the owner's design: three numbers between gold rules,
 * then «يحتاج متابعة» and «آخر ما نُشر» side by side.
 */
export async function SiteStatus({ alerts = [] }: { alerts?: FollowUp[] }) {
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
  const processingN = processing.count ?? 0;

  const stats = [
    { label: "عروض فعّالة", value: activeOffers, href: "/admin/content/offers" },
    { label: "ألبومات منشورة", value: n(albums.count, albums.error), href: "/admin/albums" },
    { label: "فيديو منشور", value: n(videos.count, videos.error), href: "/admin/videos" },
  ];
  const followUps: FollowUp[] = [
    ...(failedN > 0 ? [{ label: failedN === 1 ? "صورة واحدة فشل رفعها" : `${failedN.toLocaleString("ar-PS")} صور فشل رفعها`, href: "/admin/albums", tone: "danger" as const }] : []),
    ...(processingN > 0 ? [{ label: `${processingN.toLocaleString("ar-PS")} صور قيد المعالجة`, href: "/admin/albums" }] : []),
    ...alerts,
  ];
  const latest = [
    lastAlbum.data ? { kind: "ألبوم", text: `آخر ألبوم: ${lastAlbum.data.title}`, href: `/admin/albums/${lastAlbum.data.id}` } : null,
    lastVideo.data ? { kind: "فيديو", text: `آخر فيديو: ${lastVideo.data.title}`, href: `/admin/videos/${lastVideo.data.id}` } : null,
  ].filter((x): x is NonNullable<typeof x> => !!x);

  return (
    <>
      <section aria-label="حالة الموقع" className="mb-8 border-y border-gold/60 py-6" data-testid="site-status">
        <ul className="grid grid-cols-3 divide-x divide-gold/60">
          {stats.map((s) => (
            <li key={s.label}>
              <Link href={s.href} className="flex flex-col items-center gap-1 rounded-lg px-2 py-1 text-center transition-colors hover:text-gold-text">
                <span className="font-display text-4xl leading-none font-bold sm:text-6xl" dir="ltr">
                  {s.value}
                </span>
                <span className="text-base text-on-cream-muted sm:text-xl">{s.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="follow-h" className="rounded-xl border border-cream-line bg-[#fffdf8] p-5" data-testid={followUps.length ? "alerts" : "all-clear"}>
          <Heading id="follow-h">يحتاج متابعة</Heading>
          {followUps.length ? (
            <ul className="mt-5 space-y-3">
              {followUps.map((f) => (
                <li key={f.label}>
                  <Link
                    href={f.href}
                    className={`flex min-h-14 items-center justify-between gap-4 rounded-lg border px-4 py-3 transition-colors ${
                      f.tone === "danger" ? "border-danger/30 bg-danger/10 text-danger hover:border-danger/60" : "border-cream-line bg-cream-2/50 hover:border-gold"
                    }`}
                  >
                    <span className="text-lg font-semibold">{f.label}</span>
                    <span className="flex items-center gap-3 border-s border-current/30 ps-4 text-sm text-on-cream">
                      <span className="max-sm:sr-only underline underline-offset-4">عرض التفاصيل</span>
                      <Arrow />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-5 rounded-lg border border-cream-line bg-cream-2/50 p-4 text-base">كل شي تمام — ما في شي مستعجل.</p>
          )}
        </section>

        <section aria-labelledby="latest-h" className="rounded-xl border border-cream-line bg-[#fffdf8] p-5">
          <Heading id="latest-h">آخر ما نُشر</Heading>
          {latest.length ? (
            <ul className="mt-5 space-y-3">
              {latest.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="flex min-h-14 items-center justify-between gap-4 rounded-lg border border-cream-line px-4 py-3 transition-colors hover:border-gold">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="shrink-0 rounded-md bg-gold/25 px-2.5 py-1 text-sm font-medium">{l.kind}</span>
                      <span className="min-w-0 text-base break-words">{l.text}</span>
                    </span>
                    <Arrow />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-5 text-on-cream-muted">ما في ألبومات ولا فيديوهات بعد.</p>
          )}
        </section>
      </div>
    </>
  );
}
